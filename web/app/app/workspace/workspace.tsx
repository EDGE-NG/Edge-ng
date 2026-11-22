"use client";

/**
 * Trade workspace (PRD 4.4, 4.5, F5, F6).
 * Pick the instrument; Edge's own chart sits beside "Your rules" and a ticket
 * that looks like the trader's platform. While the trader works on a trade,
 * Edge keeps its checks fresh, so pressing Buy or Sell answers in about a
 * second: the check popup ticks each rule, then code decides Approved /
 * Denied / Needs evidence.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppFrame from "../../_components/app-frame";
import Dropdown from "../../_components/dropdown";
import { IconCandles } from "../../_components/icons";
import { weekendClosed } from "@/lib/sessions";
import ChartView, { type Candle, type ChartHandle, type IndicatorSeries } from "./chart";
import CheckDialog from "./check-dialog";
import RulesPanel from "./rules-panel";
import SessionStrip from "./session-strip";
import { EdgeTicket, isSpot, MtTicket, SpotTicket, ticketKind, TileTicket } from "./tickets";
import { TF_LABEL, TIMEFRAMES, type Instrument, type TicketDraft, type Timeframe, type View } from "./types";

const ASSET_LABEL = { crypto: "Crypto", forex: "Forex", metals: "Metals", indices: "Indices" } as const;
const PLATFORMS = ["MetaTrader 5", "MetaTrader 4", "cTrader", "TradeLocker", "Match-Trader", "Binance", "Bybit", "OKX", "TradingView", "Other"];
const DEFAULT_SYMBOL = "EUR/USD";
const DEFAULT_PLATFORM = "MetaTrader 5";

/** Keep checks fresh this often while the trader is working on a trade (under the gate's 27 s reuse window). */
const WARM_EVERY_MS = 20_000;
/** Stop warming this long after the trader last touched the ticket or chart. */
const IDLE_AFTER_MS = 3 * 60_000;

/** The ticket as it stands, in the shape the server checks chart rules against. */
function ticketBody(d: TicketDraft | null) {
  const ticket = d && d.entry != null ? { side: d.side ?? "buy", entry: d.entry, stop: d.stop, target: d.target } : null;
  return { ticket, pending: d ? d.orderType !== "market" : false };
}

