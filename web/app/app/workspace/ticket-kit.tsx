"use client";

/**
 * Shared parts of the platform-style trade tickets: number parsing, contract
 * and pip sizes, risk in USD (PR-GT-3), and Edge's own risk line.
 */
import type { Instrument, Risk, TicketDraft } from "./types";

export const ACCOUNT_KEY = "edge-account-size";
/** Starting balance used for risk % (decision, Daniel, 2026-11-26), one per ticket kind. */
export const START_LOTS_KEY = "edge-start-balance-lots";
export const START_SPOT_KEY = "edge-start-balance-spot";
export const AVAILABLE_SPOT_KEY = "edge-available-spot";

export function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
export function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* not remembered */
  }
}

export const num = (s: string): number | null => {
  if (s.trim() === "") return null;
  const v = Number(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
};
export const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Units per lot on an MT5-style account. */
export function contractSize(inst: Instrument): number {
  if (inst.assetClass === "forex") return 100_000;
  if (inst.symbol.startsWith("XAU")) return 100;
  if (inst.symbol.startsWith("XAG")) return 5_000;
  return 1;
}

/** USD per one unit of the quote currency, or null when Edge can't tell (e.g. GBP/JPY). */
export function usdPerQuote(inst: Instrument, price: number | null): number | null {
  if (inst.assetClass === "crypto" || inst.assetClass === "indices") return 1; // USDT / USD
  const [b, q] = inst.symbol.split("/");
  if (q === "USD") return 1;
  if (b === "USD" && price) return 1 / price;
  return null;
}


/** Edge's own reading of the ticket against the plan's limits. */
export function EdgeLine({ riskAmount, accountSize, rr, risk, ccy }: { riskAmount: number | null; accountSize: number | null; rr: number | null; risk: Risk; ccy: string }) {
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

export const rrOf = (entry: number | null, stop: number | null, target: number | null) =>
  entry != null && stop != null && target != null && Math.abs(entry - stop) > 0 ? Math.abs(target - entry) / Math.abs(entry - stop) : null;



export interface TicketProps {
  inst: Instrument;
  risk: Risk;
  lastPrice: number | null;
  disabled: boolean;
  onDraft: (d: TicketDraft) => void;
  onSubmit: (side: "buy" | "sell", d: TicketDraft) => void;
}

/** One pip (or point) in price terms, for tickets that take SL / TP in pips. */
export function pipSize(inst: Instrument): number {
  if (inst.assetClass === "forex") return inst.symbol.endsWith("JPY") ? 0.01 : 0.0001;
  if (inst.symbol.startsWith("XAU")) return 0.1;
  if (inst.symbol.startsWith("XAG")) return 0.01;
  return 1;
}

/** Map a platform's order type onto the types Edge's gate records. */
export function gateOrderType(t: "market" | "limit" | "stop" | "stop_limit"): TicketDraft["orderType"] {
  return t === "stop" ? "pending" : t;
}
