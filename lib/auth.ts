import { db, now, uuid } from "./db";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "edge_session";
const SESSION_TTL_DAYS = 30;
const CODE_TTL_MINUTES = 15;

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
