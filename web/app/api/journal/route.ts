import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";
import { toTradeView } from "@/lib/outcome";
import { watchTrades } from "@/lib/trade-watch";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Look for reached stop losses and take profits first, so the journal is up to date
  // even between scheduler runs (Task D5). Best effort: the journal loads either way.
  await watchTrades({ userId: user.id, budgetMs: 4_000 }).catch((err) => console.error("[journal] trade watch failed:", err));

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
    trade_id: string | null;
    trade_status: "open" | "closed" | "cancelled" | null;
    pnl_minor: number | null;
    currency: string | null;
    exit_price: number | null;
    outcome_r: number | null;
    trade_notes: string | null;
    closed_at: string | null;
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
       j.execution_quality,
       t.id AS trade_id,
       t.status AS trade_status,
       t.pnl_minor,
       t.currency,
       t.exit_price,
       t.outcome_r,
       t.notes AS trade_notes,
       t.closed_at
     FROM gate_decisions d
     JOIN trade_intents i ON i.id = d.intent_id
     LEFT JOIN overrides o ON o.decision_id = d.id
     LEFT JOIN journal_entries j ON j.decision_id = d.id
     LEFT JOIN LATERAL (
       SELECT id, status, pnl_minor, currency, exit_price, outcome_r, notes, closed_at FROM trades
       WHERE decision_id = d.id AND user_id = d.user_id ORDER BY created_at LIMIT 1
     ) t ON true
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
    // Task D5: the placed trade Edge watches, and how it ended.
    trade: r.trade_id
      ? toTradeView({
          id: r.trade_id,
          side: r.side as "buy" | "sell",
          status: r.trade_status ?? "open",
          entry_price: r.entry_price,
          stop_price: r.stop_price,
          target_price: r.target_price,
          exit_price: r.exit_price,
          outcome_r: r.outcome_r,
          pnl_minor: r.pnl_minor,
          currency: r.currency,
          notes: r.trade_notes,
          closed_at: r.closed_at,
        })
      : null,
  }));

  return NextResponse.json({ entries });
}

