/**
 * Market-data service (PRD 9.1): candles from licensed / public providers
 * behind one interface, plus an indicator engine computed in code
 * (REQ-LLM-7: numeric rules never come from the model).
 *
 *  - Crypto: Binance public market data (no key).
 *  - Forex, metals, indices: Twelve Data (needs TWELVE_DATA_API_KEY).
 *
 * Provider terms (display, caching, redistribution) must be confirmed before
 * launch (REQ-DT-5); candles are cached only briefly, per instrument.
 */

export type AssetClass = "crypto" | "forex" | "metals" | "indices";
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

export interface Instrument {
  symbol: string; // Edge's symbol, e.g. "BTCUSDT", "EUR/USD"
  label: string;
  assetClass: AssetClass;
  provider: "binance" | "twelvedata";
  providerSymbol: string;
  decimals: number;
}

/** Starter list (PR-TW-1). Extend once provider coverage is confirmed. */
export const INSTRUMENTS: Instrument[] = [
  { symbol: "BTCUSDT", label: "BTC/USDT", assetClass: "crypto", provider: "binance", providerSymbol: "BTCUSDT", decimals: 2 },
  { symbol: "ETHUSDT", label: "ETH/USDT", assetClass: "crypto", provider: "binance", providerSymbol: "ETHUSDT", decimals: 2 },
  { symbol: "SOLUSDT", label: "SOL/USDT", assetClass: "crypto", provider: "binance", providerSymbol: "SOLUSDT", decimals: 3 },
  { symbol: "XRPUSDT", label: "XRP/USDT", assetClass: "crypto", provider: "binance", providerSymbol: "XRPUSDT", decimals: 4 },
  { symbol: "BNBUSDT", label: "BNB/USDT", assetClass: "crypto", provider: "binance", providerSymbol: "BNBUSDT", decimals: 2 },
  { symbol: "EUR/USD", label: "EUR/USD", assetClass: "forex", provider: "twelvedata", providerSymbol: "EUR/USD", decimals: 5 },
  { symbol: "GBP/USD", label: "GBP/USD", assetClass: "forex", provider: "twelvedata", providerSymbol: "GBP/USD", decimals: 5 },
  { symbol: "USD/JPY", label: "USD/JPY", assetClass: "forex", provider: "twelvedata", providerSymbol: "USD/JPY", decimals: 3 },
  { symbol: "GBP/JPY", label: "GBP/JPY", assetClass: "forex", provider: "twelvedata", providerSymbol: "GBP/JPY", decimals: 3 },
  { symbol: "AUD/USD", label: "AUD/USD", assetClass: "forex", provider: "twelvedata", providerSymbol: "AUD/USD", decimals: 5 },
  { symbol: "USD/CAD", label: "USD/CAD", assetClass: "forex", provider: "twelvedata", providerSymbol: "USD/CAD", decimals: 5 },
  { symbol: "XAU/USD", label: "Gold (XAU/USD)", assetClass: "metals", provider: "twelvedata", providerSymbol: "XAU/USD", decimals: 2 },
  { symbol: "XAG/USD", label: "Silver (XAG/USD)", assetClass: "metals", provider: "twelvedata", providerSymbol: "XAG/USD", decimals: 3 },
  { symbol: "NDX", label: "Nasdaq 100 (NDX)", assetClass: "indices", provider: "twelvedata", providerSymbol: "NDX", decimals: 2 },
  { symbol: "SPX", label: "S&P 500 (SPX)", assetClass: "indices", provider: "twelvedata", providerSymbol: "SPX", decimals: 2 },
  { symbol: "DJI", label: "Dow Jones (DJI)", assetClass: "indices", provider: "twelvedata", providerSymbol: "DJI", decimals: 2 },
];

export function findInstrument(symbol: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.symbol === symbol);
}

export function providerReady(i: Instrument): boolean {
  return i.provider === "binance" || Boolean(process.env.TWELVE_DATA_API_KEY);
}

