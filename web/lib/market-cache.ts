/**
 * Shared cache and request budget for keyed market data (Twelve Data).
 *
 * Twelve Data's free plan allows about 8 requests a minute and 800 a day. The
 * chart, live re-checks, alerts and trade watching all ask for candles, on
 * several Vercel server copies (migration 0008_market_cache.sql):
 *
 *  1. Candles are kept per instrument and timeframe in market_cache, shared by
 *     every server. One fetch serves every caller; each takes the slice it needs.
 *  2. One server at a time refreshes a key (market_claim). Others wait a few
 *     seconds for its result.
 *  3. Calls are spaced evenly for every server together (market_reserve), so
 *     no burst can pass the per-minute limit, and only calls that go out are
 *     counted against the day.
 *
 * Freshness is the caller's choice, and the gate never gets old prices:
 *  - maxAgeMs: the oldest candles this caller accepts (default: the timeframe's
 *    refresh time). Buy / Sell and the placement price check ask for seconds.
 *  - allowStale: when no fresh candles can be had (budget used up, provider
 *    error or rate limit), return the last candles if at most STALE_MAX old.
 *    Only for display and trade watching, which show or tolerate the data's
 *    age. Gate checks never set it: without fresh candles they fail, so the
 *    rule is Inconclusive (REQ-GT-7: a failure is never a pass).
 *
 * TWELVE_DATA_PER_MINUTE / TWELVE_DATA_PER_DAY raise the limits for a paid
 * plan. If the database is unavailable, candles are fetched directly.
 */
import { db, json } from "./db";
import type { Candle, Timeframe } from "./market";

/** How long shared candles count as fresh by default, per timeframe. */
export const KEYED_TTL_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 60_000,
  "15m": 90_000,
  "30m": 120_000,
  "1h": 180_000,
  "4h": 300_000,
  "1d": 900_000,
};

/** Oldest candles a stale-tolerant caller (chart, trade watching) gets. */
export function staleMaxMs(tf: Timeframe): number {
  return Math.max(10 * 60_000, 2 * KEYED_TTL_MS[tf]);
}

