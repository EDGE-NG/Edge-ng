import { db, now, uuid } from "./db";
import { cookies } from "next/headers";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "edge_session";
const SESSION_TTL_DAYS = 30;
const CODE_TTL_MINUTES = 15;

/* ---------------------------------------------------- passwords --------- */
// scrypt is the "equivalent" the PRD allows next to argon2id (REQ-ID-1) and
// ships with Node, so there is no native dependency to install.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const PASSWORD_MIN = 8;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  );
}

/** Hash as `scrypt$N$r$p$salt$hash` so parameters can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, , , , saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash to compare against when the email is unknown, so timing doesn't reveal it. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  return (dummyHash ??= hashPassword(randomBytes(12).toString("hex")));
}

/* ------------------------------------------------- attempt limiter ------ */
// In-memory, per key (email or IP): enough to slow password guessing on a
// single server. Swap for a shared store (Redis) when the API scales out.
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

const DEMO_ID = "demo-user";
export const DEMO_EMAIL = "demo@edge.local";

/** Email-code login: issue a one-time 6-digit code (previous codes die). */
export function createLoginCode(email: string): string {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const ts = now();
  db.prepare("UPDATE auth_tokens SET used_at = ? WHERE email = ? AND used_at IS NULL").run(
    ts,
    email
  );
  db.prepare(
    "INSERT INTO auth_tokens (id, email, code, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(
    uuid(),
    email,
    code,
    ts,
    new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString()
  );
  return code;
}

/** Consume a code. Returns the email it was issued for, or null. */
export function verifyLoginCode(email: string, code: string): string | null {
  const row = db
    .prepare(
      `SELECT id, email FROM auth_tokens
       WHERE email = ? AND code = ? AND used_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(email, code, now()) as { id: string; email: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE auth_tokens SET used_at = ? WHERE id = ?").run(now(), row.id);
  return row.email;
}

/** Find or create the account for a verified email (passwordless). */
export function ensureUser(email: string): User {
  let row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as unknown as
    | User
    | undefined;
  if (!row) {
    db.prepare(
      "INSERT INTO users (id, email, name, timezone, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(uuid(), email, null, "UTC", now());
    row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as unknown as User;
  }
  return row;
}

/**
 * The built-in demo account (holds all V1 test data), created on demand so
 * "Continue as demo" always works.
 */
export function ensureDemoUser(): User {
  let row = db.prepare("SELECT * FROM users WHERE id = ?").get(DEMO_ID) as unknown as
    | User
    | undefined;
  if (!row) {
    db.prepare(
      "INSERT INTO users (id, email, name, timezone, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(DEMO_ID, DEMO_EMAIL, "Demo Trader", "UTC", now());
    row = db.prepare("SELECT * FROM users WHERE id = ?").get(DEMO_ID) as unknown as User;
  }
  return row;
}

/**
 * The signed-in user for this request, or null when there is no valid
 * session. Reads the httpOnly session cookie set at login.
 */
export async function getUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.timezone, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(token, now()) as User | undefined;
  return row ?? null;
}

/** Create a session row and return its opaque token. */
export function createSession(userId: string): string {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, now(), expiresAt);
  return token;
}

/** Remove a session (logout). */
export function destroySession(token: string | undefined | null): void {
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
}

/** Cookie attributes shared by login/register/logout responses. */
export const sessionCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_DAYS * 86_400,
};
