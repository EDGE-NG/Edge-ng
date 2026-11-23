import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db, uuid } from "@/lib/db";
import { DISCLAIMER_VERSION, OAUTH_COOKIE } from "@/lib/legal";
import { authClient } from "@/lib/supabase";
import { safeTimeZone } from "@/lib/time";

/**
 * GET /auth/callback?code=... -> Google (through Supabase) sends the trader
 * back here after "Continue with Google" (PRD F1).
 *
 * Swaps the one-time code for a session (cookies), then makes sure the
 * account has its profile and disclaimer acceptance, as email sign-up does
 * (F1 step 3). Google has already verified the email address, so there is no
 * confirmation email. Any failure goes back to the sign-in page with a plain
 * message; it never signs anyone in half-way.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (error: string) => NextResponse.redirect(new URL(`/login?error=${error}`, origin));

  const code = url.searchParams.get("code");
  // the trader closed Google's window or said no
  if (!code) return back(url.searchParams.get("error") === "access_denied" ? "google_cancelled" : "google");

  const store = await cookies();
  const raw = store.get(OAUTH_COOKIE)?.value;
  store.delete(OAUTH_COOKIE);
  let agreed: { accept?: string; tz?: string } = {};
  try {
    agreed = raw ? (JSON.parse(raw) as typeof agreed) : {};
  } catch {
    agreed = {};
  }

  const supabase = await authClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const user = data?.user;
  if (error || !user) {
    console.error("[auth/callback] Google sign-in failed:", error);
    return back("google");
  }

  const accepted = await db.one<{ n: number }>(
    "SELECT count(*)::int AS n FROM legal_acceptances WHERE user_id = ? AND document_type = 'disclaimer'",
    user.id
  );
  if (!accepted?.n) {
    // a new account must accept the disclaimer first (F1 step 3)
    if (agreed.accept !== DISCLAIMER_VERSION) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/signup?error=disclaimer", origin));
    }
    const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
    const name = String(meta.full_name || meta.name || user.email?.split("@")[0] || "").trim().slice(0, 80) || null;
    await db.tx(async (t) => {
      // the profile row already exists (created with the auth user); fill it in only where empty
      await t.run(
        `INSERT INTO profiles (user_id, display_name, timezone) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           display_name = COALESCE(profiles.display_name, EXCLUDED.display_name),
           timezone = CASE WHEN profiles.timezone = 'UTC' THEN EXCLUDED.timezone ELSE profiles.timezone END`,
        user.id,
        name,
        safeTimeZone(agreed.tz)
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

  return NextResponse.redirect(new URL("/checklist", origin));
}
