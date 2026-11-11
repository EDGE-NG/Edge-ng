import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export interface NotificationPrefs {
  reviewComplete: boolean;
  journalReady: boolean;
  dailyDigest: boolean;
  weeklyReview: boolean;
  monthlyReview: boolean;
}

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  reviewComplete: true,
  journalReady: true,
  dailyDigest: false,
  weeklyReview: true,
  monthlyReview: false,
};

interface SettingsRow {
  name: string | null;
  timezone: string;
  settings_json: string | null;
  created_at: string;
}

function parseSettings(row: SettingsRow) {
  let stored: Record<string, unknown> = {};
  try {
    stored = row.settings_json ? (JSON.parse(row.settings_json) as Record<string, unknown>) : {};
  } catch {
    stored = {};
  }
  return {
    notifications: { ...DEFAULT_NOTIFICATIONS, ...(stored.notifications as object) },
    reduceMotion: stored.reduceMotion === true,
  };
}

/** GET -> profile, timezone, notification preferences, email delivery status. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const row = db
    .prepare("SELECT name, timezone, settings_json, created_at FROM users WHERE id = ?")
    .get(user.id) as unknown as SettingsRow | undefined;
  if (!row) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const settings = parseSettings(row);
  return NextResponse.json({
    email: user.email,
    name: row.name,
    timezone: row.timezone,
    createdAt: row.created_at,
    notifications: settings.notifications,
    reduceMotion: settings.reduceMotion,
    mailgunConfigured: Boolean(
      process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN
    ),
  });
}

/** PATCH { name?, timezone?, notifications?, reduceMotion? } -> saves settings. */
export async function PATCH(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    timezone?: string;
    notifications?: Partial<NotificationPrefs>;
    reduceMotion?: boolean;
  };

  const row = db
    .prepare("SELECT name, timezone, settings_json FROM users WHERE id = ?")
    .get(user.id) as unknown as SettingsRow | undefined;
  const current = parseSettings(
    (row ?? { name: null, timezone: "UTC", settings_json: null }) as SettingsRow
  );

  const next = {
    notifications: { ...current.notifications, ...(body.notifications ?? {}) },
    reduceMotion: body.reduceMotion ?? current.reduceMotion,
  };

  const name =
    body.name !== undefined
      ? body.name.trim().slice(0, 80) || null
      : (row?.name ?? null);
  const timezone =
    body.timezone !== undefined && body.timezone.length <= 64
      ? body.timezone
      : (row?.timezone ?? "UTC");

  db.prepare("UPDATE users SET name = ?, timezone = ?, settings_json = ? WHERE id = ?").run(
    name,
    timezone,
    JSON.stringify(next),
    user.id
  );

  return NextResponse.json({ ok: true, name, timezone, ...next });
}
