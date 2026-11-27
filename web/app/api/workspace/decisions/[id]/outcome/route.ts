import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, type Db } from "@/lib/db";
import { findInstrument } from "@/lib/market";
import { confirmExit, outcomeR, pnlMinor, riskCurrency, toTradeView, type ConfirmInput, type TradeRow } from "@/lib/outcome";
import { ticketStyle } from "@/lib/platforms";
import { openTrade } from "@/lib/trade-watch";

/**
 * A placed trade and its outcome (Task D5; flow by Daniel, 2026-11-27).
 *
 *  GET -> { trade: TradeView | null }
 *  PUT { result: "win" | "loss" | "break_even", exitPrice?, note? } -> { trade }
 *      The trader confirms how the trade ended, after Edge saw it reach the
 *      take profit or stop loss, or closes it by hand from the journal. Edge
 *      then logs it: the exit price, the result in R, and the P&L in minor
 *      units plus currency when the ticket's risk amount was in a known
 *      currency (PRD 9.2). Saving again corrects it.
 *
 * Only trades the trader placed have an outcome; a trade that was never taken
 * has none.
 */

const TRADE_COLS = `t.id, t.side, t.status, t.entry_price, t.stop_price, t.target_price, t.exit_price,
  t.outcome_r, t.pnl_minor, t.currency, t.notes, t.closed_at`;

function findTrade(conn: Db, decisionId: string, userId: string) {
  return conn.one<TradeRow>(
    `SELECT ${TRADE_COLS} FROM trades t WHERE t.decision_id = ? AND t.user_id = ? ORDER BY t.created_at LIMIT 1`,
    decisionId,
    userId
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const d = await db.one<{ id: string }>("SELECT id FROM gate_decisions WHERE id = ? AND user_id = ?", id, user.id);
  if (!d) return NextResponse.json({ error: "Decision not found." }, { status: 404 });
  return NextResponse.json({ trade: toTradeView(await findTrade(db, id, user.id)) });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as ConfirmInput;

  const out = await db.tx(async (t) => {
    // Lock the decision: two saves at once are applied one after the other.
    const d = await t.one<{ id: string; resolution: string | null; instrument: string; platform: string | null; risk_amount: number | null }>(
      `SELECT d.id, d.resolution, i.instrument, d.snapshot->'order'->>'platform' AS platform, i.risk_amount
       FROM gate_decisions d JOIN trade_intents i ON i.id = d.intent_id
       WHERE d.id = ? AND d.user_id = ? AND i.user_id = ?
       FOR UPDATE OF d`,
      id,
      user.id,
      user.id
    );
    if (!d) return { status: 404 as const, error: "Decision not found." };
    if (d.resolution !== "placed") return { status: 409 as const, error: "Only a trade you placed has an outcome." };

    // Trades placed before Edge opened them at placement get one now.
    let row = await findTrade(t, d.id, user.id);
    if (!row) {
      await openTrade(t, d.id, user.id);
      row = await findTrade(t, d.id, user.id);
    }
    const view = toTradeView(row);
    if (!row || !view) return { status: 409 as const, error: "This trade can't be closed." };

    const checked = confirmExit(row, view.state, body);
    if (!checked.ok) return { status: 422 as const, error: checked.error };

    const r = outcomeR(row.side, row.entry_price, row.stop_price, checked.exit);
    const label = findInstrument(d.instrument)?.label ?? d.instrument;
    const currency = riskCurrency(ticketStyle(d.platform ?? ""), label);
    const pnl = pnlMinor(r, d.risk_amount, currency);
    await t.run(
      `UPDATE trades SET status = 'closed', exit_price = ?, outcome_r = ?, pnl_minor = ?, currency = ?, notes = ?,
              closed_at = COALESCE(closed_at, now())
       WHERE id = ? AND user_id = ?`,
      checked.exit,
      r,
      pnl,
      pnl == null ? null : currency,
      checked.note,
      row.id,
      user.id
    );
    // Link the journal entry, if the trader already wrote one for this decision.
    await t.run(
      "UPDATE journal_entries SET trade_id = ? WHERE decision_id = ? AND user_id = ? AND trade_id IS NULL",
      row.id,
      d.id,
      user.id
    );
    return { status: 200 as const, trade: toTradeView(await findTrade(t, d.id, user.id)) };
  });

  if (out.status !== 200) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ trade: out.trade });
}
