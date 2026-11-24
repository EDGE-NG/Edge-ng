import { NextResponse } from "next/server";
import { PASSWORD_MIN } from "@/lib/auth";
import { authClient } from "@/lib/supabase";

/**
 * POST { password } -> updates the current authenticated user's password (PRD F1, REQ-ID-1).
 * Requires the trader to be authenticated (e.g. following a valid recovery link or active session).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const password = String(body.password ?? "");

  if (password.length < PASSWORD_MIN) {
    return NextResponse.json(
      { error: `Password must be at least ${PASSWORD_MIN} characters long.` },
      { status: 400 }
    );
  }

  if (password.length > 200) {
    return NextResponse.json({ error: "That password is too long." }, { status: 400 });
  }

  try {
    const supabase = await authClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Your reset session is invalid or has expired. Please request a new link." },
        { status: 401 }
      );
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      console.error("[update-password] Supabase error:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update password. Please try again." },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[update-password] Unexpected error:", err);
    return NextResponse.json({ error: "Failed to update password. Please try again." }, { status: 500 });
  }
}
