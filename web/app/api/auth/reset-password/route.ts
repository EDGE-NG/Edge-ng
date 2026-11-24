import { NextResponse } from "next/server";
import { tooManyAttempts } from "@/lib/auth";
import { authClient } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST { email } -> sends a password recovery email via Supabase Auth (PRD F1, REQ-ID-1).
 * Safe against account enumeration: returns 200 with the same confirmation message
 * regardless of whether the email is registered.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (tooManyAttempts(`reset:${ip}`, 6, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many password reset requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  try {
    const supabase = await authClient();
    const origin = new URL(req.url).origin;
    const redirectTo = `${origin}/auth/callback?next=/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      if (error.code === "over_email_send_rate_limit") {
        return NextResponse.json(
          { error: "Too many emails sent right now. Please wait a few minutes before trying again." },
          { status: 429 }
        );
      }
      console.error("[reset-password] Supabase error:", error);
    }
  } catch (err) {
    console.error("[reset-password] Unexpected error:", err);
  }

  // Always return success to protect against email enumeration
  return NextResponse.json({
    ok: true,
    message: "If an account exists for this email, we've sent password reset instructions.",
  });
}
