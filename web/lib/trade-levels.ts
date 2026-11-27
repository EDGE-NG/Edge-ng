/**
 * Did the price reach a placed trade's take profit or stop loss? Pure code
 * over Edge's own candles (PRD 5.4 source B); lib/trade-watch.ts runs it.
 *
 * Candles are mid or last-trade prices and every broker's spread differs, so
 * a "hit" here only means Edge saw the price touch the level. The trader
 * always confirms before anything is logged (Task D5, Daniel 2026-11-27).
 */
import type { Candle, Timeframe } from "./market";
import type { HitLevel } from "./outcome";

export interface WatchedTrade {
  side: "buy" | "sell";
  entry: number;
  stop: number | null;
  target: number | null;
  /** A limit or stop order starts only once the price reaches the entry. */
  pending: boolean;
  /** When the trader placed it (unix seconds). */
  placedAt: number;
}

export interface LevelHit {
  level: HitLevel;
  price: number;
  /** Open time of the candle that reached it (unix seconds). */
  at: number;
}

const TF_SEC: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };

/** Candles to ask for: enough to cover the trade's age. */
export const WATCH_CANDLES = 300;

/**
 * The finest timeframe whose last WATCH_CANDLES candles reach back to when the
 * trade was placed. Fine candles first: a coarse candle can hold both levels.
 */
export function watchTimeframe(placedAt: number, now: number): Timeframe {
  const age = Math.max(0, now - placedAt) + 120;
  for (const tf of ["1m", "5m", "15m", "30m", "1h", "4h"] as const) {
    if (age <= TF_SEC[tf] * (WATCH_CANDLES - 2)) return tf;
  }
  return "1d";
}

/**
 * The first level the price reached after the trade started, or null.
 *
 * Prices from before the trade never trigger it: in the candle the trade was
 * placed in, only the close counts (its high and low may be from earlier).
 * Edge runs this every few minutes on 1m candles while the trade is young, so
 * a level touched and left inside the placing candle is the only miss.
 *
 * When one candle reaches both levels, Edge can't tell which came first. It
 * picks the one nearer the candle's open; the trader confirms either way.
 */
export function findLevelHit(t: WatchedTrade, candles: Candle[], tf: Timeframe): LevelHit | null {
  if (t.stop == null && t.target == null) return null;
  const span = TF_SEC[tf];
  let started = !t.pending;
  // A pending order fills when the price crosses its entry from where it was
  // when the trader placed it (a buy limit below the price, a buy stop above).
  let fillsBelow: boolean | null = null;
  for (const c of candles) {
    if (c.time + span <= t.placedAt) continue; // closed before the trade was placed
    // The candle the trade was placed in: its high and low may come from before
    // the trade, so only its close counts (the price after the trade was placed).
    const placing = c.time <= t.placedAt;
    const hi = placing ? c.close : c.high;
    const lo = placing ? c.close : c.low;
    const at = placing ? t.placedAt : c.time;
    if (!started) {
      fillsBelow ??= c.open >= t.entry;
      if (!(fillsBelow ? lo <= t.entry : hi >= t.entry)) continue;
      started = true;
    }
    const tp = t.target != null && (t.side === "buy" ? hi >= t.target : lo <= t.target);
    const sl = t.stop != null && (t.side === "buy" ? lo <= t.stop : hi >= t.stop);
    if (tp && sl) {
      const level: HitLevel = Math.abs(c.open - t.target!) <= Math.abs(c.open - t.stop!) ? "take_profit" : "stop_loss";
      return { level, price: level === "take_profit" ? t.target! : t.stop!, at };
    }
    if (tp) return { level: "take_profit", price: t.target!, at };
    if (sl) return { level: "stop_loss", price: t.stop!, at };
  }
  return null;
}
