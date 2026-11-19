import { NextResponse } from "next/server";
import { MAX_MONITORS, MONITOR_TIMEFRAMES, monitorView, type MonitorRow } from "@/lib/alerts";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";
import { INSTRUMENTS, providerReady } from "@/lib/market";
import { alertPrefs, emailConfigured, pushConfigured, vapidPublicKey } from "@/lib/notify";

/**
 * GET -> everything the Alerts page needs: the trader's monitors, recent
 * alerts, approved checklists, instruments, and notification settings.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [monitors, events, checklists, prefs, devices] = await Promise.all([
    db.all<MonitorRow & { checklist_name: string | null }>(
      `SELECT m.*, c.name AS checklist_name FROM checklist_monitors m
       LEFT JOIN checklists c ON c.id = m.checklist_id AND c.user_id = m.user_id
       WHERE m.user_id = ? ORDER BY m.created_at`,
      user.id
    ),
    db.all<Record<string, unknown>>(
      `SELECT id, monitor_id, checklist_id, instrument, timeframe, last_price, summary, deliveries, created_at, read_at
       FROM alert_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      user.id
    ),
    db.all(
      `SELECT e.id AS "edgeId", e.name, v.version_number AS "versionNumber"
       FROM checklists e JOIN checklist_versions v ON v.id = e.active_version_id
       WHERE e.user_id = ? AND e.deleted_at IS NULL ORDER BY e.updated_at DESC`,
      user.id
    ),
    alertPrefs(user.id),
    db.one<{ n: number }>("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?", user.id),
  ]);

  return NextResponse.json({
    monitors: monitors.map(monitorView),
    events: events.map((e) => ({
      id: e.id,
      monitorId: e.monitor_id,
      edgeId: e.checklist_id,
      instrument: e.instrument,
      label: INSTRUMENTS.find((i) => i.symbol === e.instrument)?.label ?? e.instrument,
      timeframe: e.timeframe,
      lastPrice: e.last_price,
      summary: json(e.summary, null),
      deliveries: json(e.deliveries, {}),
      createdAt: e.created_at,
      readAt: e.read_at,
    })),
    checklists,
    instruments: INSTRUMENTS.map((i) => ({ symbol: i.symbol, label: i.label, assetClass: i.assetClass, ready: providerReady(i) })),
    timeframes: MONITOR_TIMEFRAMES,
    maxMonitors: MAX_MONITORS,
    prefs,
    channels: {
      push: { configured: pushConfigured(), publicKey: vapidPublicKey(), devices: devices?.n ?? 0 },
      email: { configured: emailConfigured(), address: user.email },
    },
  });
}
