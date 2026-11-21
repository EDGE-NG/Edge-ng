/** Shapes the workspace page shares between its parts (mirrors the server's sessionView / decision JSON). */

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
export const TF_LABEL: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1D" };
export type Status = "pass" | "fail" | "inconclusive" | "unchecked";
export type Mode = "chart" | "code" | "session" | "trader";

export interface Instrument {
  symbol: string;
  label: string;
  assetClass: "crypto" | "forex" | "metals" | "indices";
  decimals: number;
  ready: boolean;
}

export interface Check {
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

export interface RuleView {
  itemKey: string;
  text: string;
  category: string;
  hardGate: boolean;
  mode: Mode;
  requiredTimeframe: string | null;
  timeframe: Timeframe | null;
  confirmedExamples: number;
  status: Status;
  stale: boolean;
  check: Check | null;
}

export interface Risk {
  maxRiskPct: { value: number; itemKey: string } | null;
  minRR: { value: number; itemKey: string } | null;
  maxTradesPerDay: { value: number; itemKey: string } | null;
  stopRequired: boolean;
}

export interface View {
  session: { id: string; edgeId: string; edgeName: string; versionNumber: number | null; instrument: string; platform: string | null };
  risk: Risk;
  indicators: Array<{ kind: "ema" | "sma" | "rsi"; period: number }>;
  rules: RuleView[];
}

export interface OverrideAllowance {
  limit: number;
  used: number;
  left: number;
  /** next market-week start: Sunday 18:00 New York */
  resetsAt: string;
}

export interface Decision {
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
  /** Each rule's result in this decision, in checklist order. */
  rules?: Array<{ itemKey: string; status: string; reason: string }>;
  ticket: { instrument: string; side: string; entry: number; stop: number | null; target: number | null; riskPct: number | null; riskReward: number | null };
  /** weekly override allowance (lib/overrides.ts); null for an approved trade */
  overrides?: OverrideAllowance | null;
}

/**
 * A trade as the ticket has it. `side` is null until the trader picks one
 * (MT5-style tickets pick it with the button); the page infers it from the
 * stop for the warm-up.
 */
export interface TicketDraft {
  side: "buy" | "sell" | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  accountSize: number | null;
  riskAmount: number | null;
  orderType: "market" | "pending" | "limit" | "stop_limit";
  size: number | null;
  sizeUnit: string | null;
}

export function timeframeOf(label: string | null | undefined): Timeframe | null {
  if (!label) return null;
  const k = label.toLowerCase().replace(/\s/g, "");
  if ((TIMEFRAMES as string[]).includes(k)) return k as Timeframe;
  if (k === "daily" || k === "d" || k === "1day") return "1d";
  return null;
}
