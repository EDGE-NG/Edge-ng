"use client";

/**
 * Trade tickets that look like the platform the trader uses (decision,
 * Daniel, 2026-11-21): an MT5-style New Order window, a Binance-style spot
 * order form, and Edge's own ticket for everything else. Edge does not send
 * orders yet; every ticket ends in Edge's pre-trade check (PR-GT-1).
 *
 * Risk is worked out in code from the ticket (PR-GT-3): lots x contract size
 * x distance to the stop, converted to USD where the quote currency allows.
 */
import { useEffect, useMemo, useState } from "react";
import type { Instrument, Risk, TicketDraft } from "./types";

const ACCOUNT_KEY = "edge-account-size";

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* not remembered */
  }
}

const num = (s: string): number | null => {
  if (s.trim() === "") return null;
  const v = Number(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
};
const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Units per lot on an MT5-style account. */
function contractSize(inst: Instrument): number {
  if (inst.assetClass === "forex") return 100_000;
  if (inst.symbol.startsWith("XAU")) return 100;
  if (inst.symbol.startsWith("XAG")) return 5_000;
  return 1;
}

/** USD per one unit of the quote currency, or null when Edge can't tell (e.g. GBP/JPY). */
function usdPerQuote(inst: Instrument, price: number | null): number | null {
  if (inst.assetClass === "crypto" || inst.assetClass === "indices") return 1; // USDT / USD
  const [b, q] = inst.symbol.split("/");
  if (q === "USD") return 1;
  if (b === "USD" && price) return 1 / price;
  return null;
}

function inferSide(entry: number | null, stop: number | null): "buy" | "sell" | null {
  if (entry == null || stop == null || entry === stop) return null;
  return stop < entry ? "buy" : "sell";
}

/** Edge's own reading of the ticket against the plan's limits. */
function EdgeLine({ riskAmount, accountSize, rr, risk, ccy }: { riskAmount: number | null; accountSize: number | null; rr: number | null; risk: Risk; ccy: string }) {
  const pct = riskAmount != null && accountSize ? (riskAmount / accountSize) * 100 : null;
  const over = risk.maxRiskPct && pct != null && pct > risk.maxRiskPct.value;
  const under = risk.minRR && rr != null && rr < risk.minRR.value;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-line bg-accent/[0.04] px-4 py-2.5 text-[13px] tabular-nums text-ink/70" aria-live="polite">
      <span className="text-[11px] font-semibold tracking-wide text-accent">EDGE</span>
      <span>
        Risk{" "}
        <b className={`font-medium ${over ? "text-fail" : "text-ink"}`}>
          {pct != null ? `${fmt(riskAmount!, 2)} ${ccy} · ${pct.toFixed(2)}%` : "–"}
        </b>
        {risk.maxRiskPct && <span className="text-xs text-muted"> / max {risk.maxRiskPct.value}%</span>}
        {over && <span className="sr-only"> (over your limit)</span>}
      </span>
      <span>
        R:R <b className={`font-medium ${under ? "text-fail" : "text-ink"}`}>{rr != null ? `1:${rr.toFixed(2)}` : "–"}</b>
        {risk.minRR && <span className="text-xs text-muted"> / min 1:{risk.minRR.value}</span>}
        {under && <span className="sr-only"> (under your minimum)</span>}
      </span>
    </div>
  );
}

const rrOf = (entry: number | null, stop: number | null, target: number | null) =>
  entry != null && stop != null && target != null && Math.abs(entry - stop) > 0 ? Math.abs(target - entry) / Math.abs(entry - stop) : null;

function Head({ title, platform }: { title: string; platform: string }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="flex items-center gap-2 text-xs text-muted">
        {platform}
        <span className="rounded-full border border-dashed border-line px-2 py-0.5 text-[11px]">Connect account: coming next</span>
      </span>
    </header>
  );
}

const field = "input h-[38px] py-0 text-sm tabular-nums";
const fine = <p className="px-4 pb-4 text-xs text-ink/55">Edge checks your trade against your checklist before it goes anywhere.</p>;

interface TicketProps {
  inst: Instrument;
  risk: Risk;
  lastPrice: number | null;
  disabled: boolean;
  onDraft: (d: TicketDraft) => void;
  onSubmit: (side: "buy" | "sell", d: TicketDraft) => void;
}

/* ------------------------------------------------------------ MT5 style --- */

