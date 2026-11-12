"use client";

/**
 * Trade workspace (PRD 4.4, 4.5, F5, F6).
 * Pick the instrument; Edge's own chart sits beside the live checklist. As you
 * move through timeframes, Edge captures the view and checks each rule. Press
 * Buy or Sell: code decides Approved / Denied / Needs evidence.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppFrame from "../../_components/app-frame";
import { IconCandles, IconCheck, IconLock, IconX } from "../../_components/icons";
import ChartView, { type Candle, type ChartHandle, type IndicatorSeries } from "./chart";

/* ------------------------------------------------------------- types ----- */

type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const TF_LABEL: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1D" };
type Status = "pass" | "fail" | "inconclusive" | "unchecked";

interface Instrument {
  symbol: string;
  label: string;
  assetClass: "crypto" | "forex" | "metals" | "indices";
  decimals: number;
  ready: boolean;
}
interface Check {
  result: "pass" | "fail" | "inconclusive";
  observed: string;
  reasoning: string;
  confidence: string | null;
  missing: string | null;
  source: string;
  timeframe: string | null;
  evidence: { candleRange?: [number, number]; referenceImageIds?: string[] } | null;
  checkedAt: string;
}
interface RuleView {
  itemKey: string;
  text: string;
  category: string;
  hardGate: boolean;
  mode: "chart" | "code" | "trader";
  requiredTimeframe: string | null;
  timeframe: Timeframe | null;
  confirmedExamples: number;
  status: Status;
  stale: boolean;
  check: Check | null;
}
interface Risk {
  maxRiskPct: { value: number; itemKey: string } | null;
  minRR: { value: number; itemKey: string } | null;
  maxTradesPerDay: { value: number; itemKey: string } | null;
  stopRequired: boolean;
}
interface View {
  session: { id: string; edgeId: string; edgeName: string; versionNumber: number | null; instrument: string; platform: string | null };
  risk: Risk;
  indicators: Array<{ kind: "ema" | "sma" | "rsi"; period: number }>;
  rules: RuleView[];
}
interface Decision {
  decisionId: string;
  result: "approved" | "denied" | "needs_evidence";
  validUntil: string | null;
  resolution: string | null;
  reasons: {
    ticket: string[];
    cannotCheck: string | null;
    failing: Array<{ itemKey: string; text: string; reason: string }>;
    missing: Array<{ itemKey: string; text: string; reason: string; mode: string; timeframe: string | null }>;
    softFails: Array<{ itemKey: string; text: string; reason: string }>;
  };
  ticket: { instrument: string; side: string; entry: number; stop: number | null; target: number | null; riskPct: number | null; riskReward: number | null };
}

const ASSET_LABEL = { crypto: "Crypto", forex: "Forex", metals: "Metals", indices: "Indices" } as const;
const PLATFORMS = ["MetaTrader 5", "MetaTrader 4", "cTrader", "TradingView", "Binance", "Bybit", "Other"];

/* -------------------------------------------------------------- page ----- */

