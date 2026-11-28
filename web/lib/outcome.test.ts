import { describe, expect, it } from "vitest";
import { confirmExit, formatPnl, minorDigits, outcomeR, pnlMinor, resultOf, riskCurrency, toTradeView, type TradeRow } from "./outcome";

const buy = { side: "buy" as const, entry_price: 100, stop_price: 90, target_price: 120 };

describe("money follows the currency (PRD 9.2)", () => {
  it("knows minor digits", () => {
    expect(minorDigits("USD")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("USDT")).toBeNull();
  });
  it("works out the risk currency per ticket", () => {
    expect(riskCurrency("lots", "GBP/JPY")).toBe("USD");
    expect(riskCurrency("spot", "BTC/USDT")).toBe("USD");
    expect(riskCurrency("spot", "ETH/BTC")).toBeNull();
  });
  it("turns R and the risk amount into minor units", () => {
    expect(pnlMinor(2, 50, "USD")).toBe(10000);
    expect(pnlMinor(-1, 50, "USD")).toBe(-5000);
    expect(pnlMinor(0.5, 1500, "JPY")).toBe(750);
    expect(pnlMinor(2, null, "USD")).toBeNull();
    expect(pnlMinor(2, 50, null)).toBeNull();
    expect(pnlMinor(null, 50, "USD")).toBeNull();
  });
  it("formats P&L with sign and currency", () => {
    expect(formatPnl(12050, "USD")).toBe("+120.50 USD");
    expect(formatPnl(-1500, "JPY")).toBe("−1,500 JPY");
  });
});

describe("result and R come from the exit price", () => {
  it("reads profit, loss and break even for buys and sells", () => {
    expect(resultOf("buy", 100, 110)).toBe("win");
    expect(resultOf("buy", 100, 95)).toBe("loss");
    expect(resultOf("sell", 100, 95)).toBe("win");
    expect(resultOf("sell", 100, 100)).toBe("break_even");
  });
  it("works out R", () => {
    expect(outcomeR("buy", 100, 90, 120)).toBe(2);
    expect(outcomeR("sell", 100, 110, 95)).toBe(0.5);
    expect(outcomeR("sell", 100, 110, 105)).toBe(-0.5);
    expect(outcomeR("buy", 100, null, 120)).toBeNull();
  });
});

describe("confirmExit", () => {
  it("after a hit, Profit ends at the take profit and Loss at the stop", () => {
    expect(confirmExit(buy, "hit", { result: "win" })).toMatchObject({ ok: true, exit: 120 });
    expect(confirmExit(buy, "hit", { result: "loss" })).toMatchObject({ ok: true, exit: 90 });
    expect(confirmExit(buy, "hit", { result: "break_even" })).toMatchObject({ ok: true, exit: 100 });
  });
  it("after a hit, the trader can give the price they really closed at", () => {
    expect(confirmExit(buy, "hit", { result: "win", exitPrice: "118.5" })).toMatchObject({ ok: true, exit: 118.5 });
  });
  it("closing by hand needs the exit price for a profit or loss", () => {
    expect(confirmExit(buy, "watching", { result: "win" }).ok).toBe(false);
    expect(confirmExit(buy, "watching", { result: "win", exitPrice: 105 })).toMatchObject({ ok: true, exit: 105 });
    expect(confirmExit(buy, "watching", { result: "break_even" })).toMatchObject({ ok: true, exit: 100 });
  });
  it("refuses an exit price on the wrong side for the result", () => {
    expect(confirmExit(buy, "watching", { result: "win", exitPrice: 95 }).ok).toBe(false);
    expect(confirmExit({ ...buy, side: "sell" }, "watching", { result: "loss", exitPrice: 95 }).ok).toBe(false);
  });
  it("refuses unknown results and bad prices, and caps the note", () => {
    expect(confirmExit(buy, "hit", { result: "won" }).ok).toBe(false);
    expect(confirmExit(buy, "hit", { result: "win", exitPrice: "abc" }).ok).toBe(false);
    const r = confirmExit(buy, "hit", { result: "win", note: "x".repeat(900) });
    expect(r.ok && r.note?.length).toBe(500);
  });
  it("a hit on a trade without a take profit still needs the price for a profit", () => {
    expect(confirmExit({ ...buy, target_price: null }, "hit", { result: "win" }).ok).toBe(false);
  });
});

describe("toTradeView reads the trade's state", () => {
  const row: TradeRow = {
    id: "t1",
    side: "buy",
    status: "open",
    entry_price: 100,
    stop_price: 90,
    target_price: 120,
    exit_price: null,
    outcome_r: null,
    pnl_minor: null,
    currency: null,
    notes: null,
    closed_at: null,
  };
  it("watching", () => expect(toTradeView(row)?.state).toBe("watching"));
  it("hit the take profit, waiting for the trader", () => {
    const v = toTradeView({ ...row, exit_price: 120, closed_at: "2026-11-27T10:00:00.000Z" });
    expect(v?.state).toBe("hit");
    expect(v?.hit).toEqual({ level: "take_profit", price: 120, at: "2026-11-27T10:00:00.000Z" });
    expect(v?.result).toBeNull();
  });
  it("closed", () => {
    const v = toTradeView({ ...row, status: "closed", exit_price: 90, outcome_r: -1, pnl_minor: -5000, currency: "USD" });
    expect(v).toMatchObject({ state: "closed", result: "loss", outcomeR: -1, pnlMinor: -5000 });
  });
  it("cancelled trades aren't shown", () => expect(toTradeView({ ...row, status: "cancelled" })).toBeNull());
});