export function MtTicket({ inst, risk, lastPrice, disabled, onDraft, onSubmit, platform }: TicketProps & { platform: string }) {
  const [type, setType] = useState<"market" | "pending">("market");
  const [price, setPrice] = useState("");
  const [lots, setLots] = useState("0.10");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [balance, setBalance] = useState(() => readStored(ACCOUNT_KEY));
  const [manualRisk, setManualRisk] = useState("");

  const entry = type === "pending" ? num(price) : lastPrice;
  const stop = num(sl);
  const target = num(tp);
  const volume = num(lots);
  const conv = usdPerQuote(inst, entry);
  const units = volume != null ? volume * contractSize(inst) : null;
  const riskAmount =
    conv == null ? num(manualRisk) : units != null && entry != null && stop != null ? units * Math.abs(entry - stop) * conv : null;
  const accountSize = num(balance);

  const draft = useMemo<TicketDraft>(
    () => ({
      side: inferSide(entry, stop),
      entry,
      stop,
      target,
      accountSize,
      riskAmount,
      orderType: type,
      size: volume,
      sizeUnit: "lots",
    }),
    [entry, stop, target, accountSize, riskAmount, type, volume]
  );
  useEffect(() => onDraft(draft), [draft, onDraft]);

  const step = (d: number) => setLots((v) => Math.max(0.01, Math.round(((num(v) ?? 0) + d) * 100) / 100).toFixed(2));
  const submit = (side: "buy" | "sell") => {
    store(ACCOUNT_KEY, balance);
    onSubmit(side, { ...draft, side, entry: type === "pending" ? entry : lastPrice });
  };
  const code = inst.symbol.replace("/", "");

  return (
    <section className="card p-0" aria-label="Trade ticket">
      <Head title="New order" platform={platform} />
      <div className="grid gap-3 px-4 py-3.5">
        <p className="text-[13px]">
          <b className="font-semibold">{code}</b>, <span className="text-muted">{inst.label}</span>
        </p>
        <label className="grid gap-1 text-xs text-ink/70">
          Type
          <select className={field} value={type} onChange={(e) => setType(e.target.value as "market" | "pending")}>
            <option value="market">Market Execution</option>
            <option value="pending">Pending Order</option>
          </select>
        </label>
        {type === "pending" && (
          <label className="grid gap-1 text-xs text-ink/70">
            Price
            <input className={field} inputMode="decimal" value={price} placeholder={lastPrice != null ? lastPrice.toFixed(inst.decimals) : ""} onChange={(e) => setPrice(e.target.value)} />
          </label>
        )}
        <div className="grid gap-1 text-xs text-ink/70">
          <span id="mt-vol">Volume</span>
          <div className="grid grid-cols-[38px_1fr_38px]">
            <button type="button" className="h-[38px] rounded-l-xl border border-line bg-panel text-base" aria-label="Less volume" onClick={() => step(-0.01)}>−</button>
            <input className={`${field} rounded-none border-x-0 text-center`} inputMode="decimal" aria-labelledby="mt-vol" value={lots} onChange={(e) => setLots(e.target.value)} />
            <button type="button" className="h-[38px] rounded-r-xl border border-line bg-panel text-base" aria-label="More volume" onClick={() => step(0.01)}>+</button>
          </div>
          <span className="text-[11px] text-muted tabular-nums">
            {units != null ? `${fmt(units, 0)} ${inst.assetClass === "forex" ? inst.symbol.split("/")[0] : "units"}` : "–"} · lots
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="grid gap-1 text-xs text-ink/70">
            <span>Stop Loss{risk.stopRequired && <span className="text-maybe"> (required)</span>}</span>
            <input className={field} inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-ink/70">
            Take Profit
            <input className={field} inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="grid gap-1 text-xs text-ink/70">
            Account balance (USD)
            <input className={field} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
          </label>
          {conv == null && (
            <label className="grid gap-1 text-xs text-ink/70">
              Amount at risk (USD)
              <input className={field} inputMode="decimal" value={manualRisk} onChange={(e) => setManualRisk(e.target.value)} />
            </label>
          )}
        </div>
        <div className="text-center tabular-nums">
          <div className="text-[22px] font-semibold tracking-tight">{lastPrice != null ? lastPrice.toFixed(inst.decimals) : "–"}</div>
          <div className="text-[11px] text-muted">Market price</div>
        </div>
      </div>
      <EdgeLine riskAmount={riskAmount} accountSize={accountSize} rr={rrOf(entry, stop, target)} risk={risk} ccy="USD" />
      <div className="grid grid-cols-2 gap-2.5 px-4 pt-3.5 pb-3">
        <button type="button" disabled={disabled} onClick={() => submit("sell")} className="h-[46px] rounded-lg bg-[#d63a3a] font-semibold leading-tight text-white transition hover:brightness-110 disabled:opacity-50">
          Sell<small className="block text-[11px] font-normal opacity-85">{type === "market" ? "by Market" : "Pending"}</small>
        </button>
        <button type="button" disabled={disabled} onClick={() => submit("buy")} className="h-[46px] rounded-lg bg-[#2f6fde] font-semibold leading-tight text-white transition hover:brightness-110 disabled:opacity-50">
          Buy<small className="block text-[11px] font-normal opacity-85">{type === "market" ? "by Market" : "Pending"}</small>
        </button>
      </div>
      {fine}
    </section>
  );
}

