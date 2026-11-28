import { NextResponse } from "next/server";
import { tooManyAttempts } from "@/lib/auth";
import { authClient } from "@/lib/supabase";

/**
 * POST /api/auth/resend-code
 * Resends a 6-digit email confirmation code (Task M1, Figma 2, PRD F1).
 * Rate limited to prevent abuse.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  // Rate limit: 4 resend attempts per 10 minutes per email, 10 per IP
  if (
    (await tooManyAttempts(`resend-email:${email}`, 4, 10 * 60_000)) ||
    (await tooManyAttempts(`resend-ip:${ip}`, 10, 10 * 60_000))
  ) {
    return NextResponse.json(
      { error: "Please wait a moment before requesting another code." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  try {
    const supabase = await authClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
    });

    if (error) {
      if (error.code === "over_email_send_rate_limit") {
        return NextResponse.json(
          { error: "Too many emails requested. Please wait a minute before requesting another code." },
          { status: 429 }
        );
      }
      if (error.message.toLowerCase().includes("already confirmed")) {
        return NextResponse.json(
          { error: "This email address is already verified. You can sign in directly.", alreadyConfirmed: true },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: error.message || "Failed to resend verification code. Try again later." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: `A new 6-digit code has been sent to your email.`,
    });
  } catch (err) {
    console.error("[resend-code] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resend code." },
      { status: 500 }
    );
  }
}
