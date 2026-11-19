import { NextResponse } from "next/server";
import { getMonitor, MAX_MONITORS, MONITOR_TIMEFRAMES, monitorView } from "@/lib/alerts";
import { getUser } from "@/lib/auth";
import { db, uuid } from "@/lib/db";
import { findInstrument, providerReady, type Timeframe } from "@/lib/market";

/** POST { edgeId, instrument, timeframe } -> start watching an instrument with a checklist. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { edgeId?: string; instrument?: string; timeframe?: string };

  const inst = findInstrument(String(b.instrument ?? ""));
  if (!inst) return NextResponse.json({ error: "Pick an instrument." }, { status: 400 });
  if (!providerReady(inst)) {
    return NextResponse.json({ error: `Prices for ${inst.label} aren't available on this server yet.` }, { status: 409 });
  }
  const tf = b.timeframe as Timeframe;
  if (!MONITOR_TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "Pick a timeframe." }, { status: 400 });

  const edge = await db.one<{ id: string; active_version_id: string | null }>(
    "SELECT id, active_version_id FROM checklists WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    String(b.edgeId ?? ""),
    user.id
  );
  if (!edge) return NextResponse.json({ error: "Pick a checklist." }, { status: 400 });
  if (!edge.active_version_id) {
    return NextResponse.json({ error: "Approve this checklist before Edge can watch with it." }, { status: 409 });
  }

  const count = await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM checklist_monitors WHERE user_id = ?", user.id);
  if ((count?.n ?? 0) >= MAX_MONITORS) {
    return NextResponse.json(
      { error: `You can watch up to ${MAX_MONITORS} instruments. Remove one to add another.` },
      { status: 409 }
    );
  }

  const id = uuid();
  const n = await db.run(
    `INSERT INTO checklist_monitors (id, user_id, checklist_id, instrument, asset_class, timeframe)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, checklist_id, instrument) DO NOTHING`,
    id,
    user.id,
    edge.id,
    inst.symbol,
    inst.assetClass,
    tf
  );
  if (n === 0) {
    return NextResponse.json({ error: `Edge is already watching ${inst.label} with this checklist.` }, { status: 409 });
  }
  return NextResponse.json({ monitor: monitorView((await getMonitor(id, user.id))!) }, { status: 201 });
}
