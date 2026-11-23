import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DISCLAIMER_VERSION, OAUTH_COOKIE } from "@/lib/legal";
import { authClient } from "@/lib/supabase";
import { safeTimeZone } from "@/lib/time";

/**
 * GET /api/auth/google?accept=1&tz=Europe/London -> "Continue with Google" (PRD F1).
 *
 * Starts Supabase's Google sign-in. The page only links here once the trader
 * has accepted the disclaimer (the sign-up checkbox, or the "By continuing"
 * line on the sign-in page), so the acceptance is remembered in a 10-minute
 * cookie and stored by /auth/callback for a new account (F1 step 3).
 * Supabase keeps its PKCE verifier in a cookie too; the callback needs both.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  if (url.searchParams.get("accept") !== "1") {
    return NextResponse.redirect(new URL("/signup?error=disclaimer", origin));
  }

  const store = await cookies();
  store.set(
    OAUTH_COOKIE,
    JSON.stringify({ accept: DISCLAIMER_VERSION, tz: safeTimeZone(url.searchParams.get("tz")) }),
    { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/", maxAge: 600 }
  );

  const supabase = await authClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      skipBrowserRedirect: true,
      // let the trader pick which Google account, instead of silently reusing one
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) {
    console.error("[auth/google] could not start Google sign-in:", error);
    return NextResponse.redirect(new URL("/login?error=google", origin));
  }
  return NextResponse.redirect(data.url);
}
