import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearAttempts, getUser, tooManyAttempts } from "@/lib/auth";
import { db, json } from "@/lib/db";
import { authClient } from "@/lib/supabase";
import { consumeBackupCode, TWO_STEP_PENDING_COOKIE, verifyTotpCode } from "@/lib/totp";
import { getUserTwoStepConfig } from "@/lib/two-step";

/**
 * POST /api/auth/mfa/challenge
 * Verifies a 6-digit authenticator code or a single-use backup code at sign-in (Task M3, Figma 11).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  if (await tooManyAttempts(`mfa-challenge:${user.id}`, 10, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    mode?: "totp" | "backup";
  };

  const rawCode = String(body.code ?? "").trim();
  const mode = body.mode === "backup" ? "backup" : "totp";

  const supabase = await authClient();
  const { enabled, factorId, twoStep } = await getUserTwoStepConfig(user.id, supabase);

  if (!enabled) {
    // User does not have 2FA enabled; clear any stale pending cookie and allow through
    const store = await cookies();
    store.delete(TWO_STEP_PENDING_COOKIE);
    return NextResponse.json({ ok: true, destination: "/checklist" });
  }

  let verified = false;

  if (mode === "backup") {
    const cleanBackup = rawCode.replace(/[^a-zA-Z0-9]/g, "");
    if (cleanBackup.length < 6) {
      return NextResponse.json({ error: "Enter one of your 8-character backup codes." }, { status: 400 });
    }

    const result = consumeBackupCode(twoStep.backupCodes ?? [], rawCode);
    if (!result.matched) {
      return NextResponse.json(
        { error: "That backup code is invalid or has already been used." },
        { status: 400 }
      );
    }

    // Persist the consumed backup code (one use each)
    const profile = await db.one<{ settings: unknown }>(
      "SELECT settings FROM profiles WHERE user_id = ?",
      user.id
    );
    const currentSettings = json(profile?.settings, {}) as Record<string, unknown>;
    currentSettings.two_step = {
      ...twoStep,
      backupCodes: result.updatedCodes,
    };
    await db.run("UPDATE profiles SET settings = ? WHERE user_id = ?", currentSettings, user.id);
    verified = true;
  } else {
    const cleanCode = rawCode.replace(/\D/g, "");
    if (!/^\d{6}$/.test(cleanCode)) {
      return NextResponse.json({ error: "Please enter the 6-digit code from your authenticator app." }, { status: 400 });
    }

    // 1. Try Supabase GoTrue MFA verification if factorId is present
    if (factorId) {
      try {
        const challenge = await supabase.auth.mfa.challenge({ factorId });
        if (!challenge.error && challenge.data) {
          const res = await supabase.auth.mfa.verify({
            factorId,
            challengeId: challenge.data.id,
            code: cleanCode,
          });
          if (!res.error) {
            verified = true;
          }
        }
      } catch (err) {
        console.warn("[mfa-challenge] Supabase MFA verify error:", err);
      }
    }

    // 2. Fallback to stored TOTP secret verification
    if (!verified && twoStep.secret) {
      verified = verifyTotpCode(twoStep.secret, cleanCode);
    }

    if (!verified) {
      return NextResponse.json(
        { error: "That code is incorrect or has expired. Check your authenticator app and try again." },
        { status: 400 }
      );
    }
  }

  await clearAttempts(`mfa-challenge:${user.id}`).catch(() => {});
  const store = await cookies();
  store.delete(TWO_STEP_PENDING_COOKIE);

  return NextResponse.json({
    ok: true,
    destination: "/checklist",
  });
}
