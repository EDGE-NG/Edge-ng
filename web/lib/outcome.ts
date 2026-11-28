/**
 * Trade outcomes (Task D5; flow by Daniel, 2026-11-27).
 *
 * Edge knows each placed trade's entry, stop loss and take profit from the
 * ticket. It watches the price (lib/trade-watch.ts) and, when the price
 * reaches the take profit or the stop loss, asks the trader to confirm how
 * the trade ended: Profit, Loss or Break even. Brokers' spreads differ, so
 * Edge never closes a trade on its own reading. A trade closed early by hand
 * is closed from the journal with the exit price.
 *
 * Everything lives on `trades` (no new columns):
 *  - watching:  status 'open', exit_price null
 *  - hit:       status 'open', exit_price = the level Edge saw, closed_at = when
 *  - closed:    status 'closed', exit_price = where it ended
 * The result comes from the exit price against the entry. R is worked out
 * from the levels; money (integer minor units plus ISO currency, PRD 9.2)
 * only when the ticket's risk amount is in a known currency.
 *
 * Edge records outcomes; it never judges or predicts trades (PR-GT-8).
 */

export type OutcomeResult = "win" | "loss" | "break_even";
export type TradeState = "watching" | "hit" | "closed";
export type HitLevel = "take_profit" | "stop_loss";

export const OUTCOME_LABEL: Record<OutcomeResult, string> = {
  win: "Profit",
  loss: "Loss",
  break_even: "Break even",
};

export const LEVEL_LABEL: Record<HitLevel, string> = {
  take_profit: "take profit",
  stop_loss: "stop loss",
};

export const NOTE_MAX = 500;

type Side = "buy" | "sell";

/* ----------------------------------------------------------- money ----- */

let iso: Set<string> | null = null;
function isIsoCurrency(code: string): boolean {
  // Intl formats any three letters ("BTC"), so check the real ISO 4217 list.
  iso ??= new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : []);
  return iso.size ? iso.has(code) : /^[A-Z]{3}$/.test(code);
}

