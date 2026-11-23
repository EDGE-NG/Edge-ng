import { describe, expect, it, vi } from "vitest";

// workspace.ts also holds the AI chart check and database helpers; the tests
// below only use its pure decision code, so those modules are stubbed out.
vi.mock("./ai", () => ({ chatJson: vi.fn() }));
vi.mock("./db", () => ({
  db: {},
  json: (v: unknown, d: unknown) => v ?? d,
  now: () => new Date().toISOString(),
  uuid: () => "00000000-0000-0000-0000-000000000000",
}));
vi.mock("./evidence", () => ({ activeImages: vi.fn(), readFile: vi.fn() }));
vi.mock("./model-images", () => ({ cachedForModel: vi.fn(), toDataUrl: vi.fn() }));

import type { Rule } from "./edge-builder";
import {
  evaluateRiskRule,
  groundCheck,
  normalizeTimeframe,
  parseRiskParams,
  reasonFor,
  rollUp,
  ruleMode,
  ticketKey,
  ticketMath,
  type Check,
  type RuleState,
  type Ticket,
} from "./workspace";

const rule = (item_key: string, text: string, extra: Partial<Rule> = {}): Rule => ({
  item_key,
  text,
  category: "context",
  hard_gate: true,
  assessability: "chart",
  required_timeframe: null,
  source_span: null,
  ...extra,
});

const state = (status: RuleState["status"], hard = true, extra: Partial<RuleState> = {}): RuleState => ({
  rule: rule("r", "rule", { hard_gate: hard }),
  mode: "chart",
  check: null,
  status,
  stale: false,
  ...extra,
});

const ticket = (t: Partial<Ticket> = {}): Ticket => ({
  side: "buy",
  entry: 100,
  stop: 95,
  target: 110,
  accountSize: 10_000,
  riskAmount: 100,
  ...t,
});

describe("rollUp: code decides (PR-GT-7, REQ-GT-1)", () => {
  it("approves only when every hard gate passes", () => {
    expect(rollUp([state("pass"), state("pass")]).result).toBe("approved");
  });

  it("any hard-gate Fail means Denied", () => {
    expect(rollUp([state("pass"), state("fail")]).result).toBe("denied");
  });

  it("Fail wins over Inconclusive", () => {
    expect(rollUp([state("inconclusive"), state("fail")]).result).toBe("denied");
  });

  it("a hard gate Inconclusive or unchecked means Needs evidence, never Approved", () => {
    expect(rollUp([state("pass"), state("inconclusive")]).result).toBe("needs_evidence");
    expect(rollUp([state("pass"), state("unchecked")]).result).toBe("needs_evidence");
  });

  it("soft rules never offset or block a hard gate", () => {
    expect(rollUp([state("pass"), state("fail", false)]).result).toBe("approved");
    expect(rollUp([state("fail"), state("pass", false)]).result).toBe("denied");
    expect(rollUp([state("pass"), state("fail", false)]).softFails).toHaveLength(1);
  });

  it("with no hard-gate rules there is nothing to fail", () => {
    expect(rollUp([]).result).toBe("approved");
  });
});

describe("parseRiskParams: numbers only from the trader's own words", () => {
  it("reads max risk %, minimum R:R and max trades per day", () => {
    const p = parseRiskParams([
      rule("risk", "Never risk more than 1% per trade"),
      rule("rr", "Minimum risk to reward of 1:2"),
      rule("trades", "Maximum 3 trades per day"),
      rule("stop", "Always use a stop loss"),
    ]);
    expect(p.maxRiskPct).toEqual({ value: 1, itemKey: "risk" });
    expect(p.minRR).toEqual({ value: 2, itemKey: "rr" });
    expect(p.maxTradesPerDay).toEqual({ value: 3, itemKey: "trades" });
    expect(p.stopRequired).toBe(true);
  });

  it("ignores implausible numbers instead of inventing a limit", () => {
    expect(parseRiskParams([rule("risk", "Risk 50% of the account")]).maxRiskPct).toBeNull();
    expect(parseRiskParams([rule("x", "Buy the dip")]).maxRiskPct).toBeNull();
  });

  it("reads '2R' as a minimum R:R of 2", () => {
    expect(parseRiskParams([rule("rr", "Only take trades with at least 2R reward")]).minRR?.value).toBe(2);
  });
});

