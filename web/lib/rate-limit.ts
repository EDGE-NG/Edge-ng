/**
 * Rate limits shared by every server (migration 0005_rate_limits.sql).
 *
 * On Vercel each request can land on a different server copy, so a counter in
 * memory let a guesser spread attempts across them. The count now lives in
 * Postgres, one row per key, updated atomically by rate_limit_hit().
 *
 * Keys are hashed before they are stored, so the table never holds an email
 * address or IP. If the database can't be reached, the old in-memory counter
 * is used for that request instead, so a database hiccup never locks
 * everyone out and never turns the limit off.
 */
import { createHash } from "node:crypto";
import { db } from "./db";

/** Never store the raw key (it can hold an email or IP address). */
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// Fallback when the database is unavailable: per server, as before.
const memory = new Map<string, { count: number; resetAt: number }>();
export function memoryHit(key: string, windowMs: number, now = Date.now()): number {
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/**
 * Count one attempt for `key`; true once there have been more than `max`
 * attempts within `windowMs`.
 */
export async function tooManyAttempts(key: string, max = 8, windowMs = 15 * 60_000): Promise<boolean> {
  const hashed = hashKey(key);
  try {
    const row = await db.one<{ count: number }>("SELECT public.rate_limit_hit(?, ?) AS count", hashed, windowMs);
    return (row?.count ?? 1) > max;
  } catch (err) {
    console.error("[rate-limit] database unavailable, using this server's memory:", err);
    return memoryHit(hashed, windowMs) > max;
  }
}

/** Forget the attempts for `key` (e.g. after a successful sign-in). */
export async function clearAttempts(key: string): Promise<void> {
  const hashed = hashKey(key);
  memory.delete(hashed);
  try {
    await db.run("DELETE FROM rate_limits WHERE key = ?", hashed);
  } catch (err) {
    console.error("[rate-limit] could not clear attempts:", err);
  }
}

/** Daily job: drop rows whose window ended. Returns how many were removed. */
export async function purgeExpiredLimits(): Promise<number> {
  return db.run("DELETE FROM rate_limits WHERE reset_at < now()");
}
