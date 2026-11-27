import { NextResponse } from "next/server";
import { clearAttempts, getUser, tooManyAttempts } from "@/lib/auth";
import { authClient } from "@/lib/supabase";

/**
 * POST /api/auth/verify-email-change
 * Confirms the 6-digit code sent to the new email address (Task M7, Figma 81).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  if (await tooManyAttempts(`verify-email-change:${user.id}`, 10, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    newEmail?: string;
    code?: string;
  };
  const newEmail = String(body.newEmail ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();

  if (!newEmail || !newEmail.includes("@")) {
    return NextResponse.json({ error: "New email address is required." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Please enter the 6-digit code." }, { status: 400 });
  }

  const supabase = await authClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email: newEmail,
    token: code,
    type: "email_change",
  });

  if (error) {
    return NextResponse.json(
      { error: "That code is invalid or has expired. Check your new inbox or request a new code." },
      { status: 400 }
    );
  }

  await clearAttempts(`verify-email-change:${user.id}`).catch(() => {});

  return NextResponse.json({
    ok: true,
    email: data.user?.email ?? newEmail,
  });
}
