/**
 * Shared cache and request budget for keyed market data (Twelve Data).
 *
 * Twelve Data's free plan allows about 8 requests a minute and 800 a day. The
 * chart, live re-checks, alerts and trade watching all ask for candles, on
 * several Vercel server copies, so without sharing one trader on a forex chart
 * could use a few hundred requests an hour. Here:
 *
 *  1. Candles are kept per instrument and timeframe in Postgres
 *     (market_cache, migration 0008), shared by every server, for KEYED_TTL_MS.
 *  2. Requests for the same candles at the same moment on one server share a
 *     single call.
 *  3. Calls are counted per minute and per UTC day (rate_limit_hit, shared). Near
 *     the plan's limit, Edge serves the last candles it has, but only while
 *     they are at most STALE_MAX_MS old. Older than that, it reports the
 *     rate limit, so a check becomes Inconclusive and never runs on old prices
 *     (a failure is never a pass).
 *
 * Limits are TWELVE_DATA_PER_MINUTE and TWELVE_DATA_PER_DAY (defaults: the
 * free plan); raise them for a paid plan. If the database is unavailable,
 * candles are fetched directly, as before.
 */
import { db, json } from "./db";
import { hashKey } from "./rate-limit";
import type { Candle, Timeframe } from "./market";

/** How long shared candles count as fresh, per timeframe. */
export const KEYED_TTL_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 60_000,
  "15m": 90_000,
  "30m": 120_000,
  "1h": 180_000,
  "4h": 300_000,
  "1d": 900_000,
};

/** Oldest candles Edge will serve when the plan's limit is reached. */
export function staleMaxMs(tf: Timeframe): number {
  return Math.max(10 * 60_000, 2 * KEYED_TTL_MS[tf]);
}

function limit(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Keep a little headroom under the plan's limits for retries and other tools. */
export function budget(): { perMinute: number; perDay: number } {
  return {
    perMinute: Math.max(1, limit("TWELVE_DATA_PER_MINUTE", 8) - 1),
    perDay: Math.max(1, Math.floor(limit("TWELVE_DATA_PER_DAY", 800) * 0.95)),
  };
}

/** Milliseconds until the next 00:00 UTC (when Twelve Data's daily count resets). */
export function msUntilUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

interface Stored {
  candles: Candle[];
  fetchedAt: number;
}

// Per-server copy, so the database isn't read on every request either.
const memory = new Map<string, Stored>();
const inFlight = new Map<string, Promise<Candle[]>>();

async function readShared(key: string): Promise<Stored | null> {
  try {
    const row = await db.one<{ fetched_at: string; candles: unknown }>(
      "SELECT fetched_at, candles FROM market_cache WHERE key = ?",
      key
    );
    if (!row) return null;
    const candles = json<Candle[]>(row.candles, []);
    return candles.length ? { candles, fetchedAt: Date.parse(row.fetched_at) } : null;
  } catch (err) {
    console.error("[market-cache] read failed:", err);
    return null;
  }
}

async function writeShared(key: string, candles: Candle[]): Promise<void> {
  try {
    await db.run(
      `INSERT INTO market_cache (key, fetched_at, candles) VALUES (?, now(), ?)
       ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at, candles = excluded.candles`,
      key,
      candles
    );
  } catch (err) {
    console.error("[market-cache] write failed:", err);
  }
}

/**
 * Count one provider call against the shared budget. True when it may go
 * ahead. If the counters can't be read, the call goes ahead (the provider
 * still enforces its own limit).
 */
async function takeBudget(provider: string): Promise<boolean> {
  const { perMinute, perDay } = budget();
  try {
    const minute = await db.one<{ count: number }>(
      "SELECT public.rate_limit_hit(?, ?) AS count",
      hashKey(`market:${provider}:minute`),
      60_000
    );
    if ((minute?.count ?? 0) > perMinute) return false;
    const day = await db.one<{ count: number }>(
      "SELECT public.rate_limit_hit(?, ?) AS count",
      hashKey(`market:${provider}:day`),
      msUntilUtcMidnight()
    );
    return (day?.count ?? 0) <= perDay;
  } catch (err) {
    console.error("[market-cache] budget check failed:", err);
    return true;
  }
}

export class BudgetError extends Error {}

/**
 * Candles for `key` from the shared cache, or from `fetcher` when they are
 * older than the timeframe's TTL. `isRateLimit` tells a provider's own
 * rate-limit error apart from other failures.
 */
export async function cachedCandles(opts: {
  provider: string;
  key: string;
  tf: Timeframe;
  fetcher: () => Promise<Candle[]>;
  isRateLimit: (err: unknown) => boolean;
  now?: () => number;
}): Promise<Candle[]> {
  const now = opts.now ?? Date.now;
  const ttl = KEYED_TTL_MS[opts.tf];
  const ageOf = (s: Stored) => now() - s.fetchedAt;

  const mem = memory.get(opts.key);
  if (mem && ageOf(mem) < ttl) return mem.candles;

  const pending = inFlight.get(opts.key);
  if (pending) return pending;

  const work = (async () => {
    const shared = await readShared(opts.key);
    const best: Stored | null = shared && (!mem || shared.fetchedAt > mem.fetchedAt) ? shared : (mem ?? null);
    if (best && ageOf(best) < ttl) {
      memory.set(opts.key, best);
      return best.candles;
    }
    // last candles, if recent enough to serve when the provider can't be asked
    const fallback = best && ageOf(best) < staleMaxMs(opts.tf) ? best.candles : null;

    if (!(await takeBudget(opts.provider))) {
      if (fallback) return fallback;
      throw new BudgetError("budget");
    }

    try {
      const candles = await opts.fetcher();
      const stored = { candles, fetchedAt: now() };
      memory.set(opts.key, stored);
      await writeShared(opts.key, candles);
      return candles;
    } catch (err) {
      // the provider's own limit: last candles if they're recent enough
      if (opts.isRateLimit(err) && fallback) return fallback;
      throw err;
    }
  })();

  inFlight.set(opts.key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(opts.key);
  }
}

/** Daily job: drop cached candles nobody asked for in a day. */
export async function purgeOldMarketCache(): Promise<number> {
  return db.run("DELETE FROM market_cache WHERE fetched_at < now() - interval '1 day'");
}
