import { NextResponse } from "next/server";
import { PASSWORD_MIN } from "@/lib/auth";
import { authClient } from "@/lib/supabase";

function isRecoverySession(token?: string | null): boolean {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const amr = payload.amr;
    if (Array.isArray(amr)) {
      return amr.some((entry: unknown) => {
        if (typeof entry === "string") return entry === "recovery";
        if (entry && typeof entry === "object" && "method" in entry) {
          return (entry as { method: string }).method === "recovery";
        }
        return false;
      });
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * POST { password, currentPassword? } -> updates the user's password (PRD F1, REQ-ID-1).
 * Allowed without currentPassword only if authenticated via a password recovery session.
 * For general signed-in sessions, currentPassword is required.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    password?: string;
    currentPassword?: string;
  };
  const password = String(body.password ?? "");
  const currentPassword = String(body.currentPassword ?? "");

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
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    if (!session || !user) {
      return NextResponse.json(
        { error: "Your reset session is invalid or has expired. Please request a new link." },
        { status: 401 }
      );
    }

    const isRecovery = isRecoverySession(session.access_token);

    if (!isRecovery) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required to change your password." },
          { status: 400 }
        );
      }
      if (!user.email) {
        return NextResponse.json({ error: "User email not found." }, { status: 400 });
      }
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (verifyErr) {
        return NextResponse.json(
          { error: "Incorrect current password." },
          { status: 400 }
        );
      }
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
