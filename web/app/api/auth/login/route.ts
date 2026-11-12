import { NextResponse } from "next/server";
import { db, now } from "@/lib/db";
import {
  SESSION_COOKIE,
  clearAttempts,
  createSession,
  getDummyHash,
  sessionCookie,
  tooManyAttempts,
  verifyPassword,
} from "@/lib/auth";

const NEUTRAL = "That email and password don't match. Check them and try again.";

/** POST { email, password } -> sign in with a password (PRD F1, REQ-ID-1). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  if (tooManyAttempts(`login:${email}`) || tooManyAttempts(`login-ip:${ip}`, 30)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes, then try again." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const user = db
    .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
    .get(email) as
    | { id: string; email: string; name: string | null; password_hash: string | null }
    | undefined;

  // Always run a hash comparison so response time doesn't reveal whether the
  // email exists (no account enumeration, PRD EC-A1/A3).
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !user.password_hash || !ok) {
    return NextResponse.json({ error: NEUTRAL }, { status: 401 });
  }

  clearAttempts(`login:${email}`);
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now(), user.id);
  const token = createSession(user.id);
  const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookie);
  return res;
}
