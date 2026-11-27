import { afterEach, describe, expect, it } from "vitest";
import { budget, KEYED_TTL_MS, msUntilUtcMidnight, staleMaxMs } from "./market-cache";

describe("budget: stays under Twelve Data's plan limits", () => {
  afterEach(() => {
    delete process.env.TWELVE_DATA_PER_MINUTE;
    delete process.env.TWELVE_DATA_PER_DAY;
  });

  it("defaults to the free plan with headroom", () => {
    expect(budget()).toEqual({ perMinute: 7, perDay: 760 });
  });

  it("follows a paid plan's limits from the environment", () => {
    process.env.TWELVE_DATA_PER_MINUTE = "55";
    process.env.TWELVE_DATA_PER_DAY = "5000";
    expect(budget()).toEqual({ perMinute: 54, perDay: 4750 });
  });

  it("ignores nonsense values", () => {
    process.env.TWELVE_DATA_PER_MINUTE = "abc";
    process.env.TWELVE_DATA_PER_DAY = "-3";
    expect(budget()).toEqual({ perMinute: 7, perDay: 760 });
  });
});

describe("msUntilUtcMidnight: the daily count resets at 00:00 UTC", () => {
  it("counts to the next UTC midnight", () => {
    expect(msUntilUtcMidnight(Date.UTC(2026, 10, 28, 23, 0, 0))).toBe(60 * 60_000);
    expect(msUntilUtcMidnight(Date.UTC(2026, 10, 28, 0, 0, 0))).toBe(24 * 60 * 60_000);
    // month and year roll over
    expect(msUntilUtcMidnight(Date.UTC(2026, 11, 31, 12, 0, 0))).toBe(12 * 60 * 60_000);
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
