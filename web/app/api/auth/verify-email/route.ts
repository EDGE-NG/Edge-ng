import { NextResponse } from "next/server";
import { clearAttempts, tooManyAttempts } from "@/lib/auth";
import { db } from "@/lib/db";
import { authClient } from "@/lib/supabase";

/**
 * POST /api/auth/verify-email
 * Verifies email using a 6-digit OTP code (Task M1, Figma 2, PRD F1).
 * Safe against brute-force guessing via rate limiting.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Please enter the 6-digit verification code." }, { status: 400 });
  }

  // Rate limit: 10 attempts per 15 minutes per email, 30 per IP
  if (
    (await tooManyAttempts(`verify:${email}`, 10, 15 * 60_000)) ||
    (await tooManyAttempts(`verify-ip:${ip}`, 30, 15 * 60_000))
  ) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  try {
    const supabase = await authClient();

    // Verify OTP with type: 'signup' (or fallback to 'email')
    let { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });

    if (error && (error.status === 400 || error.message.toLowerCase().includes("type"))) {
      const fallback = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (!fallback.error && fallback.data.user) {
        data = fallback.data;
        error = null;
      }
    }

    if (error || !data.user) {
      return NextResponse.json(
        {
          error:
            error?.message && !error.message.toLowerCase().includes("database")
              ? error.message
              : "That code is invalid or has expired. Check your email or request a new one.",
        },
        { status: 400 }
      );
    }

    // Success: clear rate limit attempts
    await clearAttempts(`verify:${email}`).catch(() => {});

    // Lookup profile for display name
    const p = await db.one<{ display_name: string | null }>(
      "SELECT display_name FROM profiles WHERE user_id = ?",
      data.user.id
    );

    return NextResponse.json({
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: p?.display_name ?? null,
      },
      destination: "/checklist",
    });
  } catch (err) {
    console.error("[verify-email] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed. Try again." },
      { status: 500 }
    );
  }
}
