import { NextResponse } from "next/server";
import { getMonitor, MONITOR_TIMEFRAMES, monitorView } from "@/lib/alerts";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Timeframe } from "@/lib/market";

/** PATCH { status?: "active" | "paused", timeframe? } -> pause, resume or change a monitor. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const m = await getMonitor(id, user.id);
  if (!m) return NextResponse.json({ error: "Alert not found." }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { status?: string; timeframe?: string };
  const status = b.status === "active" || b.status === "paused" ? b.status : m.status;
  const tf = b.timeframe === undefined ? m.timeframe : (b.timeframe as Timeframe);
  if (!MONITOR_TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "Pick a timeframe." }, { status: 400 });

  // resuming or changing the timeframe checks again straight away, from a clean slate
  const restart = (status === "active" && m.status === "paused") || tf !== m.timeframe;
  await db.run(
    `UPDATE checklist_monitors SET status = ?, timeframe = ?,
       last_error = CASE WHEN ? THEN NULL ELSE last_error END,
       next_check_at = CASE WHEN ? THEN now() ELSE next_check_at END,
       checked_periods = CASE WHEN ? THEN '{}'::jsonb ELSE checked_periods END,
       last_state = CASE WHEN ? THEN 'unknown' ELSE last_state END,
       updated_at = now()
     WHERE id = ? AND user_id = ?`,
    status,
    tf,
    restart,
    restart,
    restart,
    restart,
    id,
    user.id
  );
  return NextResponse.json({ monitor: monitorView((await getMonitor(id, user.id))!) });
}

/** DELETE -> stop watching. Past alerts stay in the history. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const m = await getMonitor(id, user.id);
  if (!m) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  await db.tx(async (t) => {
    if (m.session_id) {
      await t.run(
        "UPDATE workspace_sessions SET ended_at = now() WHERE id = ? AND user_id = ? AND ended_at IS NULL",
        m.session_id,
        user.id
      );
    }
    await t.run("DELETE FROM checklist_monitors WHERE id = ? AND user_id = ?", id, user.id);
  });
  return NextResponse.json({ ok: true });
}