export default function Workspace() {
  const [boot, setBoot] = useState<{ checklists: Array<{ edgeId: string; name: string; versionNumber: number }>; instruments: Instrument[] } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [edgeId, setEdgeId] = useState("");
  const [assetClass, setAssetClass] = useState<Instrument["assetClass"]>("forex");
  const [symbol, setSymbol] = useState("");
  const [platform, setPlatform] = useState("");
  const [tf, setTf] = useState<Timeframe>("1h");
  // market data, tagged with the instrument|timeframe it belongs to, so a
  // switch never shows the previous instrument's candles (EC-C2)
  const [market, setMarket] = useState<{
    key: string;
    candles: Candle[];
    indicators: IndicatorSeries[];
    dataAge: number | null;
    error: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [warming, setWarming] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [dialog, setDialog] = useState<{ side: "buy" | "sell"; draft: TicketDraft } | null>(null);
  const chartRef = useRef<ChartHandle>(null);
  const frameReq = useRef(0);
  const warmReq = useRef(0);
  const draftRef = useRef<TicketDraft | null>(null);
  const lastActivity = useRef(0);
  const dialogOpen = useRef(false);

  const instruments = useMemo(() => boot?.instruments ?? [], [boot]);
  const inst = instruments.find((i) => i.symbol === symbol) ?? null;
  const sessionId = view?.session.id ?? null;
  const kind = ticketKind(platform);

  // what the chart shows: only data for the current instrument + timeframe
  const current = market && market.key === `${symbol}|${tf}` ? market : null;
  const candles = useMemo(() => current?.candles ?? [], [current]);
  const indicators = current?.indicators ?? [];
  const dataAge = current?.dataAge ?? null;
  const marketError =
    inst && !inst.ready
      ? "Forex, gold and index prices need a market-data key (TWELVE_DATA_API_KEY in .env.local)."
      : current?.error ?? "";

  /* boot: checklists, instruments, any open session */
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/workspace/sessions");
      if (!res.ok) return;
      const d = await res.json();
      setBoot({ checklists: d.checklists, instruments: d.instruments });
      let pref: { edgeId?: string; symbol?: string; platform?: string } = {};
      try {
        pref = JSON.parse(localStorage.getItem("edge-workspace") || "{}");
      } catch {
        /* no prefs */
      }
      const v: View | null = d.view;
      const e = v?.session.edgeId ?? (d.checklists.some((c: { edgeId: string }) => c.edgeId === pref.edgeId) ? pref.edgeId : d.checklists[0]?.edgeId) ?? "";
      // a first-time trader starts on EUR/USD with an MT5-style ticket
      const sym = v?.session.instrument ?? pref.symbol ?? DEFAULT_SYMBOL;
      setEdgeId(e);
      setSymbol(sym);
      setAssetClass(d.instruments.find((i: Instrument) => i.symbol === sym)?.assetClass ?? "forex");
      setPlatform(v?.session.platform ?? pref.platform ?? DEFAULT_PLATFORM);
      if (v && v.session.edgeId === e) {
        setView(v);
        // start on the timeframe the rules ask for first
        const first = v.rules.find((r) => r.timeframe)?.timeframe;
        if (first) setTf(first);
      }
    })();
  }, []);

  /* (re)start the session when checklist or instrument changes (instrument changed -> fresh start) */
  useEffect(() => {
    if (!edgeId || !symbol) return;
    if (view && view.session.edgeId === edgeId && view.session.instrument === symbol) return;
    let alive = true;
    (async () => {
      setError("");
      const res = await fetch("/api/workspace/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edgeId, instrument: symbol, platform: platform || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok) return setError(d.error || "Couldn't open the workspace.");
      setView(d);
      // start on the timeframe the rules ask for first
      const first = (d as View).rules.find((r) => r.timeframe)?.timeframe;
      if (first) setTf(first);
    })();
    return () => {
      alive = false;
    };
  }, [edgeId, symbol, platform, view]);

  useEffect(() => {
    if (!edgeId || !symbol) return;
    try {
      localStorage.setItem("edge-workspace", JSON.stringify({ edgeId, symbol, platform }));
    } catch {
      /* not remembered */
    }
  }, [edgeId, symbol, platform]);

  /* candles: initial load + live polling (faster for crypto; keyed providers have rate limits) */
  const indParam = useMemo(() => (view?.indicators ?? []).map((s) => `${s.kind}:${s.period}`).join(","), [view?.indicators]);
  useEffect(() => {
    if (!inst || !view || !inst.ready) return;
    let alive = true;
    const key = `${inst.symbol}|${tf}`;
    const load = async () => {
      try {
        const res = await fetch(`/api/market/candles?symbol=${encodeURIComponent(inst.symbol)}&tf=${tf}&ind=${indParam}`);
        const d = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(d.error || "Prices unavailable.");
        setMarket({ key, candles: d.candles, indicators: d.indicators, dataAge: d.dataAgeSeconds, error: "" });
      } catch (err) {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : "Prices unavailable.";
        // keep showing the last good candles for this view; just report the problem
        setMarket((m) => (m && m.key === key ? { ...m, error: msg } : { key, candles: [], indicators: [], dataAge: null, error: msg }));
      }
    };
    void load();
    const t = setInterval(load, inst.assetClass === "crypto" ? 5000 : 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [inst, tf, indParam, view?.session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* PR-TW-3: capture and check ~1s after the view settles; outdated requests are ignored (EC-C2) */
  const runCheck = useCallback(async () => {
    if (!sessionId) return;
    const shot = chartRef.current?.capture();
    if (!shot) return;
    const req = ++frameReq.current;
    setChecking(true);
    try {
      const res = await fetch(`/api/workspace/sessions/${sessionId}/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeframe: tf, ...shot, ...ticketBody(draftRef.current) }),
      });
      const d = await res.json().catch(() => ({}));
      if (req !== frameReq.current) return; // a newer view replaced this one
      if (!res.ok) throw new Error(d.error || "Edge couldn't check this view.");
      setView(d);
    } catch (err) {
      if (req === frameReq.current) setError(err instanceof Error ? err.message : "Edge couldn't check this view.");
    } finally {
      if (req === frameReq.current) setChecking(false);
    }
  }, [sessionId, tf]);

  const firstCandleTime = candles[0]?.time;
  useEffect(() => {
    if (!firstCandleTime || !sessionId) return;
    const t = setTimeout(runCheck, 1000);
    return () => clearTimeout(t);
  }, [firstCandleTime, sessionId, tf, runCheck]);

  /*
   * Keep checks fresh while the trader works on a trade (decision, Daniel,
   * 2026-11-21): every rule the gate needs is re-checked about every 20 s for
   * the ticket as it stands, so Buy / Sell can reuse them and answer in about
   * a second. Stops when the tab is hidden, the trader is idle, a check
   * popup is open, or the market is closed, to keep model calls down.
   */
  const warm = useCallback(async () => {
    if (!sessionId || !inst || document.visibilityState !== "visible" || dialogOpen.current) return;
    if (Date.now() - lastActivity.current > IDLE_AFTER_MS) return;
    if (weekendClosed(new Date(), inst.assetClass)) return;
    const shot = chartRef.current?.capture();
    if (!shot) return;
    const req = ++warmReq.current;
    setWarming(true);
    try {
      const res = await fetch(`/api/workspace/sessions/${sessionId}/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeframe: tf, ...shot, ...ticketBody(draftRef.current), warm: true }),
      });
      const d = await res.json().catch(() => null);
      if (req === warmReq.current && res.ok && d) setView(d);
    } catch {
      /* the next round or Buy / Sell will try again */
    } finally {
      if (req === warmReq.current) setWarming(false);
    }
  }, [sessionId, inst, tf]);

  useEffect(() => {
    const t = setInterval(warm, WARM_EVERY_MS);
    return () => clearInterval(t);
  }, [warm]);
  // a changed ticket (side, stop, target) needs fresh checks soon
  const draftKey = draft ? `${draft.side}|${draft.stop}|${draft.target}|${draft.orderType}` : "";
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(warm, 1500);
    return () => clearTimeout(t);
  }, [draftKey, warm]);

  const onDraft = useCallback((d: TicketDraft) => {
    draftRef.current = d;
    lastActivity.current = Date.now();
    setDraft(d);
  }, []);

  async function answerRule(itemKey: string, answer: "yes" | "clear") {
    if (!sessionId) return;
    const res = await fetch(`/api/workspace/sessions/${sessionId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemKey, answer }),
    });
    if (res.ok) setView(await res.json());
  }

  function choosePlatform(p: string) {
    setPlatform(p);
    // Binance / Bybit tickets trade crypto
    if (isSpot(ticketKind(p)) && inst?.assetClass !== "crypto") {
      setAssetClass("crypto");
      setSymbol("BTCUSDT");
    }
  }

  const openCheck = (side: "buy" | "sell", d: TicketDraft) => {
    if (d.entry == null || !Number.isFinite(d.entry)) return setError("Enter a price for the trade first.");
    setError("");
    dialogOpen.current = true;
    setDialog({ side, draft: d });
  };
  const closeCheck = useCallback(() => {
    dialogOpen.current = false;
    setDialog(null);
  }, []);
  const capture = useCallback(() => chartRef.current?.capture() ?? null, []);

  const lastPrice = candles[candles.length - 1]?.close ?? null;
  const filtered = instruments.filter((i) => i.assetClass === assetClass);

  return (
    <AppFrame active="workspace" title="Trade workspace">
      <div
        className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6"
        onPointerDown={() => {
          lastActivity.current = Date.now();
        }}
      >
        {!boot ? (
          <p className="text-sm text-muted">Loading the workspace…</p>
        ) : boot.checklists.length === 0 ? (
          <section className="card mx-auto max-w-[640px] p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-line text-accent">
              <IconCandles className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-2xl font-light tracking-[-0.03em]">Approve a checklist first</h2>
            <p className="mx-auto mt-2 max-w-[30em] text-ink/75">The workspace checks each setup against your approved checklist.</p>
            <Link href="/checklist" className="btn btn-main btn-sm mt-6">Go to your checklist</Link>
          </section>
        ) : (
          <>
            {/* PR-TW-1: asset class, instrument, platform */}
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              {boot.checklists.length > 1 && (
                <Dropdown
                  value={edgeId}
                  onChange={setEdgeId}
                  options={boot.checklists.map((c) => ({
                    value: c.edgeId,
                    label: `${c.name} · v${c.versionNumber}`,
                  }))}
                  className="w-[180px]"
                  ariaLabel="Checklist"
                />
              )}
              <div className="flex rounded-full border border-line p-1" role="tablist" aria-label="Market">
                {(Object.keys(ASSET_LABEL) as Array<keyof typeof ASSET_LABEL>).map((a) => (
                  <button
                    key={a}
                    role="tab"
                    aria-selected={assetClass === a}
                    onClick={() => {
                      setAssetClass(a);
                      const first = instruments.find((i) => i.assetClass === a);
                      if (first) setSymbol(first.symbol);
                    }}
                    className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${assetClass === a ? "bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-ink" : "text-ink/65 hover:text-ink"}`}
                  >
                    {ASSET_LABEL[a]}
                  </button>
                ))}
              </div>
              <Dropdown
                value={symbol}
                onChange={setSymbol}
                options={filtered.map((i) => ({
                  value: i.symbol,
                  label: `${i.label}${i.ready ? "" : " (needs data key)"}`,
                }))}
                className="w-[160px]"
                ariaLabel="Instrument"
              />
              <Dropdown
                value={platform}
                onChange={choosePlatform}
                placeholder="Platform you trade on…"
                options={PLATFORMS.map((p) => ({ value: p, label: p }))}
                className="w-[190px]"
                ariaLabel="Platform you trade on"
              />
              {view && (
                <span className="ml-auto text-sm text-ink/70">
                  Checking against <span className="text-ink">{view.session.edgeName}</span>{view.session.versionNumber ? ` · v${view.session.versionNumber}` : ""}
                </span>
              )}
            </div>

            {inst && <SessionStrip assetClass={inst.assetClass} />}

            {error && <p role="alert" className="mb-3 text-sm text-fail">{error}</p>}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
              {/* chart: keeps its own height and stays in view while the panel scrolls */}
              <section className="card overflow-hidden p-0 xl:sticky xl:top-4" aria-label="Chart">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                  <span className="font-medium">{inst?.label ?? symbol}</span>
                  {lastPrice != null && inst && <span className="tabular-nums text-ink/80">{lastPrice.toFixed(inst.decimals)}</span>}
                  <div className="ml-auto flex flex-wrap gap-1" role="tablist" aria-label="Timeframe">
                    {TIMEFRAMES.map((t) => {
                      const wanted = view?.rules.some((r) => r.timeframe === t);
                      return (
                        <button
                          key={t}
                          role="tab"
                          aria-selected={tf === t}
                          onClick={() => setTf(t)}
                          className={`relative rounded-lg px-2.5 py-1 text-sm tabular-nums ${tf === t ? "bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-ink" : "text-ink/65 hover:text-ink"}`}
                          title={wanted ? "One of your rules needs this timeframe" : undefined}
                        >
                          {TF_LABEL[t]}
                          {wanted && <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[#dcff3c]" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="relative h-[min(62vh,600px)] min-h-[360px]">
                  {candles.length > 0 && inst && (
                    <ChartView key={`${inst.symbol}-${tf}`} ref={chartRef} candles={candles} indicators={indicators} decimals={inst.decimals} />
                  )}
                  {candles.length === 0 && (
                    <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-ink/70">
                      {marketError || "Loading prices…"}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-ink/65">
                  {indicators.map((i) => <span key={i.label}>{i.label}</span>)}
                  {dataAge != null && (
                    <span className={dataAge > 900 ? "text-maybe" : ""}>
                      {dataAge > 900 ? `Data is ${Math.round(dataAge / 60)} min old (market closed or delayed)` : "Live data"}
                    </span>
                  )}
                  <span className="ml-auto">
                    {checking
                      ? "Edge is checking this view…"
                      : warming
                        ? "Keeping your checks fresh for Buy and Sell…"
                        : "Edge reads this chart itself; no screenshots needed."}
                  </span>
                </div>
              </section>

              {/* your rules + ticket */}
              <div className="space-y-4">
                {view && (
                  <RulesPanel view={view} tf={tf} checking={checking} warming={warming} onShowTf={setTf} onAnswer={answerRule} onRecheck={runCheck} />
                )}
                {view && inst && (
                  isSpot(kind) && inst.assetClass !== "crypto" ? (
                    <section className="card p-5 text-sm" aria-label="Trade ticket">
                      <p className="text-ink/85">{platform} trades crypto. Pick a crypto pair, or choose the platform you trade {inst.label} on.</p>
                      <button
                        type="button"
                        className="chip-btn mt-3 py-1.5 text-xs"
                        onClick={() => {
                          setAssetClass("crypto");
                          setSymbol("BTCUSDT");
                        }}
                      >
                        Switch to BTC/USDT
                      </button>
                    </section>
                  ) : kind === "mt5" || kind === "mt4" ? (
                    <MtTicket key={`${platform}-${inst.symbol}`} variant={kind} platform={platform} inst={inst} risk={view.risk} lastPrice={lastPrice} disabled={dialog != null} onDraft={onDraft} onSubmit={openCheck} />
                  ) : kind === "ctrader" || kind === "tradelocker" || kind === "matchtrader" ? (
                    <TileTicket key={`${platform}-${inst.symbol}`} variant={kind} platform={platform} inst={inst} risk={view.risk} lastPrice={lastPrice} disabled={dialog != null} onDraft={onDraft} onSubmit={openCheck} />
                  ) : isSpot(kind) ? (
                    <SpotTicket key={`${platform}-${inst.symbol}`} variant={kind as "binance" | "bybit" | "okx"} platform={platform} inst={inst} risk={view.risk} lastPrice={lastPrice} disabled={dialog != null} onDraft={onDraft} onSubmit={openCheck} />
                  ) : (
                    <EdgeTicket key={`${platform}-${inst.symbol}`} inst={inst} risk={view.risk} lastPrice={lastPrice} disabled={dialog != null} onDraft={onDraft} onSubmit={openCheck} />
                  )
                )}
              </div>
            </div>

            {dialog && view && inst && (
              <CheckDialog
                view={view}
                side={dialog.side}
                draft={dialog.draft}
                platform={platform}
                instLabel={inst.label}
                decimals={inst.decimals}
                tf={tf}
                capture={capture}
                onClose={closeCheck}
                onView={setView}
                onShowTf={setTf}
              />
            )}
          </>
        )}
      </div>
    </AppFrame>
  );
}
