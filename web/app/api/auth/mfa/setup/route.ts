import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { authClient } from "@/lib/supabase";
import { formatKey, generateTotpSecret, getTotpUri } from "@/lib/totp";

/**
 * GET /api/auth/mfa/setup
 * Starts Two-Step login enrollment (Task M2, Figma 3).
 * Returns TOTP secret, formatted key, URI, and QR code SVG.
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to set up two-step login." }, { status: 401 });
  }

  let factorId = "";
  let qrCode = "";
  let secret = "";
  let uri = "";

  try {
    const supabase = await authClient();
    const res = await supabase.auth.mfa.enroll({
      factorType: "totp",
      issuer: "Edge",
      friendlyName: "Edge Authenticator",
    });

    if (!res.error && res.data) {
      factorId = res.data.id;
      qrCode = res.data.totp.qr_code;
      secret = res.data.totp.secret;
      uri = res.data.totp.uri;
    }
  } catch (err) {
    console.warn("[mfa-setup] Supabase MFA enrollment unavailable, using local generator:", err);
  }

  // Fallback to local TOTP generation if Supabase GoTrue MFA is not configured
  if (!secret) {
    secret = generateTotpSecret(16);
    uri = getTotpUri(user.email, secret, "Edge");
  }

  return NextResponse.json({
    ok: true,
    factorId,
    secret,
    formattedKey: formatKey(secret),
    uri,
    qrCode,
    email: user.email,
  });
}
