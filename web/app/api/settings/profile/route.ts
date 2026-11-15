import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";

const MAX_AVATAR_BYTES = 200 * 1024; // 200 KB
const ALLOWED_AVATAR_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/webp;base64,",
];

function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string" || tz.length > 100) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

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
    settings: unknown;
  }>(
    "SELECT display_name, timezone, preferred_markets, theme, locale, created_at, settings FROM profiles WHERE user_id = ?",
    user.id
  );

  const settings = json(profile?.settings, {}) as { avatarUrl?: string };

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: profile?.display_name ?? user.name ?? "",
      timezone: profile?.timezone ?? user.timezone ?? "UTC",
      preferredMarkets: profile?.preferred_markets ?? [],
      theme: profile?.theme ?? "dark",
      createdAt: profile?.created_at ?? user.created_at,
      avatarUrl: settings.avatarUrl ?? null,
    },
  });
}

export async function PATCH(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    displayName?: unknown;
    timezone?: unknown;
    preferredMarkets?: unknown;
    avatarUrl?: unknown;
  };

  let validatedDisplayName: string | null = null;
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string") {
      return NextResponse.json({ error: "Display name must be a string." }, { status: 400 });
    }
    validatedDisplayName = body.displayName.trim().slice(0, 80);
  }

  let validatedTimezone: string | null = null;
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTimezone(body.timezone)) {
      return NextResponse.json({ error: "Invalid timezone." }, { status: 400 });
    }
    validatedTimezone = body.timezone.trim();
  }

  let validatedMarkets: string[] | null = null;
  if (body.preferredMarkets !== undefined) {
    if (!Array.isArray(body.preferredMarkets)) {
      return NextResponse.json({ error: "Preferred markets must be a list." }, { status: 400 });
    }
    validatedMarkets = body.preferredMarkets
      .filter((m): m is string => typeof m === "string")
      .map((m) => m.trim().slice(0, 50))
      .filter(Boolean)
      .slice(0, 10);
  }

  const curr = await db.one<{ settings: unknown }>("SELECT settings FROM profiles WHERE user_id = ?", user.id);
  const currSettings = json(curr?.settings, {}) as Record<string, unknown>;

  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl === null || body.avatarUrl === "") {
      currSettings.avatarUrl = null;
    } else if (typeof body.avatarUrl === "string") {
      const matchPrefix = ALLOWED_AVATAR_PREFIXES.find((p) => (body.avatarUrl as string).startsWith(p));
      if (!matchPrefix) {
        return NextResponse.json(
          { error: "Avatar must be a PNG, JPEG, or WebP base64 data URL." },
          { status: 400 }
        );
      }
      const base64Data = (body.avatarUrl as string).slice(matchPrefix.length).trim();
      const approxBytes = Math.ceil((base64Data.length * 3) / 4);
      if (approxBytes > MAX_AVATAR_BYTES) {
        return NextResponse.json(
          { error: "Avatar image must be under 200 KB." },
          { status: 400 }
        );
      }
      if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
        return NextResponse.json(
          { error: "Avatar data is not valid base64." },
          { status: 400 }
        );
      }
      currSettings.avatarUrl = body.avatarUrl;
    } else {
      return NextResponse.json(
        { error: "Avatar must be a valid base64 data URL string or null." },
        { status: 400 }
      );
    }
  }

  await db.run(
    `UPDATE profiles
     SET display_name = COALESCE(?, display_name),
         timezone = COALESCE(?, timezone),
         preferred_markets = COALESCE(?, preferred_markets),
         settings = ?,
         updated_at = now()
     WHERE user_id = ?`,
    validatedDisplayName,
    validatedTimezone,
    validatedMarkets,
    currSettings,
    user.id
  );

  return NextResponse.json({ ok: true });
}


