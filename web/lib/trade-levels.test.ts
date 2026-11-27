import { describe, expect, it } from "vitest";
import type { Candle } from "./market";
import { findLevelHit, watchTimeframe, type WatchedTrade } from "./trade-levels";

const T0 = 1_764_000_000 - (1_764_000_000 % 60); // a minute boundary
const c = (i: number, low: number, high: number, open = (low + high) / 2): Candle =>
  ({ time: T0 + i * 60, open, high, low, close: open, volume: 0 }) as Candle;

const buy: WatchedTrade = { side: "buy", entry: 100, stop: 90, target: 120, pending: false, placedAt: T0 + 10 };
const sell: WatchedTrade = { side: "sell", entry: 100, stop: 110, target: 80, pending: false, placedAt: T0 + 10 };

describe("findLevelHit", () => {
  it("sees a buy reach its take profit", () => {
    expect(findLevelHit(buy, [c(0, 99, 101), c(1, 100, 115), c(2, 110, 121)], "1m")).toEqual({ level: "take_profit", price: 120, at: T0 + 120 });
  });
  it("sees a buy reach its stop loss", () => {
    expect(findLevelHit(buy, [c(0, 99, 101), c(1, 89, 100)], "1m")).toMatchObject({ level: "stop_loss", price: 90 });
  });
  it("sees a sell's levels the other way round", () => {
    expect(findLevelHit(sell, [c(1, 79, 100)], "1m")).toMatchObject({ level: "take_profit", price: 80 });
    expect(findLevelHit(sell, [c(1, 95, 111)], "1m")).toMatchObject({ level: "stop_loss", price: 110 });
  });
  it("is null while neither level is reached", () => {
    expect(findLevelHit(buy, [c(0, 95, 105), c(1, 91, 119)], "1m")).toBeNull();
  });
  it("ignores prices from before the trade was placed", () => {
    expect(findLevelHit({ ...buy, placedAt: T0 + 130 }, [c(0, 80, 130), c(1, 99, 101)], "1m")).toBeNull();
  });
  it("in the candle it was placed in, only the close counts", () => {
    // high and low reach both levels, but maybe before the trade: not a hit
    expect(findLevelHit(buy, [c(0, 80, 130, 100)], "1m")).toBeNull();
    expect(findLevelHit(buy, [c(0, 80, 130, 100)], "5m")).toBeNull();
    // closed beyond the take profit after the trade was placed: a hit, dated when placed
    const closedAbove = { ...c(0, 99, 125, 100), close: 121 };
    expect(findLevelHit(buy, [closedAbove], "1m")).toEqual({ level: "take_profit", price: 120, at: T0 + 10 });
  });
  it("waits for a pending order to fill before watching", () => {
    const limit: WatchedTrade = { ...buy, entry: 95, pending: true };
    // take profit reached before the buy limit filled: not a hit
    expect(findLevelHit(limit, [c(0, 96, 125, 100), c(1, 100, 125)], "1m")).toBeNull();
    // fills, then reaches the stop
    expect(findLevelHit(limit, [c(0, 96, 98, 100), c(1, 94, 97), c(2, 89, 95)], "1m")).toMatchObject({ level: "stop_loss", at: T0 + 120 });
  });
  it("a pending order that fills in the placing candle and moves away is still watched", () => {
    const limit: WatchedTrade = { ...buy, entry: 95, pending: true };
    const filled = { ...c(0, 93, 100, 100), close: 94 };
    expect(findLevelHit(limit, [filled, c(1, 89, 94)], "1m")).toMatchObject({ level: "stop_loss" });
  });
  it("picks the level nearer the open when one candle reaches both", () => {
    expect(findLevelHit(buy, [c(1, 89, 121, 118)], "1m")).toMatchObject({ level: "take_profit" });
    expect(findLevelHit(buy, [c(1, 89, 121, 92)], "1m")).toMatchObject({ level: "stop_loss" });
  });
  it("watches only the levels the ticket has", () => {
    expect(findLevelHit({ ...buy, target: null }, [c(1, 95, 200)], "1m")).toBeNull();
    expect(findLevelHit({ ...buy, target: null, stop: null }, [c(1, 0, 999)], "1m")).toBeNull();
  });
});

describe("watchTimeframe", () => {
  it("uses 1m candles for a young trade and coarser ones as it ages", () => {
    expect(watchTimeframe(0, 60 * 60)).toBe("1m");
    expect(watchTimeframe(0, 10 * 3600)).toBe("5m");
    expect(watchTimeframe(0, 40 * 86400)).toBe("4h");
    expect(watchTimeframe(0, 400 * 86400)).toBe("1d");
  });
});
