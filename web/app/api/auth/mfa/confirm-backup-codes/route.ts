import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";

/**
 * POST /api/auth/mfa/confirm-backup-codes
 * Confirms that the trader has saved their backup codes (Task M2, Figma 4).
 */
export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  }

  const profile = await db.one<{ settings: unknown }>(
    "SELECT settings FROM profiles WHERE user_id = ?",
    user.id
  );
  const currentSettings = json(profile?.settings, {}) as Record<string, any>;

  if (currentSettings.two_step) {
    currentSettings.two_step.acknowledged = true;
    currentSettings.two_step.acknowledgedAt = new Date().toISOString();

    await db.run(
      "UPDATE profiles SET settings = ? WHERE user_id = ?",
      currentSettings,
      user.id
    );
  }

  return NextResponse.json({
    ok: true,
    destination: "/checklist",
  });
}
