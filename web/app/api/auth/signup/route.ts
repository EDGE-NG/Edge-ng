import { NextResponse } from "next/server";
import { db, now, uuid } from "@/lib/db";
import {
  PASSWORD_MIN,
  SESSION_COOKIE,
  createSession,
  hashPassword,
  sessionCookie,
  tooManyAttempts,
} from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Bump when the disclaimer wording changes; acceptances are stored per version. */
const DISCLAIMER_VERSION = "2026-11-12";

/**
 * POST { name, email, password, timezone? } -> create an account and sign in
 * (PRD F1). The trader lands on a new, empty chat (PR-CH-1).
 *
 * Not yet done (needs an email provider): the verification email of F1 step 2.
 * The PRD lets unverified accounts build drafts, so the chat works today;
 * gating the pre-trade check on verification comes with the gate itself.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (tooManyAttempts(`signup:${ip}`, 10)) {
    return NextResponse.json(
      { error: "Too many sign-up attempts. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    password?: string;
    timezone?: string;
    acceptDisclaimer?: boolean;
  };
  const name = String(body.name ?? "").trim().slice(0, 80);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const timezone = String(body.timezone ?? "UTC").slice(0, 64) || "UTC";

  if (!name) return NextResponse.json({ error: "Tell us what to call you." }, { status: 400 });
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < PASSWORD_MIN) {
    return NextResponse.json(
      { error: `Use at least ${PASSWORD_MIN} characters for your password.` },
      { status: 400 }
    );
  }
  if (password.length > 200) {
    return NextResponse.json({ error: "That password is too long." }, { status: 400 });
  }

  if (body.acceptDisclaimer !== true) {
    return NextResponse.json(
      { error: "Please confirm you understand Edge is decision support, not financial advice." },
      { status: 400 }
    );
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    // PRD EC-A1 wants a neutral reply plus an email to the owner; that needs
    // the email provider. Until then, point the trader to sign in.
    return NextResponse.json(
      { error: "An account with this email already exists. Sign in instead.", code: "exists" },
      { status: 409 }
    );
  }

  const id = uuid();
  const ts = now();
  db.prepare(
    `INSERT INTO users (id, email, name, timezone, created_at, password_hash, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, email, name, timezone, ts, await hashPassword(password), ts);
  db.prepare(
    `INSERT INTO legal_acceptances (id, user_id, document_type, document_version, accepted_at)
     VALUES (?, ?, 'disclaimer', ?, ?)`
  ).run(uuid(), id, DISCLAIMER_VERSION, ts);

  const token = createSession(id);
  const res = NextResponse.json({ user: { id, email, name } }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookie);
  return res;
}
