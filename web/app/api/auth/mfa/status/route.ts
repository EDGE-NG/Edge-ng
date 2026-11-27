import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";
import { authClient } from "@/lib/supabase";
import type { StoredBackupCode } from "@/lib/mfa-utils";

/**
 * GET /api/auth/mfa/status
 * Returns authenticator status and remaining backup code counts (Task M8, Figma 77).
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let supabaseFactorOn = false;
  try {
    const supabase = await authClient();
    const { data } = await supabase.auth.mfa.listFactors();
    supabaseFactorOn = Boolean(data?.totp?.some((f) => f.status === "verified"));
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
      backupCodes?: StoredBackupCode[];
    };
  };

  const codes = Array.isArray(settings.two_step?.backupCodes) ? settings.two_step.backupCodes : [];
  const totalCodes = codes.length || 8;
  const remainingCodes = codes.length > 0 ? codes.filter((c) => !c.used).length : 8;

  return NextResponse.json({
    authenticatorOn: Boolean(supabaseFactorOn || settings.two_step?.enabled),
    totalCodes,
    remainingCodes,
  });
}
