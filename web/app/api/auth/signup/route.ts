import { NextResponse } from "next/server";
import { db, uuid } from "@/lib/db";
import { PASSWORD_MIN, tooManyAttempts } from "@/lib/auth";
import { authClient } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Bump when the disclaimer wording changes; acceptances are stored per version. */
const DISCLAIMER_VERSION = "2026-11-12";

/**
 * POST { name, email, password, timezone?, acceptDisclaimer } -> create an
 * account with Supabase Auth (PRD F1).
 *
 * - Email confirmation on (hosted Supabase default): Supabase sends the
 *   verification email (F1 step 2); the reply says to check the inbox.
 * - Confirmation off (local development): the trader is signed in and lands
 *   on a new, empty chat (PR-CH-1).
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

  const supabase = await authClient();
  const origin = new URL(req.url).origin;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, timezone }, emailRedirectTo: `${origin}/login?confirmed=1` },
  });

  if (error) {
    if (error.code === "user_already_exists" || /already registered/i.test(error.message)) {
      return NextResponse.json(
        { error: "An account with this email already exists. Sign in instead.", code: "exists" },
        { status: 409 }
      );
    }
    if (error.code === "weak_password") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[signup]", error);
    return NextResponse.json({ error: "We couldn't create your account just now. Try again." }, { status: 502 });
  }

  // With email confirmation on, an email that is already registered comes back
  // as a user with no identities (no account enumeration, EC-A1): reply the
  // same way as a new sign-up and store nothing.
  const user = data.user;
  const isNew = Boolean(user && (user.identities?.length ?? 0) > 0);
  if (user && isNew) {
    await db.tx(async (t) => {
      await t.run(
        `INSERT INTO profiles (user_id, display_name, timezone) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, timezone = EXCLUDED.timezone`,
        user.id,
        name,
        timezone
      );
      await t.run(
        `INSERT INTO legal_acceptances (id, user_id, document_type, document_version)
         VALUES (?, ?, 'disclaimer', ?)`,
        uuid(),
        user.id,
        DISCLAIMER_VERSION
      );
    });
  }

  if (!data.session) {
    return NextResponse.json(
      {
        needsConfirmation: true,
        message: `We sent a link to ${email}. Open it to confirm your email, then sign in.`,
      },
      { status: 201 }
    );
  }
  return NextResponse.json({ user: { id: user!.id, email, name } }, { status: 201 });
}
