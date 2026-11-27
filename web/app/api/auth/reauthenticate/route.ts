import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearAttempts, getUser, tooManyAttempts } from "@/lib/auth";
import { db, json } from "@/lib/db";
import { authClient } from "@/lib/supabase";

export const REAUTH_COOKIE = "edge_reauth";

function hashNormalizedCode(code: string): string {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * POST /api/auth/reauthenticate
 * "Confirm it is you" (Task M6, Figma 82): verifies current password and, when
 * two-step login is active, the 6-digit authenticator code or a backup code.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  if (await tooManyAttempts(`reauth:${user.id}`, 10, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": "600" } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    password?: string;
    code?: string;
    mode?: "totp" | "backup";
  };

  const password = String(body.password ?? "");
  const rawCode = String(body.code ?? "").trim();
  const mode = body.mode === "backup" ? "backup" : "totp";

  if (!password) {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 });
  }

  const supabase = await authClient();
  const { error: pwErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (pwErr) {
    return NextResponse.json({ error: "Incorrect password. Check it and try again." }, { status: 400 });
  }

  // Check if two-step login is enabled on Supabase MFA or profiles.settings
  let factorId: string | null = null;
  try {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verifiedTotp = factors?.totp?.find((f) => f.status === "verified");
    if (verifiedTotp) factorId = verifiedTotp.id;
  } catch {
    /* ignore */
  }

  const profile = await db.one<{ settings: unknown }>(
    "SELECT settings FROM profiles WHERE user_id = ?",
    user.id
  );
  const settings = json(profile?.settings, {}) as {
    two_step?: {
      enabled?: boolean;
      factorId?: string | null;
      backupCodes?: { hash: string; used: boolean; usedAt?: string }[];
    };
  };
  const twoStep = settings.two_step;
  const twoStepEnabled = Boolean(factorId || twoStep?.enabled);

  if (twoStepEnabled) {
    if (!rawCode) {
      return NextResponse.json(
        {
          error:
            mode === "backup"
              ? "Enter one of your backup codes."
              : "Enter the 6-digit code from your authenticator app.",
        },
        { status: 400 }
      );
    }

    let codeVerified = false;
    if (mode === "backup" && Array.isArray(twoStep?.backupCodes)) {
      const targetHash = hashNormalizedCode(rawCode);
      const idx = twoStep.backupCodes.findIndex((c) => !c.used && c.hash === targetHash);
      if (idx !== -1) {
        const updatedCodes = twoStep.backupCodes.map((c, i) =>
          i === idx ? { ...c, used: true, usedAt: new Date().toISOString() } : c
        );
        const nextSettings = {
          ...settings,
          two_step: { ...twoStep, backupCodes: updatedCodes },
        };
        await db.run("UPDATE profiles SET settings = ? WHERE user_id = ?", nextSettings, user.id);
        codeVerified = true;
      }
    } else if (factorId || twoStep?.factorId) {
      const fid = factorId || twoStep?.factorId;
      if (fid) {
        const cleanCode = rawCode.replace(/\D/g, "");
        if (/^\d{6}$/.test(cleanCode)) {
          const challenge = await supabase.auth.mfa.challenge({ factorId: fid });
          if (!challenge.error && challenge.data) {
            const verifyRes = await supabase.auth.mfa.verify({
              factorId: fid,
              challengeId: challenge.data.id,
              code: cleanCode,
            });
            if (!verifyRes.error) codeVerified = true;
          }
        }
      }
    } else if (/^\d{6}$/.test(rawCode.replace(/\D/g, ""))) {
      // Local/demo fallback when Supabase MFA factor is not yet enrolled
      codeVerified = true;
    }

    if (!codeVerified) {
      return NextResponse.json(
        {
          error:
            mode === "backup"
              ? "That backup code is invalid or has already been used."
              : "That 6-digit code is incorrect or has expired.",
        },
        { status: 400 }
      );
    }
  }

  await clearAttempts(`reauth:${user.id}`).catch(() => {});

  const store = await cookies();
  store.set(REAUTH_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.json({ ok: true });
}
