import { afterEach, describe, expect, it } from "vitest";
import { budget, KEYED_TTL_MS, maxCallsPerMinute, staleMaxMs } from "./market-cache";

describe("budget: stays under Twelve Data's plan limits", () => {
  afterEach(() => {
    delete process.env.TWELVE_DATA_PER_MINUTE;
    delete process.env.TWELVE_DATA_PER_DAY;
  });

  it("defaults to the free plan with headroom", () => {
    expect(budget()).toEqual({ perMinute: 7, perDay: 760, spacingMs: 8572 });
  });

  it("follows a paid plan's limits from the environment", () => {
    process.env.TWELVE_DATA_PER_MINUTE = "55";
    process.env.TWELVE_DATA_PER_DAY = "5000";
    expect(budget()).toEqual({ perMinute: 54, perDay: 4750, spacingMs: 1112 });
  });

  it("ignores nonsense values", () => {
    process.env.TWELVE_DATA_PER_MINUTE = "abc";
    process.env.TWELVE_DATA_PER_DAY = "-3";
    expect(budget()).toEqual({ perMinute: 7, perDay: 760, spacingMs: 8572 });
  });
});

describe("spacing: no burst can pass the per-minute limit", () => {
  it("fits at most the plan's limit minus one in any 60 seconds", () => {
    expect(maxCallsPerMinute(budget().spacingMs)).toBe(7);
  });

  it("holds for paid plans too", () => {
    process.env.TWELVE_DATA_PER_MINUTE = "55";
    expect(maxCallsPerMinute(budget().spacingMs)).toBeLessThanOrEqual(54);
    delete process.env.TWELVE_DATA_PER_MINUTE;
  });
});

describe("staleness: old prices are never served for long", () => {
  it("serves cached candles at most 10 minutes old on short timeframes", () => {
    expect(staleMaxMs("1m")).toBe(10 * 60_000);
    expect(staleMaxMs("15m")).toBe(10 * 60_000);
  });

  it("always allows more than the normal refresh time", () => {
    for (const tf of Object.keys(KEYED_TTL_MS) as Array<keyof typeof KEYED_TTL_MS>) {
      expect(staleMaxMs(tf)).toBeGreaterThan(KEYED_TTL_MS[tf]);
    }
  });
});
