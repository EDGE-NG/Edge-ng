/**
 * Edge watches placed trades (Task D5; flow by Daniel, 2026-11-27).
 *
 *  1. "I placed this trade" opens a `trades` row from the ticket: entry, stop
 *     loss, take profit (openTrade).
 *  2. Every few minutes the scheduler (/api/alerts/run) runs watchTrades: for
 *     each open trade with a stop loss or take profit, Edge reads its own
 *     candles and looks for the first level the price reached
 *     (lib/trade-levels.ts). Opening the journal runs it too, for that trader.
 *  3. On a hit, the level is stored on the trade (exit_price, closed_at; the
 *     trade stays open) and the trader is told once, by push and email. The
 *     link opens the trade in the journal, where they confirm Profit, Loss or
 *     Break even. Spreads differ by broker, so Edge never closes a trade on
 *     its own reading.
 */
import { db, uuid, type Db } from "./db";
import { findInstrument, getCandles, MarketError } from "./market";
import { appUrl, notifyUser } from "./notify";
import { LEVEL_LABEL, type HitLevel } from "./outcome";
import { findLevelHit, watchTimeframe, WATCH_CANDLES, type WatchedTrade } from "./trade-levels";

/** Order types that wait for the price to reach the entry. */
const PENDING_TYPES = new Set(["pending", "limit", "stop", "stop_limit"]);
/** Trades checked per run at most (market-data cost). */
const MAX_PER_RUN = 200;

/**
 * Open the trade for a decision the trader just placed. Call it in the same
 * transaction that marks the decision placed. Does nothing if one exists.
 */
export async function openTrade(t: Db, decisionId: string, userId: string): Promise<void> {
  await t.run(
    `INSERT INTO trades (id, user_id, decision_id, side, status, opened_at, entry_price, stop_price, target_price,
                         size, risk_pct, source)
     SELECT ?, d.user_id, d.id, i.side, 'open', now(), i.entry_price, i.stop_price, i.target_price,
            COALESCE(i.size, CASE WHEN jsonb_typeof(d.snapshot->'order'->'size') = 'number'
                                  THEN (d.snapshot->'order'->>'size')::numeric END),
            i.risk_pct, 'manual'
     FROM gate_decisions d JOIN trade_intents i ON i.id = d.intent_id
     WHERE d.id = ? AND d.user_id = ? AND i.user_id = ?
       AND NOT EXISTS (SELECT 1 FROM trades x WHERE x.decision_id = d.id AND x.user_id = d.user_id)`,
    uuid(),
    decisionId,
    userId,
    userId
  );
}

interface OpenRow {
  id: string;
  user_id: string;
  decision_id: string;
  side: "buy" | "sell";
  entry_price: number;
  stop_price: number | null;
  target_price: number | null;
  opened_at: string;
  instrument: string;
  order_type: string | null;
}

export interface WatchResult {
  tradeId: string;
  hit: HitLevel | null;
  error?: string;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function levelMessage(label: string, side: "buy" | "sell", level: HitLevel, price: number, decisionId: string) {
  const what = LEVEL_LABEL[level];
  const title = `${label} ${side}: ${what} reached`;
  const body = `Edge saw the price reach your ${what} at ${price}. Confirm how the trade ended to log it in your journal.`;
  const path = `/app/journal?trade=${decisionId}`;
  const link = appUrl(path);
  const text = [
    `Your ${label} ${side} reached your ${what} at ${price}.`,
    "",
    "Spreads differ between brokers, so Edge asks before logging anything. Confirm whether it ended in profit, loss or break even:",
    link,
  ].join("\n");
  const html =
    `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">` +
    `<p>Your <strong>${esc(label)} ${side}</strong> reached your ${what} at <strong>${esc(String(price))}</strong>.</p>` +
    `<p>Spreads differ between brokers, so Edge asks before logging anything.</p>` +
    `<p><a href="${esc(link)}" style="display:inline-block;background:#5ef088;color:#04110a;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Confirm the outcome</a></p></div>`;
  return { title, body, path, tag: `trade-${decisionId}`, email: { subject: title, text, html } };
}

/**
 * Check open trades for a reached take profit or stop loss. With `userId`,
 * only that trader's (the journal); without, everyone's (the scheduler).
 * Candles are fetched once per instrument and timeframe.
 */
export async function watchTrades(opts: { userId?: string; budgetMs: number; notify?: boolean }): Promise<WatchResult[]> {
  const started = Date.now();
  const rows = await db.all<OpenRow>(
    `SELECT t.id, t.user_id, t.decision_id, t.side, t.entry_price, t.stop_price, t.target_price, t.opened_at,
            i.instrument, d.snapshot->'order'->>'type' AS order_type
     FROM trades t
     JOIN gate_decisions d ON d.id = t.decision_id AND d.user_id = t.user_id
     JOIN trade_intents i ON i.id = d.intent_id
     WHERE t.status = 'open' AND t.exit_price IS NULL AND d.resolution = 'placed'
       AND t.entry_price IS NOT NULL AND t.opened_at IS NOT NULL
       AND (t.stop_price IS NOT NULL OR t.target_price IS NOT NULL)
       ${opts.userId ? "AND t.user_id = ?" : ""}
     ORDER BY t.opened_at
     LIMIT ${MAX_PER_RUN}`,
    ...(opts.userId ? [opts.userId] : [])
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const results: WatchResult[] = [];
  for (const r of rows) {
    if (Date.now() - started > opts.budgetMs) break;
    const inst = findInstrument(r.instrument);
    if (!inst) continue;
    const trade: WatchedTrade = {
      side: r.side,
      entry: r.entry_price,
      stop: r.stop_price,
      target: r.target_price,
      pending: PENDING_TYPES.has(r.order_type ?? "market"),
      placedAt: Math.floor(Date.parse(r.opened_at) / 1000),
    };
    try {
      const tf = watchTimeframe(trade.placedAt, nowSec);
      const hit = findLevelHit(trade, await getCandles(inst, tf, WATCH_CANDLES, { allowStale: true }), tf);
      if (!hit) {
        results.push({ tradeId: r.id, hit: null });
        continue;
      }
      // Record the hit once: a second run, or the journal at the same moment, changes nothing.
      const changed = await db.run(
        `UPDATE trades SET exit_price = ?, closed_at = to_timestamp(?)
         WHERE id = ? AND user_id = ? AND status = 'open' AND exit_price IS NULL`,
        hit.price,
        hit.at,
        r.id,
        r.user_id
      );
      results.push({ tradeId: r.id, hit: hit.level });
      if (changed && opts.notify !== false) {
        try {
          await notifyUser(r.user_id, levelMessage(inst.label, r.side, hit.level, hit.price, r.decision_id));
        } catch (err) {
          console.error("[trade-watch] notify failed:", err);
        }
      }
    } catch (err) {
      if (!(err instanceof MarketError)) console.error("[trade-watch] check failed:", err);
      results.push({ tradeId: r.id, hit: null, error: err instanceof Error ? err.message : "check failed" });
    }
  }
  return results;
}
