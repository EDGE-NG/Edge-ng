import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";
import { generateBackupCodes, hashBackupCode, type StoredBackupCode } from "@/lib/mfa-utils";

/**
 * GET /api/auth/mfa/backup-codes
 * Returns current backup code status (or generates initial set if none exist yet).
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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

  const existing = settings.two_step?.backupCodes;
  if (!existing || existing.length === 0) {
    const fresh = generateBackupCodes(8);
    const stored: StoredBackupCode[] = fresh.map((code) => ({
      hash: hashBackupCode(code),
      used: false,
      preview: `${code.slice(0, 2)}••-••${code.slice(-2)}`,
      createdAt: new Date().toISOString(),
    }));
    const nextSettings = {
      ...settings,
      two_step: {
        ...(settings.two_step ?? {}),
        enabled: settings.two_step?.enabled ?? true,
        backupCodes: stored,
      },
    };
    await db.run("UPDATE profiles SET settings = ? WHERE user_id = ?", nextSettings, user.id);

    return NextResponse.json({
      total: 8,
      remaining: 8,
      freshlyGenerated: true,
      codes: fresh.map((c) => ({ code: c, used: false })),
    });
  }

  const remaining = existing.filter((c) => !c.used).length;
  return NextResponse.json({
    total: existing.length,
    remaining,
    freshlyGenerated: false,
    codes: existing.map((c, idx) => ({
      code: c.preview ?? `CODE-${String(idx + 1).padStart(2, "0")}••`,
      used: c.used,
    })),
  });
}

/**
 * POST /api/auth/mfa/backup-codes
 * Generates 8 fresh backup codes and invalidates any remaining old ones (Task M8, Figma 84 & 85).
 */
export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const profile = await db.one<{ settings: unknown }>(
    "SELECT settings FROM profiles WHERE user_id = ?",
    user.id
  );
  const settings = json(profile?.settings, {}) as Record<string, any>;

  const fresh = generateBackupCodes(8);
  const stored: StoredBackupCode[] = fresh.map((code) => ({
    hash: hashBackupCode(code),
    used: false,
    preview: `${code.slice(0, 2)}••-••${code.slice(-2)}`,
    createdAt: new Date().toISOString(),
  }));

  settings.two_step = {
    ...(settings.two_step ?? {}),
    enabled: true,
    backupCodes: stored,
    updatedAt: new Date().toISOString(),
  };

  await db.run("UPDATE profiles SET settings = ? WHERE user_id = ?", settings, user.id);

  return NextResponse.json({
    ok: true,
    total: 8,
    remaining: 8,
    freshlyGenerated: true,
    codes: fresh.map((c) => ({ code: c, used: false })),
  });
}
