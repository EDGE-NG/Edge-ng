"use client";

/**
 * Edge's own chart (PRD 5.4 source A/B): TradingView's open-source
 * Lightweight Charts, drawn from market data Edge fetched itself, so Edge can
 * capture the exact view (image + symbol, timeframe, visible range, candles).
 */
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface IndicatorSeries {
  label: string;
  spec: { kind: "ema" | "sma" | "rsi"; period: number };
  values: Array<number | null>;
}
export interface ChartHandle {
  capture: () => { image: string; visibleFrom?: number; visibleTo?: number } | null;
}

const LINE_COLORS = ["#ffc400", "#5ef088", "#7fb2ff", "#ff8bd1", "#c79bff"];

const ChartView = forwardRef<ChartHandle, { candles: Candle[]; indicators: IndicatorSeries[]; decimals: number }>(
  function ChartView({ candles, indicators, decimals }, ref) {
    const box = useRef<HTMLDivElement>(null);
    const chart = useRef<IChartApi | null>(null);
    const main = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const lines = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
    const fitted = useRef(false);

    useImperativeHandle(ref, () => ({
      capture() {
        if (!chart.current) return null;
        const canvas = chart.current.takeScreenshot();
        const range = chart.current.timeScale().getVisibleRange();
        return {
          image: canvas.toDataURL("image/png"),
          visibleFrom: range ? Number(range.from) : undefined,
          visibleTo: range ? Number(range.to) : undefined,
        };
      },
    }));

    // create once
    useEffect(() => {
      if (!box.current) return;
      const c = createChart(box.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "#070b0a" },
          textColor: "#9aa59f",
          fontFamily: "Inter Tight, system-ui, sans-serif",
          panes: { separatorColor: "rgba(255,255,255,0.08)" },
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.04)" },
          horzLines: { color: "rgba(255,255,255,0.04)" },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
        timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true, secondsVisible: false },
      });
      main.current = c.addSeries(CandlestickSeries, {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderVisible: false,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
      });
      chart.current = c;
      const linesMap = lines.current;
      return () => {
        c.remove();
        chart.current = null;
        main.current = null;
        linesMap.clear();
        fitted.current = false;
      };
    }, []);

    // price format follows the instrument
    useEffect(() => {
      main.current?.applyOptions({
        priceFormat: { type: "price", precision: decimals, minMove: 1 / 10 ** decimals },
      });
    }, [decimals]);

    // data + indicators
    useEffect(() => {
      const c = chart.current;
      if (!c || !main.current) return;
      main.current.setData(
        candles.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close }))
      );
      const wanted = new Set(indicators.map((i) => i.label));
      for (const [label, s] of lines.current) {
        if (!wanted.has(label)) {
          c.removeSeries(s);
          lines.current.delete(label);
        }
      }
      indicators.forEach((ind, idx) => {
        let s = lines.current.get(ind.label);
        if (!s) {
          const isRsi = ind.spec.kind === "rsi";
          s = c.addSeries(
            LineSeries,
            {
              color: LINE_COLORS[idx % LINE_COLORS.length],
              lineWidth: 2,
              title: ind.label,
              priceLineVisible: false,
              lastValueVisible: true,
            },
            isRsi ? 1 : 0 // RSI in its own pane below the price
          );
          lines.current.set(ind.label, s);
        }
        s.setData(
          candles.flatMap((k, i) =>
            ind.values[i] == null ? [] : [{ time: k.time as UTCTimestamp, value: ind.values[i] as number }]
          )
        );
      });
      if (!fitted.current && candles.length) {
        c.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 120), to: candles.length + 3 });
        fitted.current = true;
      }
    }, [candles, indicators]);

    return <div ref={box} className="h-full w-full" />;
  }
);

export default ChartView;
