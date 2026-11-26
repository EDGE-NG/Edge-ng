"use client";

/**
 * Edge's own trade tickets (decision, Daniel, 2026-11-26, after a legal
 * check: no platform's ticket look or arrangement is copied).
 *
 *  - SpotTicket: crypto exchanges (Binance, Bybit, OKX). Drawn from what spot
 *    traders need (buy or sell, limit / market / stop limit, price, amount,
 *    total, TP/SL, available balance), in Edge's own design.
 *  - LotTicket: everything else (MetaTrader, cTrader, TradeLocker,
 *    Match-Trader, TradingView, Other). A simplified ticket in lots: side,
 *    market or pending, volume, stop loss and take profit in price with the
 *    distance in pips, balance.
 *
 * Both follow Edge's theme (light and dark) and end in Edge's pre-trade check
 * (PR-GT-1). Risk is worked out in code from the ticket (PR-GT-3), as a share
 * of the trader's starting balance (decision, Daniel, 2026-11-26). Until
 * accounts can be connected, placing a trade is simulated and labelled Demo.
 */
import { useEffect, useMemo, useState } from "react";
import type { Instrument, TicketDraft } from "./types";
import {
  ACCOUNT_KEY,
  AVAILABLE_SPOT_KEY,
  START_LOTS_KEY,
  START_SPOT_KEY,
  EdgeLine,
  contractSize,
  fmt,
  gateOrderType,
  num,
  pipSize,
  readStored,
  rrOf,
  store,
  usdPerQuote,
  type TicketProps,
} from "./ticket-kit";

/** Which ticket a platform gets. */
export function ticketStyle(platform: string): "spot" | "lots" {
  return platform === "Binance" || platform === "Bybit" || platform === "OKX" ? "spot" : "lots";
}

/** The ticket for the platform the trader picked. */
export function PlatformTicket(props: TicketProps & { platform: string }) {
  return ticketStyle(props.platform) === "spot" ? <SpotTicket {...props} /> : <LotTicket {...props} />;
}

/* ------------------------------------------------------------ shared UI --- */

const BUY = "bg-accent text-[var(--color-btn-main-fg)]";
const SELL = "bg-fail text-white";
const label = "text-xs text-ink/70";
const box = "input h-10 w-full py-0 text-sm tabular-nums";

function Header({ title, platform, inst }: { title: string; platform: string; inst: Instrument }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="truncate text-xs text-muted">{inst.label}</p>
      </div>
      <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted">
        {platform}
        <span className="whitespace-nowrap rounded-full border border-dashed border-line px-2 py-0.5 text-[11px]" title="Edge simulates placing the order until accounts can be connected">
          Demo account
        </span>
      </span>
    </header>
  );
}