function envLimit(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/**
 * The plan's limits with headroom: one call fewer per minute, 95% of the day.
 * Calls are spaced spacingMs apart, so any 60 seconds hold at most perMinute.
 */
export function budget(): { perMinute: number; perDay: number; spacingMs: number } {
  const perMinute = Math.max(1, envLimit("TWELVE_DATA_PER_MINUTE", 8) - 1);
  return {
    perMinute,
    perDay: Math.max(1, Math.floor(envLimit("TWELVE_DATA_PER_DAY", 800) * 0.95)),
    spacingMs: Math.ceil(60_000 / perMinute),
  };
}

/** Calls at least `spacingMs` apart: the most that fit in any 60-second window. */
export function maxCallsPerMinute(spacingMs: number): number {
  return Math.floor((60_000 - 1) / spacingMs) + 1;
}

/** How long one server may hold the refresh of a key before others may try. */
const CLAIM_MS = 15_000;
/** How long a caller waits for another server's refresh, or for a call slot. */
const WAIT_MS = 6_000;
const POLL_MS = 400;

interface Stored {
  candles: Candle[];
  fetchedAt: number;
}

const memory = new Map<string, Stored>();
const inFlight = new Map<string, Promise<Stored>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readShared(key: string): Promise<Stored | null> {
  const row = await db.one<{ fetched_at: string | null; candles: unknown }>(
    "SELECT fetched_at, candles FROM market_cache WHERE key = ?",
    key
  );
  if (!row?.fetched_at) return null;
  const candles = json<Candle[]>(row.candles, []);
  return Array.isArray(candles) && candles.length ? { candles, fetchedAt: Date.parse(row.fetched_at) } : null;
}

async function writeShared(key: string, candles: Candle[]): Promise<void> {
  // sent as JSON text and cast, so the driver never treats it as a Postgres array
  await db.run(
    `INSERT INTO market_cache (key, fetched_at, candles, refreshing_until) VALUES (?, now(), ?::text::jsonb, NULL)
     ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at, candles = excluded.candles, refreshing_until = NULL`,
    key,
    JSON.stringify(candles)
  );
}

async function claim(key: string): Promise<boolean> {
  const row = await db.one<{ ok: boolean }>("SELECT public.market_claim(?, ?) AS ok", key, CLAIM_MS);
  return row?.ok === true;
}

async function release(key: string): Promise<void> {
  await db.run("UPDATE market_cache SET refreshing_until = NULL WHERE key = ?", key).catch(() => {});
}

/** Milliseconds to wait before the call, or -1 when the budget refuses it. */
async function reserve(provider: string, maxWaitMs: number): Promise<number> {
  const { spacingMs, perDay } = budget();
  const row = await db.one<{ wait: number }>(
    "SELECT public.market_reserve(?, ?, ?, ?) AS wait",
    provider,
    spacingMs,
    maxWaitMs,
    perDay
  );
  return row?.wait ?? -1;
}

/** No fresh candles could be had within the budget (the caller didn't allow stale ones). */
export class BudgetError extends Error {}

export interface CacheRequest {
  provider: string;
  /** Instrument and timeframe; one entry serves every caller. */
  key: string;
  tf: Timeframe;
  fetcher: () => Promise<Candle[]>;
  /** Oldest candles accepted (default: the timeframe's refresh time). */
  maxAgeMs?: number;
  /** Return the last candles (at most staleMaxMs old) when fresh ones can't be had. */
  allowStale?: boolean;
  now?: () => number;
}

export async function cachedCandles(req: CacheRequest): Promise<Candle[]> {
  const now = req.now ?? Date.now;
  const freshFor = Math.min(KEYED_TTL_MS[req.tf], req.maxAgeMs ?? Infinity);
  const isFresh = (s: Stored | null | undefined): s is Stored => !!s && now() - s.fetchedAt < freshFor;
  const isUsable = (s: Stored | null | undefined): s is Stored =>
    !!s && now() - s.fetchedAt < staleMaxMs(req.tf);
  const newer = (a: Stored | null | undefined, b: Stored | null | undefined) =>
    !a ? b ?? null : !b ? a : a.fetchedAt >= b.fetchedAt ? a : b;

  const mem = memory.get(req.key);
  if (isFresh(mem)) return mem.candles;

  // Another request on this server is already getting these candles.
  const pending = inFlight.get(req.key);
  if (pending) {
    const got = await pending.catch(() => null);
    if (isFresh(got)) return got.candles;
  }

  const work = (async (): Promise<Stored> => {
    let best: Stored | null = mem ?? null;
    const fallback = (err: unknown): Stored => {
      if (req.allowStale && isUsable(best)) return best;
      throw err;
    };

    let shared: Stored | null;
    try {
      shared = await readShared(req.key);
    } catch (err) {
      // database unavailable: fetch directly, as before this cache existed
      console.error("[market-cache] database unavailable, fetching directly:", err);
      try {
        const stored = { candles: await req.fetcher(), fetchedAt: now() };
        memory.set(req.key, stored);
        return stored;
      } catch (e) {
        return fallback(e);
      }
    }
    best = newer(best, shared);
    if (isFresh(best)) return best;

    // One server refreshes; the others wait for its result. If that server
    // gives up (e.g. its own call was refused) the hold is released, and a
    // waiting caller takes the refresh over instead of failing.
    let claimed = await claim(req.key);
    for (let waited = 0; !claimed && waited < WAIT_MS; waited += POLL_MS) {
      await sleep(POLL_MS);
      best = newer(best, await readShared(req.key).catch(() => null));
      if (isFresh(best)) return best;
      claimed = await claim(req.key).catch(() => false);
    }
    if (!claimed) return fallback(new BudgetError("another server is refreshing these candles"));

    try {
      // Stale-tolerant callers don't queue for a slot; gate checks wait a little.
      const wait = await reserve(req.provider, req.allowStale ? 0 : WAIT_MS);
      if (wait < 0) return fallback(new BudgetError("market-data budget used up for now"));
      if (wait > 0) await sleep(wait);
      const candles = await req.fetcher();
      const stored = { candles, fetchedAt: now() };
      await writeShared(req.key, candles).catch((err) => console.error("[market-cache] write failed:", err));
      return stored;
    } catch (err) {
      // Any failure (provider error, timeout, its own rate limit): the last
      // candles only for callers that allow them, otherwise the error.
      return fallback(err);
    } finally {
      await release(req.key);
    }
  })();

  inFlight.set(req.key, work);
  try {
    const got = await work;
    memory.set(req.key, newer(memory.get(req.key), got)!);
    return got.candles;
  } finally {
    if (inFlight.get(req.key) === work) inFlight.delete(req.key);
  }
}

/** Daily job: drop cached candles nobody asked for in a day. */
export async function purgeOldMarketCache(): Promise<number> {
  return db.run("DELETE FROM market_cache WHERE fetched_at IS NULL OR fetched_at < now() - interval '1 day'");
}
