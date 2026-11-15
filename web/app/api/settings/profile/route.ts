import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const profile = await db.one<{
    display_name: string | null;
    timezone: string;
    preferred_markets: string[];
    theme: string;
    locale: string;
    created_at: string;
  }>(
    "SELECT display_name, timezone, preferred_markets, theme, locale, created_at FROM profiles WHERE user_id = ?",
    user.id
  );

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: profile?.display_name ?? user.name ?? "",
      timezone: profile?.timezone ?? user.timezone ?? "UTC",
      preferredMarkets: profile?.preferred_markets ?? [],
      theme: profile?.theme ?? "dark",
      createdAt: profile?.created_at ?? user.created_at,
    },
  });
}

export async function PATCH(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    displayName?: string;
    timezone?: string;
    preferredMarkets?: string[];
  };

  await db.run(
    `UPDATE profiles
     SET display_name = COALESCE(?, display_name),
         timezone = COALESCE(?, timezone),
         preferred_markets = COALESCE(?, preferred_markets),
         updated_at = now()
     WHERE user_id = ?`,
    typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : null,
    typeof body.timezone === "string" ? body.timezone : null,
    Array.isArray(body.preferredMarkets) ? body.preferredMarkets : null,
    user.id
  );

  return NextResponse.json({ ok: true });
}

