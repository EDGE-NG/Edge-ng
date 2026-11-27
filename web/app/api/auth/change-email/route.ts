import { NextResponse } from "next/server";
import { getUser, tooManyAttempts } from "@/lib/auth";
import { authClient } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/change-email
 * Verifies current password and initiates an email change via Supabase Auth (Task M7, Figma 81).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  if (await tooManyAttempts(`change-email:${user.id}`, 6, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many email change requests. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    newEmail?: string;
    currentPassword?: string;
  };

  const newEmail = String(body.newEmail ?? "").trim().toLowerCase();
  const currentPassword = String(body.currentPassword ?? "");

  if (!newEmail || !EMAIL_RE.test(newEmail)) {
    return NextResponse.json({ error: "Please enter a valid new email address." }, { status: 400 });
  }
  if (newEmail === user.email.toLowerCase()) {
    return NextResponse.json({ error: "Enter a different email address than your current one." }, { status: 400 });
  }
  if (!currentPassword) {
    return NextResponse.json({ error: "Enter your current password." }, { status: 400 });
  }

  const supabase = await authClient();
  const { error: pwErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (pwErr) {
    return NextResponse.json({ error: "Incorrect current password." }, { status: 400 });
  }

  const { error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) {
    if (error.code === "over_email_send_rate_limit") {
      return NextResponse.json(
        { error: "Too many emails sent right now. Please wait a moment and try again." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: error.message || "Could not send verification code to that email." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, newEmail });
}
