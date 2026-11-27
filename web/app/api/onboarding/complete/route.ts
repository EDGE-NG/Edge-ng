import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json, uuid } from "@/lib/db";
import { DISCLAIMER_VERSION } from "@/lib/legal";
import { safeTimeZone } from "@/lib/time";

const ALLOWED_MARKETS = new Set(["forex", "crypto", "indices", "stocks", "futures"]);

/**
 * POST /api/onboarding/complete
 * Saves trader's timezone, preferred market, and disclaimer acceptance (Task M9, Figma 5-7, PRD F1).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    timezone?: string;
    preferredMarket?: string;
    acceptDisclaimer?: boolean;
  };

  if (body.acceptDisclaimer !== true) {
    return NextResponse.json(
      { error: "Please agree to the Edge decision-support notice to continue." },
      { status: 400 }
    );
  }

  const tz = safeTimeZone(body.timezone);
  const market = String(body.preferredMarket ?? "forex").trim().toLowerCase();
  const preferredMarkets = ALLOWED_MARKETS.has(market) ? [market] : ["forex"];

  const profile = await db.one<{ settings: unknown }>(
    "SELECT settings FROM profiles WHERE user_id = ?",
    user.id
  );
  const settings = json(profile?.settings, {}) as Record<string, unknown>;
  settings.onboardingCompleted = true;
  settings.onboardingCompletedAt = new Date().toISOString();

  await db.tx(async (t) => {
    await t.run(
      `UPDATE profiles
       SET timezone = ?, preferred_markets = ?, settings = ?
       WHERE user_id = ?`,
      tz,
      preferredMarkets,
      settings,
      user.id
    );
    await t.run(
      `INSERT INTO legal_acceptances (id, user_id, document_type, document_version)
       VALUES (?, ?, 'disclaimer', ?)`,
      uuid(),
      user.id,
      DISCLAIMER_VERSION
    );
  });

  return NextResponse.json({
    ok: true,
    destination: "/checklist",
  });
}