/** Digits after the decimal point for an ISO 4217 currency (USD 2, JPY 0), or null. */
export function minorDigits(currency: string): number | null {
  if (!/^[A-Z]{3}$/.test(currency) || !isIsoCurrency(currency)) return null;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

/** Dollar stablecoins count as USD; anything else must be ISO 4217. */
const USD_LIKE = new Set(["USD", "USDT", "USDC", "FDUSD", "BUSD"]);

/**
 * The currency a ticket's risk amount is in, or null when Edge can't tell:
 *  - lot ticket: the starting balance and risk are in USD;
 *  - spot ticket (Binance, Bybit, OKX): the pair's quote asset.
 */
export function riskCurrency(style: "spot" | "lots", instrumentLabel: string): string | null {
  if (style === "lots") return "USD";
  const quote = instrumentLabel.includes("/") ? instrumentLabel.split("/").pop()!.replace(/\W/g, "") : "USDT";
  if (USD_LIKE.has(quote)) return "USD";
  return minorDigits(quote) != null ? quote : null;
}

/** P&L in minor units: R times the risk amount, or null without both. */
export function pnlMinor(r: number | null, riskAmount: number | null, currency: string | null): number | null {
  if (r == null || riskAmount == null || !(riskAmount > 0) || !currency) return null;
  const d = minorDigits(currency);
  if (d == null) return null;
  const v = Math.round(r * riskAmount * 10 ** d);
  return Number.isSafeInteger(v) ? v : null;
}

/** "+120.50 USD", "−45.50 GBP", "0 JPY". */
export function formatPnl(minor: number, currency: string): string {
  const d = minorDigits(currency) ?? 2;
  const v = Math.abs(minor / 10 ** d).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${v} ${currency}`;
}

/* ---------------------------------------------------------- result ----- */

/** Profit, Loss or Break even from where the trade ended. */
export function resultOf(side: Side, entry: number, exit: number): OutcomeResult {
  const moved = side === "buy" ? exit - entry : entry - exit;
  return Math.abs(moved) < 1e-12 ? "break_even" : moved > 0 ? "win" : "loss";
}

/** The result in R (multiples of the risk taken). Null without a stop. */
export function outcomeR(side: Side, entry: number | null, stop: number | null, exit: number | null): number | null {
  if (entry == null || stop == null || exit == null) return null;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const moved = side === "buy" ? exit - entry : entry - exit;
  return Math.round((moved / risk) * 100) / 100;
}

/* ------------------------------------------------------- the trade ----- */

/** A `trades` row joined with what the journal needs. */
export interface TradeRow {
  id: string;
  side: Side;
  status: "open" | "closed" | "cancelled";
  entry_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  exit_price: number | null;
  outcome_r: number | null;
  pnl_minor: number | null;
  currency: string | null;
  notes: string | null;
  closed_at: string | null;
}

/** What the app shows for a placed trade. */
export interface TradeView {
  tradeId: string;
  state: TradeState;
  /** Watching: which levels Edge watches. */
  watching: { takeProfit: number | null; stopLoss: number | null };
  /** Hit: the level Edge saw the price reach, and when. */
  hit: { level: HitLevel; price: number; at: string | null } | null;
  /** Closed: how it ended. */
  result: OutcomeResult | null;
  exitPrice: number | null;
  outcomeR: number | null;
  pnlMinor: number | null;
  currency: string | null;
  note: string | null;
  closedAt: string | null;
}

export function toTradeView(t: TradeRow | undefined | null): TradeView | null {
  if (!t || t.status === "cancelled" || t.entry_price == null) return null;
  const state: TradeState = t.status === "closed" ? "closed" : t.exit_price != null ? "hit" : "watching";
  const level: HitLevel | null =
    state !== "hit" ? null : t.exit_price === t.target_price ? "take_profit" : t.exit_price === t.stop_price ? "stop_loss" : null;
  return {
    tradeId: t.id,
    state,
    watching: { takeProfit: t.target_price, stopLoss: t.stop_price },
    hit: level && t.exit_price != null ? { level, price: t.exit_price, at: t.closed_at } : null,
    result: state === "closed" && t.exit_price != null ? resultOf(t.side, t.entry_price, t.exit_price) : null,
    exitPrice: state === "closed" ? t.exit_price : null,
    outcomeR: state === "closed" ? t.outcome_r : null,
    pnlMinor: state === "closed" ? t.pnl_minor : null,
    currency: state === "closed" ? t.currency : null,
    note: t.notes,
    closedAt: state === "closed" ? t.closed_at : null,
  };
}

/* ------------------------------------------------------ confirming ----- */

export interface ConfirmInput {
  result?: unknown;
  exitPrice?: unknown;
  note?: unknown;
}

/**
 * Work out where the trade ended from what the trader chose.
 *  - After Edge saw a level (state "hit"), Profit ends at the take profit,
 *    Loss at the stop loss and Break even at the entry, unless the trader
 *    gives the price they actually closed at.
 *  - Closing by hand (or correcting a closed trade), Profit and Loss need the
 *    exit price: Edge can't know it.
 * The exit price must agree with the result (a Profit exit is beyond entry).
 */
export function confirmExit(
  t: Pick<TradeRow, "side" | "entry_price" | "stop_price" | "target_price">,
  state: TradeState,
  b: ConfirmInput
): { ok: true; exit: number; note: string | null } | { ok: false; error: string } {
  const result = b.result;
  if (result !== "win" && result !== "loss" && result !== "break_even") {
    return { ok: false, error: "Choose Profit, Loss or Break even." };
  }
  if (t.entry_price == null) return { ok: false, error: "This trade has no entry price." };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, NOTE_MAX) || null : null;

  let exit: number | null = null;
  if (b.exitPrice != null && b.exitPrice !== "") {
    const v = typeof b.exitPrice === "number" ? b.exitPrice : typeof b.exitPrice === "string" ? Number(b.exitPrice.replace(/,/g, "").trim()) : NaN;
    if (!Number.isFinite(v) || v <= 0) return { ok: false, error: "The exit price must be a number above zero." };
    exit = v;
  }
  if (result === "break_even") return { ok: true, exit: exit ?? t.entry_price, note };
  if (exit == null && state === "hit") {
    exit = result === "win" ? t.target_price : t.stop_price;
  }
  if (exit == null) {
    return { ok: false, error: `Enter the price you closed at, so Edge can work out the ${result === "win" ? "profit" : "loss"}.` };
  }
  const got = resultOf(t.side, t.entry_price, exit);
  if (got !== result) {
    const way = t.side === "buy" ? (result === "win" ? "above" : "below") : result === "win" ? "below" : "above";
    return { ok: false, error: `For a ${OUTCOME_LABEL[result].toLowerCase()} on a ${t.side}, the exit price is ${way} your entry.` };
  }
  return { ok: true, exit, note };
}