/* ------------------------------------------------ exchange spot style --- */

/**
 * Exchange spot order form (Binance / Bybit / OKX). It keeps the exchange's
 * own dark look whatever Edge's theme, so traders find everything where they
 * expect it: Buy/Sell, Limit / Market / Stop Limit, Price, Amount, the
 * diamond-marked % slider, Total, TP/SL, Avbl, Max Buy and Est. Fee.
 */
const BX = {
  bg: "#181a20",
  field: "#2b3139",
  line: "#474d57",
  ink: "#eaecef",
  muted: "#848e9c",
  yellow: "#fcd535",
  green: "#2ebd85",
  red: "#f6465d",
};
const TAKER_FEE = 0.001; // shown as an estimate only

function BxField({
  label,
  unit,
  value,
  onChange,
  disabled,
}: {
  label: string;
  unit: string;
  value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm transition-colors focus-within:border-[#fcd535]"
      style={disabled ? { background: BX.field, borderColor: "transparent" } : { borderColor: BX.line }}
    >
      <span className="shrink-0 text-[13px]" style={{ color: BX.muted }}>{label}</span>
      <input
        className="h-full min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none placeholder:text-[#848e9c]"
        style={{ color: disabled ? BX.muted : BX.ink }}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={`${label} in ${unit}`}
      />
      <span className="shrink-0 text-[13px]" style={{ color: BX.muted }}>{unit}</span>
    </label>
  );
}

/** The exchange's % slider: a thin rail with diamond marks at 0 / 25 / 50 / 75 / 100. */
function BxSlider({ pct, onChange, label }: { pct: number; onChange: (p: number) => void; label: string }) {
  return (
    <div>
      <div className="relative mx-1.5 mt-0.5 h-[18px]">
        <span className="absolute inset-x-0 top-2 h-0.5" style={{ background: BX.line }} />
        <span className="absolute left-0 top-2 h-0.5" style={{ background: BX.ink, width: `${pct}%` }} />
        {[0, 25, 50, 75, 100].map((m) => (
          <span
            key={m}
            className="absolute top-[5px] -ml-1 h-2 w-2 rotate-45 rounded-[1px] border-2"
            style={{ left: `${m}%`, borderColor: pct >= m ? BX.ink : BX.line, background: pct >= m ? BX.ink : BX.bg }}
          />
        ))}
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => onChange(Number(e.target.value))}
          className="peer absolute inset-0 m-0 w-full cursor-pointer opacity-0"
          aria-label={label}
        />
        <span
          className="pointer-events-none absolute top-[3px] -ml-1.5 h-3 w-3 rotate-45 rounded-[2px] border-[3px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#fcd535]"
          style={{ left: `${pct}%`, borderColor: BX.ink, background: BX.bg }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: BX.muted }} aria-hidden>
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

type BnType = "limit" | "market" | "stop_limit";

export function SpotTicket({ inst, risk, lastPrice, disabled, onDraft, onSubmit, platform }: TicketProps & { platform: string }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<BnType>("limit");
  const [price, setPrice] = useState("");
  const [trigger, setTrigger] = useState("");
  const [amount, setAmount] = useState("");
  const [avbl, setAvbl] = useState(() => readStored(ACCOUNT_KEY));
  const [tpsl, setTpsl] = useState(true);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");

  const [baseAsset, quoteAsset] = inst.label.includes("/") ? inst.label.split("/") : [inst.symbol, "USDT"];
  const entry = type === "market" ? lastPrice : num(price) ?? lastPrice;
  const qty = num(amount);
  const available = num(avbl);
  const stop = tpsl ? num(sl) : null;
  const target = tpsl ? num(tp) : null;
  const total = qty != null && entry != null ? qty * entry : null;
  const riskAmount = qty != null && entry != null && stop != null ? qty * Math.abs(entry - stop) : null;
  const pct = total != null && available ? Math.max(0, Math.min(100, Math.round((total / available) * 100))) : 0;
  const amountDp = inst.decimals >= 3 ? 2 : 5;

  const draft = useMemo<TicketDraft>(
    () => ({
      side,
      entry,
      stop,
      target,
      accountSize: available,
      riskAmount,
      orderType: type === "market" ? "market" : type,
      size: qty,
      sizeUnit: baseAsset,
    }),
    [side, entry, stop, target, available, riskAmount, type, qty, baseAsset]
  );
  useEffect(() => onDraft(draft), [draft, onDraft]);

  const fromSlider = (p: number) => {
    if (!available || !entry) return;
    setAmount(((available * p) / 100 / entry).toFixed(amountDp));
  };
  const submit = () => {
    store(ACCOUNT_KEY, avbl);
    onSubmit(side, draft);
  };
  const types: Array<[BnType, string]> = [
    ["limit", "Limit"],
    ["market", "Market"],
    ["stop_limit", "Stop Limit"],
  ];
  const row = "flex justify-between text-xs";

  return (
    <section
      className="overflow-hidden rounded-2xl border"
      style={{ background: BX.bg, color: BX.ink, borderColor: BX.field }}
      aria-label="Trade ticket"
    >
      <div className="flex items-center gap-[18px] border-b px-4 pt-3 text-sm" style={{ borderColor: BX.field }}>
        <span className="pb-2.5 font-semibold" style={{ boxShadow: `inset 0 -2px 0 ${BX.yellow}` }}>Spot</span>
        <span className="ml-auto flex items-center gap-2 pb-2.5 text-xs" style={{ color: BX.muted }}>
          {platform}
          <span className="rounded-full border border-dashed px-2 py-0.5 text-[11px]" style={{ borderColor: BX.line }}>
            Connect account: coming next
          </span>
        </span>
      </div>

      <div className="grid gap-3 px-4 pt-3.5 pb-1">
        <div className="grid grid-cols-2 rounded-lg p-0.5" style={{ background: BX.field }} role="group" aria-label="Side">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => setSide(s)}
              className="h-[34px] rounded-md text-sm font-semibold transition-colors"
              style={side === s ? { background: s === "buy" ? BX.green : BX.red, color: "#fff" } : { color: BX.muted }}
            >
              {s === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        <div className="flex gap-[18px] text-sm" role="tablist" aria-label="Order type">
          {types.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={type === k}
              onClick={() => setType(k)}
              className={`py-0.5 ${type === k ? "font-semibold" : ""}`}
              style={{ color: type === k ? BX.ink : BX.muted }}
            >
              {label}
            </button>
          ))}
        </div>

        {type === "stop_limit" && <BxField label="Stop" unit={quoteAsset} value={trigger} onChange={setTrigger} />}
        {type === "market" ? (
          <BxField label="Price" unit={quoteAsset} value="Market Price" disabled />
        ) : (
          <BxField label={type === "stop_limit" ? "Limit" : "Price"} unit={quoteAsset} value={price} onChange={setPrice} />
        )}
        <BxField label="Amount" unit={baseAsset} value={amount} onChange={setAmount} />
        <BxSlider pct={pct} onChange={fromSlider} label={`Share of available ${quoteAsset}`} />
        <BxField label="Total" unit={quoteAsset} value={total != null ? fmt(total, 2) : ""} disabled />

        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={tpsl}
            onChange={(e) => setTpsl(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-[#fcd535]"
          />
          TP/SL
        </label>
        {tpsl && (
          <>
            <BxField label="Take Profit" unit={quoteAsset} value={tp} onChange={setTp} />
            <BxField label={risk.stopRequired ? "Stop Loss (required)" : "Stop Loss"} unit={quoteAsset} value={sl} onChange={setSl} />
          </>
        )}

        <label className={`${row} items-center`} style={{ color: BX.muted }}>
          <span>Avbl</span>
          <span className="flex items-center gap-1" style={{ color: BX.ink }}>
            <input
              className="w-24 bg-transparent text-right tabular-nums outline-none placeholder:text-[#848e9c]"
              inputMode="decimal"
              value={avbl}
              placeholder="0.00"
              onChange={(e) => setAvbl(e.target.value)}
              aria-label={`Available ${quoteAsset}`}
            />
            {quoteAsset}
          </span>
        </label>
        <div className={row} style={{ color: BX.muted }}>
          <span>{side === "buy" ? "Max Buy" : "Max Sell"}</span>
          <b className="font-medium tabular-nums" style={{ color: BX.ink }}>
            {available && entry ? `${(available / entry).toFixed(amountDp)} ${baseAsset}` : "–"}
          </b>
        </div>
        <div className={row} style={{ color: BX.muted }}>
          <span>Est. Fee</span>
          <b className="font-medium tabular-nums" style={{ color: BX.ink }}>{total != null ? `${fmt(total * TAKER_FEE, 2)} ${quoteAsset}` : "–"}</b>
        </div>
      </div>

      <div className="mt-2">
        <EdgeLine riskAmount={riskAmount} accountSize={available} rr={rrOf(entry, stop, target)} risk={risk} ccy={quoteAsset} />
      </div>
      <div className="px-4 pt-3 pb-3">
        <button
          type="button"
          disabled={disabled}
          onClick={submit}
          className="h-[42px] w-full rounded-lg text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          style={{ background: side === "buy" ? BX.green : BX.red }}
        >
          {side === "buy" ? "Buy" : "Sell"} {baseAsset}
        </button>
      </div>
      <p className="px-4 pb-4 text-xs" style={{ color: BX.muted }}>Edge checks your trade against your checklist before it goes anywhere.</p>
    </section>
  );
}

/* --------------------------------------------------- Edge's own ticket --- */

export function EdgeTicket({ inst, risk, lastPrice, disabled, onDraft, onSubmit }: TicketProps) {
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [account, setAccount] = useState(() => readStored(ACCOUNT_KEY));
  const [riskAmt, setRiskAmt] = useState("");

  const e = num(entry) ?? lastPrice;
  const st = num(stop);
  const tg = num(target);
  const acc = num(account);
  const ra = num(riskAmt);
  const draft = useMemo<TicketDraft>(
    () => ({
      side: inferSide(e, st),
      entry: e,
      stop: st,
      target: tg,
      accountSize: acc,
      riskAmount: ra,
      orderType: num(entry) == null ? "market" : "limit",
      size: null,
      sizeUnit: null,
    }),
    [e, st, tg, acc, ra, entry]
  );
  useEffect(() => onDraft(draft), [draft, onDraft]);

  const submit = (side: "buy" | "sell") => {
    store(ACCOUNT_KEY, account);
    onSubmit(side, { ...draft, side });
  };
  const f = "input py-2 text-sm tabular-nums";

  return (
    <section className="card p-0" aria-label="Trade ticket">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Ticket</h2>
        <span className="text-xs text-ink/60">{inst.label}</span>
      </header>
      <div className="grid grid-cols-2 gap-3 px-4 py-4">
        <label className="text-xs text-ink/70">
          Entry
          <input className={f} inputMode="decimal" placeholder={lastPrice != null ? lastPrice.toFixed(inst.decimals) : "price"} value={entry} onChange={(x) => setEntry(x.target.value)} />
        </label>
        <label className="text-xs text-ink/70">
          Stop{risk.stopRequired && <span className="text-maybe"> (required)</span>}
          <input className={f} inputMode="decimal" value={stop} onChange={(x) => setStop(x.target.value)} />
        </label>
        <label className="text-xs text-ink/70">
          Target
          <input className={f} inputMode="decimal" value={target} onChange={(x) => setTarget(x.target.value)} />
        </label>
        <label className="text-xs text-ink/70">
          Account size
          <input className={f} inputMode="decimal" value={account} onChange={(x) => setAccount(x.target.value)} />
        </label>
        <label className="col-span-2 text-xs text-ink/70">
          Amount you&apos;re risking on this trade
          <input className={f} inputMode="decimal" value={riskAmt} onChange={(x) => setRiskAmt(x.target.value)} />
        </label>
      </div>
      <EdgeLine riskAmount={ra} accountSize={acc} rr={rrOf(e, st, tg)} risk={risk} ccy="" />
      <div className="grid grid-cols-2 gap-2 px-4 pt-3.5 pb-3">
        <button type="button" className="h-11 rounded-full bg-[#26a69a] font-semibold text-[#04110a] transition-transform hover:-translate-y-0.5 disabled:opacity-50" disabled={disabled} onClick={() => submit("buy")}>
          Buy
        </button>
        <button type="button" className="h-11 rounded-full bg-[#ef5350] font-semibold text-[#1a0507] transition-transform hover:-translate-y-0.5 disabled:opacity-50" disabled={disabled} onClick={() => submit("sell")}>
          Sell
        </button>
      </div>
      {fine}
    </section>
  );
}

/** Which ticket a platform gets. */
export function ticketStyle(platform: string): "mt" | "spot" | "edge" {
  // MT5-style New Order window: MetaTrader and the forex platforms that work in lots
  if (/^MetaTrader/.test(platform) || ["cTrader", "TradeLocker", "Match-Trader"].includes(platform)) return "mt";
  if (platform === "Binance" || platform === "Bybit" || platform === "OKX") return "spot";
  return "edge";
}
