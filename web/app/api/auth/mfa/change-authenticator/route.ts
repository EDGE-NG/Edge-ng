import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";
import { authClient } from "@/lib/supabase";
import {
  buildFallbackQrSvg,
  formatKey,
  generateTotpSecret,
  getTotpUri,
  verifyTotpCode,
} from "@/lib/mfa-utils";

/**
 * POST /api/auth/mfa/change-authenticator
 * Step "start": generates a new TOTP secret & QR code.
 * Step "confirm": verifies 6-digit code and replaces the old authenticator (Task M8, Figma 86).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: "start" | "confirm";
    factorId?: string;
    secret?: string;
    code?: string;
  };

  if (body.action === "start") {
    let factorId = "";
    let qrSvg = "";
    let secret = "";
    let uri = "";

    try {
      const supabase = await authClient();
      const res = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Edge",
        friendlyName: `Edge Authenticator (${Date.now()})`,
      });
      if (!res.error && res.data) {
        factorId = res.data.id;
        qrSvg = res.data.totp.qr_code;
        secret = res.data.totp.secret;
        uri = res.data.totp.uri;
      }
    } catch {
      /* fallback below */
    }

    if (!secret) {
      secret = generateTotpSecret(16);
      uri = getTotpUri(user.email, secret, "Edge");
      qrSvg = buildFallbackQrSvg(uri);
    }

    return NextResponse.json({
      factorId,
      secret,
      formattedKey: formatKey(secret),
      qrSvg: qrSvg.includes("<svg") ? qrSvg : buildFallbackQrSvg(uri),
    });
  }

  // Confirm replacement
  const code = String(body.code ?? "").replace(/\D/g, "");
  const secret = String(body.secret ?? "").trim();
  const factorId = String(body.factorId ?? "").trim();

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code from your new authenticator." }, { status: 400 });
  }

  let verified = false;
  const supabase = await authClient();

  if (factorId) {
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId });
      if (!ch.error && ch.data) {
        const vr = await supabase.auth.mfa.verify({
          factorId,
          challengeId: ch.data.id,
          code,
        });
        if (!vr.error) {
          verified = true;
          // Unenroll older TOTP factors so the old authenticator stops working immediately
          const { data: list } = await supabase.auth.mfa.listFactors();
          for (const f of list?.totp ?? []) {
            if (f.id !== factorId) {
              await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
            }
          }
        }
      }
    } catch {
      /* fallback below */
    }
  }

  if (!verified && secret) {
    verified = verifyTotpCode(secret, code);
  }

  if (!verified) {
    return NextResponse.json(
      { error: "That 6-digit code is incorrect. Check your new authenticator and try again." },
      { status: 400 }
    );
  }

  const profile = await db.one<{ settings: unknown }>(
    "SELECT settings FROM profiles WHERE user_id = ?",
    user.id
  );
  const settings = json(profile?.settings, {}) as Record<string, any>;
  settings.two_step = {
    ...(settings.two_step ?? {}),
    enabled: true,
    factorId: factorId || null,
    secret: secret || null,
    updatedAt: new Date().toISOString(),
  };
  await db.run("UPDATE profiles SET settings = ? WHERE user_id = ?", settings, user.id);

  return NextResponse.json({ ok: true });
}