/** Edge's segmented control: a soft pill track, the chosen option lifted. */
function Choice<T extends string>({ value, options, onChange, ariaLabel, full }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; ariaLabel: string; full?: boolean }) {
  return (
    <div role="group" aria-label={ariaLabel} className={`${full ? "grid" : "inline-grid"} rounded-full border border-line bg-panel p-1`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${value === v ? "bg-surface text-ink shadow-[0_1px_0_var(--color-line)]" : "text-muted hover:text-ink"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Buy and sell side by side; the chosen side is filled, the other outlined. Text always says which. */
function SideSwitch({ side, onChange, buyText, sellText }: { side: "buy" | "sell"; onChange: (s: "buy" | "sell") => void; buyText: React.ReactNode; sellText: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Direction">
      {(["buy", "sell"] as const).map((s) => {
        const on = side === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(s)}
            className={`min-w-0 rounded-xl border px-3 py-2 text-left transition-colors ${
              on ? `${s === "buy" ? BUY : SELL} border-transparent` : `border-line bg-panel ${s === "buy" ? "text-accent" : "text-fail"}`
            }`}
          >
            {s === "buy" ? buyText : sellText}
          </button>
        );
      })}
    </div>
  );
}

function Field({ id, text, hint, children }: { id: string; text: React.ReactNode; hint?: string | null; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {children}
      {hint && <span className="text-[11px] tabular-nums text-muted">{hint}</span>}
    </div>
  );
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-muted">{name}</span>
      <b className="font-medium tabular-nums">{value}</b>
    </div>
  );
}

const fine = <p className="px-4 pb-4 text-xs text-ink/55">Edge checks your trade against your checklist before it goes anywhere.</p>;
const priceOf = (p: number | null, inst: Instrument) => (p != null ? p.toFixed(inst.decimals) : "–");

/* ------------------------------------------------------------ lot ticket --- */

/**
 * Simplified ticket in lots, with MT5 and Match-Trader as reference points:
 * side with the live price, market or pending, volume, SL / TP in price with
 * the distance in pips, balance, and pip value.
 */
export function LotTicket({ inst, risk, lastPrice, disabled, onDraft, onSubmit, platform }: TicketProps & { platform: string }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [pending, setPending] = useState(false);
  const [price, setPrice] = useState("");
  const [lots, setLots] = useState("0.10");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [balance, setBalanceState] = useState(() => readStored(START_LOTS_KEY) || readStored(ACCOUNT_KEY));
  const setBalance = (v: string) => {
    setBalanceState(v);
    store(START_LOTS_KEY, v);
  };
  const [manualRisk, setManualRisk] = useState("");

  const pip = pipSize(inst);
  const pendingPrice = num(price);
  const entry = pending ? pendingPrice : lastPrice;
  // A pending order below the market is a buy limit / sell stop; above it, a buy stop / sell limit.
  const pendingKind: "limit" | "stop" =
    pendingPrice == null || lastPrice == null ? "limit" : (side === "buy") === pendingPrice < lastPrice ? "limit" : "stop";
  const orderType = pending ? pendingKind : "market";

  const stop = num(sl);
  const target = num(tp);
  const volume = num(lots);
  const conv = usdPerQuote(inst, entry);
  const units = volume != null ? volume * contractSize(inst) : null;
  const riskAmount = conv == null ? num(manualRisk) : units != null && entry != null && stop != null ? units * Math.abs(entry - stop) * conv : null;
  const accountSize = num(balance);
  const pipValue = units != null && conv != null ? units * pip * conv : null;
  const pips = (lvl: number | null) => (lvl != null && entry != null ? `${(Math.abs(lvl - entry) / pip).toFixed(1)} pips from entry` : null);
  // A stop on the wrong side of entry would turn the risk sum into nonsense; say so plainly.
  const wrongStop = stop != null && entry != null && (side === "buy" ? stop >= entry : stop <= entry);

  const draft = useMemo<TicketDraft>(
    () => ({ side, entry, stop, target, accountSize, riskAmount, orderType: gateOrderType(orderType), size: volume, sizeUnit: "lots" }),
    [side, entry, stop, target, accountSize, riskAmount, orderType, volume]
  );
  useEffect(() => onDraft(draft), [draft, onDraft]);

  const step = (d: number) => setLots((v) => Math.max(0.01, Math.round(((num(v) ?? 0) + d) * 100) / 100).toFixed(2));
  const code = inst.symbol.replace("/", "");
  const kindWord = pending ? (pendingKind === "limit" ? " limit" : " stop") : "";

  return (
    <section className="card min-w-0 p-0" aria-label="Trade ticket">
      <Header title="Order" platform={platform} inst={inst} />
      <div className="grid gap-3.5 px-4 py-4">
        <SideSwitch
          side={side}
          onChange={setSide}
          buyText={
            <>
              <span className="block text-[11px] font-semibold">Buy{kindWord}</span>
              <span className="block truncate text-lg font-semibold tabular-nums">{priceOf(lastPrice, inst)}</span>
            </>
          }
          sellText={
            <>
              <span className="block text-[11px] font-semibold">Sell{kindWord}</span>
              <span className="block truncate text-lg font-semibold tabular-nums">{priceOf(lastPrice, inst)}</span>
            </>
          }
        />

        <Choice full ariaLabel="When to enter" value={pending ? "pending" : "market"} onChange={(v) => setPending(v === "pending")} options={[["market", "At market"], ["pending", "At a price"]]} />

        {pending && (
          <Field id="lt-price" text={`Entry price · ${side === "buy" ? "Buy" : "Sell"}${kindWord}`}>
            <input id="lt-price" className={box} inputMode="decimal" value={price} placeholder={priceOf(lastPrice, inst)} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        )}

        <Field id="lt-lots" text="Volume (lots)" hint={units != null ? `${fmt(units, 0)} ${inst.assetClass === "forex" ? inst.symbol.split("/")[0] : "units"}` : null}>
          <div className="grid grid-cols-[40px_minmax(0,1fr)_40px] gap-1.5">
            <button type="button" className="h-10 rounded-xl border border-line bg-panel text-base" aria-label="Less volume" onClick={() => step(-0.01)}>
              −
            </button>
            <input id="lt-lots" className={`${box} text-center`} inputMode="decimal" value={lots} onChange={(e) => setLots(e.target.value)} />
            <button type="button" className="h-10 rounded-xl border border-line bg-panel text-base" aria-label="More volume" onClick={() => step(0.01)}>
              +
            </button>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field id="lt-sl" text={<>Stop loss{risk.stopRequired && <span className="text-maybe"> (required)</span>}</>} hint={pips(stop)}>
            <input id="lt-sl" className={box} inputMode="decimal" value={sl} placeholder="Price" onChange={(e) => setSl(e.target.value)} aria-invalid={wrongStop} />
          </Field>
          <Field id="lt-tp" text="Take profit" hint={pips(target)}>
            <input id="lt-tp" className={box} inputMode="decimal" value={tp} placeholder="Price" onChange={(e) => setTp(e.target.value)} />
          </Field>
        </div>
        {wrongStop && (
          <p className="-mt-1 text-xs text-fail" role="alert">
            For a {side}, the stop loss goes {side === "buy" ? "below" : "above"} the entry price.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <Field id="lt-bal" text="Starting balance (USD)">
            <input id="lt-bal" className={box} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
          </Field>
          {conv == null && (
            <Field id="lt-risk" text="Amount at risk (USD)">
              <input id="lt-risk" className={box} inputMode="decimal" value={manualRisk} onChange={(e) => setManualRisk(e.target.value)} />
            </Field>
          )}
        </div>
        <Row name="Pip value" value={pipValue != null ? `$${fmt(pipValue, 2)}` : "–"} />
      </div>

      <EdgeLine riskAmount={riskAmount} accountSize={accountSize} rr={rrOf(entry, stop, target)} risk={risk} ccy="USD" />
      <div className="px-4 pt-3.5 pb-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(side, draft)}
          className={`h-11 w-full rounded-full font-semibold transition hover:brightness-110 disabled:opacity-50 ${side === "buy" ? BUY : SELL}`}
        >
          {side === "buy" ? "Buy" : "Sell"}
          {kindWord} {lots} {code}
        </button>
      </div>
      {fine}
    </section>
  );
}

/* ----------------------------------------------------------- spot ticket --- */

type SpotType = "limit" | "market" | "stop_limit";

/**
 * Spot ticket for crypto exchanges, with Binance and Bybit as reference
 * points: buy or sell, limit / market / stop limit, price, amount with quick
 * shares of the balance, total, TP/SL, available balance.
 */
export function SpotTicket({ inst, risk, lastPrice, disabled, onDraft, onSubmit, platform }: TicketProps & { platform: string }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<SpotType>("limit");
  const [price, setPrice] = useState("");
  const [trigger, setTrigger] = useState("");
  const [amount, setAmount] = useState("");
  const [avbl, setAvblState] = useState(() => readStored(AVAILABLE_SPOT_KEY));
  const setAvbl = (v: string) => {
    setAvblState(v);
    store(AVAILABLE_SPOT_KEY, v);
  };
  const [start, setStartState] = useState(() => readStored(START_SPOT_KEY));
  const setStart = (v: string) => {
    setStartState(v);
    store(START_SPOT_KEY, v);
  };
  const [tpsl, setTpsl] = useState(true);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");

  const slash = inst.label.indexOf("/");
  const base = slash > 0 ? inst.label.slice(0, slash) : inst.symbol;
  const quote = slash > 0 ? inst.label.slice(slash + 1) : "USDT";
  const entry = type === "market" ? lastPrice : num(price) ?? lastPrice;
  const qty = num(amount);
  const available = num(avbl);
  const startBalance = num(start);
  const stop = tpsl ? num(sl) : null;
  const target = tpsl ? num(tp) : null;
  const total = qty != null && entry != null ? qty * entry : null;
  const riskAmount = qty != null && entry != null && stop != null ? qty * Math.abs(entry - stop) : null;
  const amountDp = inst.decimals >= 3 ? 2 : 5;
  const share = total != null && available ? Math.round((total / available) * 100) : null;

  const draft = useMemo<TicketDraft>(
    () => ({ side, entry, stop, target, accountSize: startBalance, riskAmount, orderType: gateOrderType(type), size: qty, sizeUnit: base }),
    [side, entry, stop, target, startBalance, riskAmount, type, qty, base]
  );
  useEffect(() => onDraft(draft), [draft, onDraft]);

  const applyShare = (p: number) => {
    if (!available || !entry) return;
    setAmount(((available * p) / 100 / entry).toFixed(amountDp));
  };
  const unit = (u: string) => <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs text-muted">{u}</span>;

  return (
    <section className="card min-w-0 p-0" aria-label="Trade ticket">
      <Header title="Spot order" platform={platform} inst={inst} />
      <div className="grid gap-3.5 px-4 py-4">
        <SideSwitch
          side={side}
          onChange={setSide}
          buyText={<span className="block text-center text-sm font-semibold">Buy {base}</span>}
          sellText={<span className="block text-center text-sm font-semibold">Sell {base}</span>}
        />

        <Choice full ariaLabel="Order type" value={type} onChange={setType} options={[["limit", "Limit"], ["market", "Market"], ["stop_limit", "Stop limit"]]} />

        {type === "stop_limit" && (
          <Field id="sp-trigger" text={`Trigger price (${quote})`}>
            <div className="relative">
              <input id="sp-trigger" className={`${box} pr-16`} inputMode="decimal" value={trigger} onChange={(e) => setTrigger(e.target.value)} />
              {unit(quote)}
            </div>
          </Field>
        )}
        <Field id="sp-price" text={type === "stop_limit" ? `Limit price (${quote})` : `Price (${quote})`}>
          <div className="relative">
            <input
              id="sp-price"
              className={`${box} pr-16`}
              inputMode="decimal"
              value={type === "market" ? "" : price}
              placeholder={type === "market" ? "Best market price" : priceOf(lastPrice, inst)}
              disabled={type === "market"}
              onChange={(e) => setPrice(e.target.value)}
            />
            {unit(quote)}
          </div>
        </Field>
        <Field id="sp-amount" text={`Amount (${base})`}>
          <div className="relative">
            <input id="sp-amount" className={`${box} pr-16`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {unit(base)}
          </div>
        </Field>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`Use a share of your available ${quote}`}>
          {[25, 50, 75, 100].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyShare(p)}
              disabled={!available || !entry}
              aria-pressed={share === p}
              className={`rounded-full border py-1 text-xs tabular-nums transition-colors disabled:opacity-45 ${share === p ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}
            >
              {p}%
            </button>
          ))}
        </div>
        <Row name={`Total (${quote})`} value={total != null ? fmt(total, 2) : "–"} />

        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
          <input type="checkbox" checked={tpsl} onChange={(e) => setTpsl(e.target.checked)} className="h-4 w-4 cursor-pointer accent-[var(--color-accent)]" />
          Take profit and stop loss
        </label>
        {tpsl && (
          <div className="grid grid-cols-2 gap-2.5">
            <Field id="sp-tp" text="Take profit">
              <input id="sp-tp" className={box} inputMode="decimal" value={tp} placeholder={quote} onChange={(e) => setTp(e.target.value)} />
            </Field>
            <Field id="sp-sl" text={<>Stop loss{risk.stopRequired && <span className="text-maybe"> (required)</span>}</>}>
              <input id="sp-sl" className={box} inputMode="decimal" value={sl} placeholder={quote} onChange={(e) => setSl(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <Field id="sp-start" text={`Starting balance (${quote})`}>
            <input id="sp-start" className={box} inputMode="decimal" value={start} placeholder="0.00" onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field id="sp-avbl" text={`Available (${quote})`}>
            <input id="sp-avbl" className={box} inputMode="decimal" value={avbl} placeholder="0.00" onChange={(e) => setAvbl(e.target.value)} />
          </Field>
        </div>
        <Row name={side === "buy" ? "Most you can buy" : "Most you can sell"} value={available && entry ? `${(available / entry).toFixed(amountDp)} ${base}` : "–"} />
      </div>

      <EdgeLine riskAmount={riskAmount} accountSize={startBalance} rr={rrOf(entry, stop, target)} risk={risk} ccy={quote} />
      <div className="px-4 pt-3.5 pb-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(side, draft)}
          className={`h-11 w-full rounded-full font-semibold transition hover:brightness-110 disabled:opacity-50 ${side === "buy" ? BUY : SELL}`}
        >
          {side === "buy" ? "Buy" : "Sell"} {base}
        </button>
      </div>
      {fine}
    </section>
  );
}