export default function Workspace() {
  const [boot, setBoot] = useState<{ checklists: Array<{ edgeId: string; name: string; versionNumber: number }>; instruments: Instrument[] } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [edgeId, setEdgeId] = useState("");
  const [assetClass, setAssetClass] = useState<Instrument["assetClass"]>("crypto");
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
  const [error, setError] = useState("");
  const chartRef = useRef<ChartHandle>(null);
  const frameReq = useRef(0);

  const instruments = useMemo(() => boot?.instruments ?? [], [boot]);
  const inst = instruments.find((i) => i.symbol === symbol) ?? null;
  const sessionId = view?.session.id ?? null;

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
      const sym = v?.session.instrument ?? pref.symbol ?? "BTCUSDT";
      setEdgeId(e);
      setSymbol(sym);
      setAssetClass(d.instruments.find((i: Instrument) => i.symbol === sym)?.assetClass ?? "crypto");
      setPlatform(v?.session.platform ?? pref.platform ?? "");
      if (v && v.session.edgeId === e) setView(v);
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
    try {
      localStorage.setItem("edge-workspace", JSON.stringify({ edgeId, symbol, platform }));
    } catch {
      /* not remembered */
    }
    return () => {
      alive = false;
    };
  }, [edgeId, symbol, platform, view]);

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
        body: JSON.stringify({ timeframe: tf, ...shot }),
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

  async function confirmRule(itemKey: string, confirmed: boolean) {
    if (!sessionId) return;
    const res = await fetch(`/api/workspace/sessions/${sessionId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemKey, confirmed }),
    });
    if (res.ok) setView(await res.json());
  }

  const lastPrice = candles[candles.length - 1]?.close ?? null;
  const filtered = instruments.filter((i) => i.assetClass === assetClass);

  return (
    <AppFrame active="workspace" title="Trade workspace">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
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
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {boot.checklists.length > 1 && (
                <select className="input h-10 w-auto py-0 text-sm" value={edgeId} onChange={(e) => setEdgeId(e.target.value)} aria-label="Checklist">
                  {boot.checklists.map((c) => (
                    <option key={c.edgeId} value={c.edgeId}>{c.name} · v{c.versionNumber}</option>
                  ))}
                </select>
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
              <select className="input h-10 w-auto py-0 text-sm" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Instrument">
                {filtered.map((i) => (
                  <option key={i.symbol} value={i.symbol}>{i.label}{i.ready ? "" : " (needs data key)"}</option>
                ))}
              </select>
              <select className="input h-10 w-auto py-0 text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform you trade on">
                <option value="">Platform you trade on…</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {view && (
                <span className="ml-auto text-sm text-ink/70">
                  Checking against <span className="text-ink">{view.session.edgeName}</span>{view.session.versionNumber ? ` · v${view.session.versionNumber}` : ""}
                </span>
              )}
            </div>

            {error && <p role="alert" className="mb-3 text-sm text-fail">{error}</p>}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
              {/* chart */}
              <section className="card overflow-hidden p-0" aria-label="Chart">
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
                  <span className="ml-auto">{checking ? "Edge is checking this view…" : "Edge captures the chart itself; no screenshots needed."}</span>
                </div>
              </section>

              {/* live checklist + ticket */}
              <div className="space-y-4">
                {view && (
                  <LivePanel
                    view={view}
                    tf={tf}
                    checking={checking}
                    onShowTf={setTf}
                    onConfirm={confirmRule}
                    onRecheck={runCheck}
                  />
                )}
                {view && inst && (
                  <TicketPanel
                    key={`${view.session.id}`}
                    view={view}
                    inst={inst}
                    tf={tf}
                    lastPrice={lastPrice}
                    capture={() => chartRef.current?.capture() ?? null}
                    onDecided={(v) => v && setView(v)}
                    onShowTf={setTf}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppFrame>
  );
}

/* ------------------------------------------------------ live checklist --- */

const STATUS_UI: Record<Status, { icon: string; label: string; cls: string }> = {
  pass: { icon: "✓", label: "Pass", cls: "tag-pass" },
  fail: { icon: "✕", label: "Fail", cls: "tag-fail" },
  inconclusive: { icon: "?", label: "Inconclusive", cls: "tag-maybe" },
  unchecked: { icon: "○", label: "Not yet checked", cls: "tag-neutral" },
};

function LivePanel({
  view,
  tf,
  checking,
  onShowTf,
  onConfirm,
  onRecheck,
}: {
  view: View;
  tf: Timeframe;
  checking: boolean;
  onShowTf: (t: Timeframe) => void;
  onConfirm: (k: string, c: boolean) => void;
  onRecheck: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const needViews = [...new Set(view.rules.filter((r) => r.mode === "chart" && r.timeframe && r.timeframe !== tf && r.status !== "pass" && r.status !== "fail").map((r) => r.timeframe!))];
  const noExamples = view.rules.filter((r) => r.mode === "chart" && r.confirmedExamples === 0);

  return (
    <section className="card p-0" aria-label="Live checklist">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-medium">Live checklist</h2>
        <button type="button" className="text-xs text-ink/70 hover:text-ink" onClick={onRecheck} disabled={checking}>
          {checking ? "Checking…" : "Check this view again"}
        </button>
      </header>

      {/* PR-TW-4: ask for the views Edge still needs */}
      {needViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[color-mix(in_srgb,#dcff3c_6%,transparent)] px-4 py-2.5 text-sm">
          <span className="text-ink/85">Edge still needs:</span>
          {needViews.map((t) => (
            <button key={t} className="chip-btn py-1 text-xs" onClick={() => onShowTf(t)}>Show the {TF_LABEL[t]} chart</button>
          ))}
        </div>
      )}
      {noExamples.length > 0 && (
        <p className="border-b border-line px-4 py-2.5 text-sm text-maybe">
          {noExamples.length} chart rule{noExamples.length === 1 ? " has" : "s have"} no confirmed example yet, so Edge can&apos;t pass {noExamples.length === 1 ? "it" : "them"}.{" "}
          <Link href="/app/evidence" className="underline">Add examples</Link>
        </p>
      )}

      <ul className="divide-y divide-line">
        {view.rules.map((r, i) => {
          const ui = STATUS_UI[r.status];
          const isOpen = open === r.itemKey;
          return (
            <li key={r.itemKey} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.92rem] leading-snug">
                    {r.hardGate && <IconLock className="mr-1 inline h-3 w-3 text-pass" />}
                    {r.text}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {r.mode === "trader" ? (
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink/85">
                        <input type="checkbox" className="h-4 w-4 accent-[#5ef088]" checked={r.status === "pass"} onChange={(e) => onConfirm(r.itemKey, e.target.checked)} />
                        I confirm this
                      </label>
                    ) : (
                      <span className={`tag ${ui.cls}`}>
                        <span aria-hidden="true">{ui.icon}</span> {ui.label}
                      </span>
                    )}
                    {r.mode === "code" && <span className="text-xs text-ink/60">from your ticket</span>}
                    {r.timeframe && <span className="text-xs text-ink/60">{TF_LABEL[r.timeframe]}</span>}
                    {r.check && r.mode === "chart" && (
                      <button className="text-xs text-ink/70 underline-offset-2 hover:underline" onClick={() => setOpen(isOpen ? null : r.itemKey)} aria-expanded={isOpen}>
                        {isOpen ? "Hide why" : "Why?"}
                      </button>
                    )}
                  </div>
                  {r.check && r.mode === "chart" && (r.status === "inconclusive" || r.status === "unchecked") && !isOpen && (
                    <p className="mt-1 text-xs text-ink/65">{r.check.missing ? `Needs ${r.check.missing}.` : r.check.reasoning}</p>
                  )}
                  {isOpen && r.check && (
                    <div className="mt-2 space-y-1.5 rounded-xl bg-panel px-3 py-2.5 text-sm">
                      <p className="text-ink">{r.check.reasoning}</p>
                      {r.check.observed && <p className="text-ink/70">{r.check.observed}</p>}
                      <p className="text-xs text-ink/55">
                        {r.check.timeframe ? `${TF_LABEL[r.check.timeframe as Timeframe] ?? r.check.timeframe} chart` : ""}
                        {r.check.evidence?.candleRange ? ` · candles ${r.check.evidence.candleRange[0]}–${r.check.evidence.candleRange[1]}` : ""}
                        {r.check.confidence ? ` · ${r.check.confidence} confidence` : ""}
                        {` · checked ${new Date(r.check.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                      </p>
                      {(r.check.evidence?.referenceImageIds?.length ?? 0) > 0 && (
                        <div className="flex gap-2 pt-1">
                          {r.check.evidence!.referenceImageIds!.slice(0, 3).map((id) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={id} src={`/api/evidence/${id}/file`} alt="Your example this was compared with" className="h-14 w-20 rounded-md border border-line object-cover" />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------- ticket + gate ----- */

function TicketPanel({
  view,
  inst,
  tf,
  lastPrice,
  capture,
  onDecided,
  onShowTf,
}: {
  view: View;
  inst: Instrument;
  tf: Timeframe;
  lastPrice: number | null;
  capture: () => { image: string } | null;
  onDecided: (v: View | null) => void;
  onShowTf: (t: Timeframe) => void;
}) {
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [account, setAccount] = useState(() => {
    try {
      return localStorage.getItem("edge-account-size") ?? "";
    } catch {
      return "";
    }
  });
  const [riskAmt, setRiskAmt] = useState("");
  const [busy, setBusy] = useState<"" | "buy" | "sell">("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState("");

  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
  const e = n(entry) ?? lastPrice;
  const st = n(stop);
  const tg = n(target);
  const rr = e != null && st != null && tg != null && Math.abs(e - st) > 0 ? Math.abs(tg - e) / Math.abs(e - st) : null;
  const acc = n(account);
  const ra = n(riskAmt);
  const riskPct = acc && ra != null ? (ra / acc) * 100 : null;

  async function check(side: "buy" | "sell") {
    if (busy) return;
    if (e == null || !Number.isFinite(e)) return setError("Enter an entry price.");
    setBusy(side);
    setError("");
    try {
      localStorage.setItem("edge-account-size", account);
    } catch {
      /* not remembered */
    }
    try {
      const shot = capture();
      const res = await fetch(`/api/workspace/sessions/${view.session.id}/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          side,
          entry: e,
          stop: st,
          target: tg,
          accountSize: acc,
          riskAmount: ra,
          timeframe: tf,
          image: shot?.image,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Edge couldn't check this trade.");
      setDecision(d);
      // refresh the live panel with the gate's fresh checks
      const v = await fetch("/api/workspace/sessions").then((r) => r.json()).catch(() => null);
      onDecided(v?.view ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edge couldn't check this trade.");
    } finally {
      setBusy("");
    }
  }

  const field = "input py-2 text-sm tabular-nums";
  return (
    <section className="card p-0" aria-label="Trade ticket">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-medium">Ticket</h2>
        <span className="text-xs text-ink/60">{inst.label}</span>
      </header>
      <div className="grid grid-cols-2 gap-3 px-4 py-4">
        <label className="text-xs text-ink/70">Entry
          <input className={field} inputMode="decimal" placeholder={lastPrice != null ? lastPrice.toFixed(inst.decimals) : "price"} value={entry} onChange={(x) => setEntry(x.target.value)} />
        </label>
        <label className="text-xs text-ink/70">Stop{view.risk.stopRequired && <span className="text-maybe"> (required)</span>}
          <input className={field} inputMode="decimal" value={stop} onChange={(x) => setStop(x.target.value)} />
        </label>
        <label className="text-xs text-ink/70">Target
          <input className={field} inputMode="decimal" value={target} onChange={(x) => setTarget(x.target.value)} />
        </label>
        <label className="text-xs text-ink/70">Account size
          <input className={field} inputMode="decimal" value={account} onChange={(x) => setAccount(x.target.value)} />
        </label>
        <label className="col-span-2 text-xs text-ink/70">Amount you&apos;re risking on this trade
          <input className={field} inputMode="decimal" value={riskAmt} onChange={(x) => setRiskAmt(x.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2.5 text-sm">
        <span className="text-ink/70">Risk <b className={`font-medium ${view.risk.maxRiskPct && riskPct != null && riskPct > view.risk.maxRiskPct.value ? "text-fail" : "text-ink"}`}>{riskPct != null ? `${riskPct.toFixed(2)}%` : "–"}</b>{view.risk.maxRiskPct && <span className="text-ink/50"> / max {view.risk.maxRiskPct.value}%</span>}</span>
        <span className="text-ink/70">R:R <b className={`font-medium ${view.risk.minRR && rr != null && rr < view.risk.minRR.value ? "text-fail" : "text-ink"}`}>{rr != null ? `1:${rr.toFixed(2)}` : "–"}</b>{view.risk.minRR && <span className="text-ink/50"> / min 1:{view.risk.minRR.value}</span>}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        <button type="button" className="h-11 rounded-full bg-[#26a69a] font-semibold text-[#04110a] transition-transform hover:-translate-y-0.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => check("buy")}>
          {busy === "buy" ? "Checking…" : "Buy"}
        </button>
        <button type="button" className="h-11 rounded-full bg-[#ef5350] font-semibold text-[#1a0507] transition-transform hover:-translate-y-0.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => check("sell")}>
          {busy === "sell" ? "Checking…" : "Sell"}
        </button>
      </div>
      <p className="px-4 pb-4 text-xs text-ink/55">Edge checks the trade against your checklist first. It never places orders for you in this version.</p>
      {error && <p role="alert" className="px-4 pb-4 text-sm text-fail">{error}</p>}
      {decision && (
        <DecisionCard
          decision={decision}
          decimals={inst.decimals}
          onClose={() => setDecision(null)}
          onShowTf={(t) => {
            setDecision(null);
            onShowTf(t);
          }}
          onResolved={(r) => setDecision({ ...decision, resolution: r })}
        />
      )}
    </section>
  );
}

function DecisionCard({
  decision,
  decimals,
  onClose,
  onShowTf,
  onResolved,
}: {
  decision: Decision;
  decimals: number;
  onClose: () => void;
  onShowTf: (t: Timeframe) => void;
  onResolved: (r: string) => void;
}) {
  const [left, setLeft] = useState(() => (decision.validUntil ? Math.max(0, Math.round((Date.parse(decision.validUntil) - Date.now()) / 1000)) : 0));
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!decision.validUntil || decision.resolution) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.round((Date.parse(decision.validUntil!) - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [decision.validUntil, decision.resolution]);

  async function act(action: "accept" | "override" | "placed" | "cancel") {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/workspace/decisions/${decision.decisionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(d.error || "Couldn't save that.");
        if (d.code === "expired" || d.code === "price_moved") onResolved("expired");
        return;
      }
      onResolved(d.resolution);
    } finally {
      setBusy(false);
    }
  }

  const r = decision.reasons;
  const t = decision.ticket;
  const head =
    decision.result === "approved"
      ? { title: "Passes your checklist", cls: "border-pass bg-pass-bg text-pass", icon: "✓" }
      : decision.result === "denied"
        ? { title: "Fails your checklist", cls: "border-fail bg-err-bg text-fail", icon: "✕" }
        : { title: "Needs more evidence", cls: "border-maybe bg-warn-bg text-maybe", icon: "?" };
  const expired = decision.result === "approved" && left === 0 && !decision.resolution;

  return (
    <div className="border-t border-line px-4 py-4" role="status" aria-live="polite">
      <div className={`rounded-2xl border px-4 py-3 ${head.cls}`}>
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold"><span aria-hidden="true">{head.icon}</span> {head.title}</p>
          <button className="text-ink/60 hover:text-ink" onClick={onClose} aria-label="Close decision"><IconX /></button>
        </div>
        <p className="mt-1 text-sm text-ink/80">
          {t.side === "buy" ? "Buy" : "Sell"} {t.instrument} at {Number(t.entry).toFixed(decimals)}
          {t.stop != null ? ` · stop ${Number(t.stop).toFixed(decimals)}` : ""}
          {t.target != null ? ` · target ${Number(t.target).toFixed(decimals)}` : ""}
        </p>
      </div>

      <ul className="mt-3 space-y-2 text-sm">
        {r.cannotCheck && <li className="text-maybe">Edge can&apos;t check right now: {r.cannotCheck}</li>}
        {r.ticket.map((x) => <li key={x} className="text-fail">✕ {x}</li>)}
        {r.failing.map((f) => (
          <li key={f.itemKey}><span className="text-fail">✕ {f.text}</span><span className="block text-ink/70">{f.reason}</span></li>
        ))}
        {r.missing.map((f) => (
          <li key={f.itemKey}>
            <span className="text-maybe">? {f.text}</span>
            <span className="block text-ink/70">{f.reason}</span>
            {f.timeframe && f.mode === "chart" && (
              <button className="chip-btn mt-1 py-1 text-xs" onClick={() => {
                const map: Record<string, Timeframe> = { "4h": "4h", "1h": "1h", "15m": "15m", "5m": "5m", "1m": "1m", "30m": "30m", "1d": "1d" };
                const k = f.timeframe!.toLowerCase().replace(/\s/g, "");
                const tf = map[k] ?? (k === "daily" || k === "d" ? "1d" : null);
                if (tf) onShowTf(tf);
              }}>Show the {f.timeframe} chart</button>
            )}
          </li>
        ))}
        {r.softFails.map((f) => (
          <li key={f.itemKey} className="text-ink/70">Soft rule not met: {f.text}</li>
        ))}
      </ul>

      <div className="mt-4">
        {decision.resolution === "placed" ? (
          <p className="flex items-center gap-2 text-sm text-pass"><IconCheck /> Recorded as placed. It goes into your journal.</p>
        ) : decision.resolution === "accepted_denial" ? (
          <p className="text-sm text-ink/80">Not taken. That decision is recorded.</p>
        ) : decision.resolution === "cancelled" ? (
          <p className="text-sm text-ink/80">Cancelled.</p>
        ) : decision.resolution === "expired" || expired ? (
          <p className="text-sm text-maybe">This approval expired. Press Buy or Sell again to re-check.</p>
        ) : decision.result === "approved" ? (
          <div className="space-y-2">
            <p className="text-sm text-ink/80">Place the trade on your platform now, then confirm here. Valid for <b className="tabular-nums">{left}s</b>.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-main btn-sm" disabled={busy} onClick={() => act("placed")}>I placed this trade</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => act("cancel")}>Don&apos;t trade</button>
            </div>
          </div>
        ) : decision.resolution === "overridden" ? (
          <div className="space-y-2">
            <p className="text-sm text-ink/80">Override recorded. If you place the trade, confirm it here.</p>
            <button className="btn btn-sm" disabled={busy} onClick={() => act("placed")}>I placed this trade</button>
          </div>
        ) : overriding ? (
          <div className="space-y-2">
            <label className="block text-sm text-ink/80">Why are you overriding? <span className="text-ink/50">(optional)</span>
              <input className="input mt-1 py-2 text-sm" value={reason} maxLength={500} onChange={(x) => setReason(x.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act("override")}>Override and record it</button>
              <button className="btn btn-sm" onClick={() => setOverriding(false)}>Back</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-main btn-sm" disabled={busy} onClick={() => act("accept")}>Accept, don&apos;t trade</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => setOverriding(true)}>Override</button>
          </div>
        )}
        {msg && <p role="alert" className="mt-2 text-sm text-fail">{msg}</p>}
      </div>
      <p className="mt-3 text-xs text-ink/50">Edge says whether a trade passes your checklist. It never predicts whether a trade will win.</p>
    </div>
  );
}
