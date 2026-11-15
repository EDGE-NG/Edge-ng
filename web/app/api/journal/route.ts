import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rows = await db.all<{
    id: string;
    result: string;
    hard_gate_status: string;
    resolution: string | null;
    decided_at: string;
    resolved_at: string | null;
    reasons: unknown;
    snapshot: unknown;
    instrument: string;
    side: string;
    entry_price: number;
    stop_price: number | null;
    target_price: number | null;
    risk_pct: number | null;
    risk_reward: number | null;
    override_id: string | null;
    rules_overridden: unknown;
    reason_code: string | null;
    reason_text: string | null;
    journal_id: string | null;
    user_notes: string | null;
    lessons: string | null;
    execution_quality: string | null;
  }>(
    `SELECT
       d.id,
       d.result,
       d.hard_gate_status,
       d.resolution,
       d.decided_at,
       d.resolved_at,
       d.reasons,
       d.snapshot,
       i.instrument,
       i.side,
       i.entry_price,
       i.stop_price,
       i.target_price,
       i.risk_pct,
       i.risk_reward,
       o.id AS override_id,
       o.rules_overridden,
       o.reason_code,
       o.reason_text,
       j.id AS journal_id,
       j.user_notes,
       j.lessons,
       j.execution_quality
     FROM gate_decisions d
     JOIN trade_intents i ON i.id = d.intent_id
     LEFT JOIN overrides o ON o.decision_id = d.id
     LEFT JOIN journal_entries j ON j.decision_id = d.id
     WHERE d.user_id = ?
     ORDER BY d.decided_at DESC`,
    user.id
  );

  const entries = rows.map((r) => ({
    id: r.id,
    journalId: r.journal_id,
    instrument: r.instrument,
    side: r.side,
    entryPrice: r.entry_price,
    stopPrice: r.stop_price,
    targetPrice: r.target_price,
    riskPct: r.risk_pct,
    riskReward: r.risk_reward,
    result: r.result,
    hardGateStatus: r.hard_gate_status,
    resolution: r.resolution,
    decidedAt: r.decided_at,
    resolvedAt: r.resolved_at,
    reasons: json(r.reasons, {}),
    snapshot: json(r.snapshot, {}),
    override: r.override_id
      ? {
          id: r.override_id,
          rulesOverridden: json(r.rules_overridden, []),
          reasonCode: r.reason_code,
          reasonText: r.reason_text,
        }
      : null,
    userNotes: r.user_notes ?? "",
    lessons: r.lessons ?? "",
    executionQuality: r.execution_quality ?? null,
  }));

  return NextResponse.json({ entries });
}

