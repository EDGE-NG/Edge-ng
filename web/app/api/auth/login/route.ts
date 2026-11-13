import { NextResponse } from "next/server";
import { clearAttempts, tooManyAttempts } from "@/lib/auth";
import { db } from "@/lib/db";
import { authClient } from "@/lib/supabase";

const NEUTRAL = "That email and password don't match. Check them and try again.";

/** POST { email, password } -> sign in with Supabase Auth (PRD F1, REQ-ID-1). */
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

  const supabase = await authClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error?.code === "email_not_confirmed") {
      return NextResponse.json(
        { error: "Confirm your email first: open the link we sent you, then sign in.", code: "unconfirmed" },
        { status: 403 }
      );
    }
    // Same reply whether or not the email exists (no account enumeration, EC-A1/A3).
    return NextResponse.json({ error: NEUTRAL }, { status: 401 });
  }

  clearAttempts(`login:${email}`);
  const p = await db.one<{ display_name: string | null }>(
    "SELECT display_name FROM profiles WHERE user_id = ?",
    data.user.id
  );
  return NextResponse.json({ user: { id: data.user.id, email: data.user.email, name: p?.display_name ?? null } });
}
