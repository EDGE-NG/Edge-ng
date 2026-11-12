import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import {
  MarketError,
  TIMEFRAMES,
  computeIndicator,
  dataAgeSeconds,
  findInstrument,
  getCandles,
  indicatorLabel,
  type IndicatorSpec,
  type Timeframe,
} from "@/lib/market";

/**
 * GET ?symbol=BTCUSDT&tf=1h&ind=ema:20,rsi:14 -> candles (oldest first) plus
 * indicator series computed in code, and how old the data is (EC-C6).
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const inst = findInstrument(q.get("symbol") ?? "");
  const tf = q.get("tf") as Timeframe;
  if (!inst) return NextResponse.json({ error: "Unknown instrument." }, { status: 400 });
  if (!TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "Unknown timeframe." }, { status: 400 });

  const specs: IndicatorSpec[] = (q.get("ind") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 6)
    .flatMap((s) => {
      const [kind, p] = s.split(":");
      const period = Number(p);
      return ["ema", "sma", "rsi"].includes(kind) && period >= 2 && period <= 400
        ? [{ kind, period } as IndicatorSpec]
        : [];
    });

  try {
    const candles = await getCandles(inst, tf, 300);
    return NextResponse.json({
      symbol: inst.symbol,
      timeframe: tf,
      decimals: inst.decimals,
      candles,
      indicators: specs.map((s) => ({
        spec: s,
        label: indicatorLabel(s),
        values: computeIndicator(s, candles),
      })),
      dataAgeSeconds: dataAgeSeconds(candles, tf),
    });
  } catch (err) {
    if (err instanceof MarketError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
