/**
 * Accounts: Supabase Auth (PRD F1, REQ-ID-1). Passwords, sessions, email
 * verification and password reset are handled by Supabase; the session lives
 * in httpOnly cookies set by @supabase/ssr. Profile details (name, timezone)
 * live in public.profiles.
 */
import { db } from "./db";
import { authClient } from "./supabase";

export const PASSWORD_MIN = 8;

/* ------------------------------------------------- attempt limiter ------ */
// In-memory, per key (email or IP): slows password guessing on one server.
// Supabase Auth applies its own rate limits on top.
const attempts = new Map<string, { count: number; resetAt: number }>();
export function tooManyAttempts(key: string, max = 8, windowMs = 15 * 60_000): boolean {
  const t = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < t) {
    attempts.set(key, { count: 1, resetAt: t + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}
export function clearAttempts(key: string): void {
  attempts.delete(key);
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  created_at: string;
}

/**
 * The signed-in user for this request, or null. Checks the session with
 * Supabase Auth (not just the cookie), then reads the profile.
 */
export async function getUser(): Promise<User | null> {
  // Reading cookies is left outside the try: during `next build` it rejects on
  // purpose to mark the route as dynamic, and that signal must not be swallowed.
  const supabase = await authClient();
  let authUser;
  try {
    const { data } = await supabase.auth.getUser();
    authUser = data.user;
  } catch (err) {
    console.error("[auth] session check failed:", err);
    return null;
  }
  if (!authUser) return null;
  const p = await db.one<{ display_name: string | null; timezone: string; created_at: string }>(
    "SELECT display_name, timezone, created_at FROM profiles WHERE user_id = ?",
    authUser.id
  );
  const meta = (authUser.user_metadata ?? {}) as { name?: string };
  return {
    id: authUser.id,
    email: authUser.email ?? "",
    name: p?.display_name ?? meta.name ?? null,
    timezone: p?.timezone ?? "UTC",
    created_at: p?.created_at ?? authUser.created_at,
  };
}