export interface Candle {
  time: number; // unix seconds, candle open (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class MarketError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

/* ---------------------------------------------------------- providers ---- */

const BINANCE_TF: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d" };
const TWELVE_TF: Record<Timeframe, string> = { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1day" };

// Binance's main API is unavailable in some regions; the public market-data
// mirror serves the same klines.
const BINANCE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

async function binanceCandles(sym: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  let lastErr = "";
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await fetch(`${host}/api/v3/klines?symbol=${sym}&interval=${BINANCE_TF[tf]}&limit=${limit}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        lastErr = `${res.status}`;
        continue;
      }
      const rows = (await res.json()) as Array<[number, string, string, string, string, string]>;
      return rows.map((r) => ({
        time: Math.floor(r[0] / 1000),
        open: +r[1],
        high: +r[2],
        low: +r[3],
        close: +r[4],
        volume: +r[5],
      }));
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new MarketError(`Crypto prices are unavailable right now (${lastErr}).`, 502, "provider_down");
}

async function twelveCandles(sym: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) {
    throw new MarketError(
      "Forex, gold and index prices need a market-data key. Add TWELVE_DATA_API_KEY to .env.local.",
      503,
      "no_key"
    );
  }
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${TWELVE_TF[tf]}` +
    `&outputsize=${limit}&timezone=UTC&order=ASC&apikey=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const d = (await res.json().catch(() => ({}))) as {
    status?: string;
    code?: number;
    message?: string;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>;
  };
  if (!res.ok || d.status === "error" || !d.values) {
    const limited = d.code === 429;
    throw new MarketError(
      limited ? "The market-data plan's rate limit was reached. Wait a minute." : `Prices unavailable: ${d.message ?? res.status}`,
      limited ? 429 : 502,
      limited ? "rate_limited" : "provider_error"
    );
  }
  return d.values.map((v) => ({
    time: Math.floor(Date.parse(v.datetime.replace(" ", "T") + (v.datetime.length > 10 ? "Z" : "T00:00:00Z")) / 1000),
    open: +v.open,
    high: +v.high,
    low: +v.low,
    close: +v.close,
    volume: v.volume ? +v.volume : 0,
  }));
}

/* ------------------------------------------------------------- cache ----- */

const cache = new Map<string, { at: number; candles: Candle[] }>();
const TTL_MS: Record<Timeframe, number> = { "1m": 5_000, "5m": 10_000, "15m": 15_000, "30m": 20_000, "1h": 30_000, "4h": 60_000, "1d": 120_000 };

/** Latest candles, oldest first. The last candle may still be forming. */
export async function getCandles(inst: Instrument, tf: Timeframe, limit = 300): Promise<Candle[]> {
  const key = `${inst.symbol}|${tf}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS[tf]) return hit.candles;
  const candles =
    inst.provider === "binance"
      ? await binanceCandles(inst.providerSymbol, tf, limit)
      : await twelveCandles(inst.providerSymbol, tf, limit);
  if (candles.length === 0) throw new MarketError("No price data returned for that instrument.", 502, "empty");
  cache.set(key, { at: Date.now(), candles });
  return candles;
}

/** Seconds since the last candle closed / last update, to flag delayed data (EC-C6). */
export function dataAgeSeconds(candles: Candle[], tf: Timeframe): number {
  const tfSec = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 }[tf];
  const last = candles[candles.length - 1];
  return Math.max(0, Math.floor(Date.now() / 1000) - (last.time + tfSec));
}

/* -------------------------------------------------------- indicators ----- */

export function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  values.forEach((v, i) => {
    if (i < period - 1) return out.push(null);
    if (prev === null) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  });
  return out;
}

export function sma(values: number[], period: number): Array<number | null> {
  return values.map((_, i) =>
    i < period - 1 ? null : values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  );
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = values.map(() => null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export type IndicatorSpec = { kind: "ema" | "sma"; period: number } | { kind: "rsi"; period: number };

export function computeIndicator(spec: IndicatorSpec, candles: Candle[]): Array<number | null> {
  const closes = candles.map((c) => c.close);
  if (spec.kind === "ema") return ema(closes, spec.period);
  if (spec.kind === "sma") return sma(closes, spec.period);
  return rsi(closes, spec.period);
}

export function indicatorLabel(s: IndicatorSpec): string {
  return `${s.kind.toUpperCase()} ${s.period}`;
}

/**
 * Indicators the rules mention ("20 EMA", "50 SMA", "RSI above 40"), so the
 * chart shows what the rules need without the trader setting them up.
 */
export function indicatorsFromRules(texts: string[]): IndicatorSpec[] {
  const found = new Map<string, IndicatorSpec>();
  const t = texts.join(" \n ");
  for (const m of t.matchAll(/(\d{1,3})\s*-?\s*(ema|sma|ma)\b|\b(ema|sma|ma)\s*\(?\s*(\d{1,3})/gi)) {
    const period = Number(m[1] ?? m[4]);
    const kind = (m[2] ?? m[3]).toLowerCase() === "ema" ? "ema" : "sma";
    if (period >= 2 && period <= 400) found.set(`${kind}${period}`, { kind, period } as IndicatorSpec);
  }
  if (/\brsi\b/i.test(t)) found.set("rsi14", { kind: "rsi", period: 14 });
  return [...found.values()].slice(0, 5);
}