describe("evaluateRiskRule", () => {
  const risk = parseRiskParams([
    rule("risk", "Never risk more than 1% per trade"),
    rule("rr", "Minimum risk to reward of 1:2"),
    rule("trades", "Maximum 3 trades per day"),
  ]);
  const r = (k: string) => rule(k, "", { assessability: "manual" });

  it("no ticket: Inconclusive, never a pass", () => {
    expect(evaluateRiskRule(r("risk"), risk, null, 0).result).toBe("inconclusive");
  });

  it("max risk %", () => {
    expect(evaluateRiskRule(r("risk"), risk, ticket({ riskAmount: 100 }), 0).result).toBe("pass"); // 1%
    expect(evaluateRiskRule(r("risk"), risk, ticket({ riskAmount: 150 }), 0).result).toBe("fail"); // 1.5%
    expect(evaluateRiskRule(r("risk"), risk, ticket({ riskAmount: null }), 0).result).toBe("inconclusive");
  });

  it("minimum R:R", () => {
    expect(evaluateRiskRule(r("rr"), risk, ticket({ stop: 95, target: 110 }), 0).result).toBe("pass"); // 1:2
    expect(evaluateRiskRule(r("rr"), risk, ticket({ stop: 95, target: 105 }), 0).result).toBe("fail"); // 1:1
    expect(evaluateRiskRule(r("rr"), risk, ticket({ target: null }), 0).result).toBe("inconclusive");
  });

  it("max trades per day", () => {
    expect(evaluateRiskRule(r("trades"), risk, ticket(), 2).result).toBe("pass");
    expect(evaluateRiskRule(r("trades"), risk, ticket(), 3).result).toBe("fail");
  });
});

describe("ticketMath", () => {
  it("works out R:R and risk %", () => {
    const m = ticketMath(ticket());
    expect(m.rr).toBe(2);
    expect(m.riskPct).toBe(1);
  });

  it("flags a stop or target on the wrong side", () => {
    expect(ticketMath(ticket({ side: "buy", stop: 105 })).stopWrongSide).toBe(true);
    expect(ticketMath(ticket({ side: "sell", stop: 105, target: 90 })).stopWrongSide).toBe(false);
    expect(ticketMath(ticket({ side: "buy", target: 90 })).targetWrongSide).toBe(true);
  });
});

describe("ticketKey: a check is reused only for the same ticket", () => {
  it("changes when side, stop or target change", () => {
    const base = ticketKey(ticket());
    expect(ticketKey(ticket({ side: "sell" }))).not.toBe(base);
    expect(ticketKey(ticket({ stop: 94 }))).not.toBe(base);
    expect(ticketKey(ticket({ target: 111 }))).not.toBe(base);
  });

  it("ignores a market order's entry, but not a pending order's", () => {
    expect(ticketKey(ticket({ entry: 101 }))).toBe(ticketKey(ticket()));
    expect(ticketKey(ticket({ entry: 101 }), true)).not.toBe(ticketKey(ticket(), true));
  });

  it("no ticket is 'none'", () => expect(ticketKey(null)).toBe("none"));
});

describe("ruleMode", () => {
  const risk = parseRiskParams([rule("risk", "Never risk more than 1% per trade")]);
  it("risk limits are code, chart rules are chart, plain session rules use the clock, the rest the trader", () => {
    expect(ruleMode(rule("risk", "Never risk more than 1% per trade"), risk)).toBe("code");
    expect(ruleMode(rule("c", "4H trend is up"), risk)).toBe("chart");
    expect(ruleMode(rule("s", "Entry during the London session", { assessability: "manual" }), risk)).toBe("session");
    expect(ruleMode(rule("n", "Never trade during the Asian session", { assessability: "manual" }), risk)).toBe("trader");
    expect(ruleMode(rule("t", "No high-impact news in the next hour", { assessability: "manual" }), risk)).toBe("trader");
  });
});

describe("normalizeTimeframe", () => {
  it.each([
    ["4H", "4h"],
    ["4 hour", "4h"],
    ["15 min", "15m"],
    ["H1", "1h"],
    ["daily", "1d"],
    ["3h", null],
    [null, null],
  ])("%s -> %s", (input, out) => expect(normalizeTimeframe(input)).toBe(out));
});

describe("groundCheck: AI claims must match the candles (REQ-LLM-8)", () => {
  const candles = [
    { time: 1, open: 100, high: 102, low: 99, close: 101, volume: 0 },
    { time: 2, open: 101, high: 104, low: 100, close: 103, volume: 0 },
  ];
  it("accepts prices inside the cited candles", () => {
    expect(groundCheck({ candle_range: [1, 2], cited_prices: [101.5] }, candles, []).ok).toBe(true);
  });
  it("rejects invented prices and invalid candle numbers", () => {
    expect(groundCheck({ candle_range: [1, 2], cited_prices: [150] }, candles, []).ok).toBe(false);
    expect(groundCheck({ candle_range: [0, 5] }, candles, []).ok).toBe(false);
  });
  it("accepts an indicator value shown in the table", () => {
    expect(groundCheck({ candle_range: [1, 2], cited_prices: [150] }, candles, [150]).ok).toBe(true);
  });
});

describe("reasonFor", () => {
  const check = (c: Partial<Check>): Check => ({
    itemKey: "r",
    result: "fail",
    observed: "",
    reasoning: "",
    confidence: null,
    missing: null,
    source: "llm",
    timeframe: null,
    frameId: null,
    evidence: null,
    checkedAt: new Date().toISOString(),
    ...c,
  });
  it("explains stale and unchecked rules in plain words", () => {
    expect(reasonFor(state("unchecked", true, { stale: true }))).toMatch(/too old/);
    expect(reasonFor(state("unchecked", true, { mode: "trader" }))).toMatch(/Confirm this yourself/);
    expect(reasonFor(state("fail", true, { check: check({ reasoning: "Trend is down." }) }))).toBe("Trend is down.");
  });
});
