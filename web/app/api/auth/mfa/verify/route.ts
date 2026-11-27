import { NextResponse } from "next/server";
import { getUser, tooManyAttempts } from "@/lib/auth";
import { db, json } from "@/lib/db";
import { authClient } from "@/lib/supabase";
import { generateBackupCodes, hashBackupCode, verifyTotpCode } from "@/lib/totp";

/**
 * POST /api/auth/mfa/verify
 * Verifies TOTP code, enables two-step login, and generates 8 backup codes (Task M2, Figma 3 & 4).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    factorId?: string;
    secret?: string;
    code?: string;
  };

  const code = String(body.code ?? "").trim();
  const secret = String(body.secret ?? "").trim();
  const factorId = String(body.factorId ?? "").trim();

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Please enter a valid 6-digit code." }, { status: 400 });
  }

  if (await tooManyAttempts(`mfa-verify:${user.id}`, 8, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  let isValid = false;

  // 1. Try Supabase GoTrue challengeAndVerify if factorId is provided
  if (factorId) {
    try {
      const supabase = await authClient();
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (!challenge.error && challenge.data) {
        const verifyRes = await supabase.auth.mfa.verify({
          factorId,
          challengeId: challenge.data.id,
          code,
        });
        if (!verifyRes.error) {
          isValid = true;
        }
      }
    } catch (err) {
      console.warn("[mfa-verify] Supabase verification error:", err);
    }
  }

  // 2. Fallback to local TOTP verification if secret is provided
  if (!isValid && secret) {
    isValid = verifyTotpCode(secret, code);
  }

  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid code. Check your authenticator app and try again." },
      { status: 400 }
    );
  }

  // Generate 8 backup codes in XXXX-XXXX format (Figma Screen 4)
  const backupCodes = generateBackupCodes(8);

  // Store two_step configuration and hashed backup codes in profiles.settings
  const profile = await db.one<{ settings: unknown }>(
    "SELECT settings FROM profiles WHERE user_id = ?",
    user.id
  );
  const currentSettings = json(profile?.settings, {}) as Record<string, unknown>;

  const twoStepConfig = {
    enabled: true,
    factorId: factorId || null,
    secret: secret || null,
    backupCodes: backupCodes.map((c) => ({
      hash: hashBackupCode(c),
      used: false,
      createdAt: new Date().toISOString(),
    })),
    enabledAt: new Date().toISOString(),
    acknowledged: false,
  };

  currentSettings.two_step = twoStepConfig;

  await db.run(
    "UPDATE profiles SET settings = ? WHERE user_id = ?",
    currentSettings,
    user.id
  );

  return NextResponse.json({
    ok: true,
    backupCodes,
  });
}
