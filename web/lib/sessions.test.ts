import { describe, expect, it } from "vitest";
import { checkSessionRule, isPlainSessionRule, sessionsInRule, weekendClosed } from "./sessions";

// Fixed instants (UTC). November: London is on GMT, New York on EST (UTC-5).
const TUE_ASIAN = new Date("2026-11-24T01:00:00Z"); // 10:00 Tokyo, 01:00 London, 20:00 Mon New York
const TUE_LONDON_ONLY = new Date("2026-11-24T10:00:00Z"); // 10:00 London, 05:00 New York
const TUE_OVERLAP = new Date("2026-11-24T14:00:00Z"); // 14:00 London, 09:00 New York
const SAT = new Date("2026-11-28T12:00:00Z");

describe("isPlainSessionRule: only rules the clock can answer exactly", () => {
  it.each([
    "Entry during the London session",
    "Only trade the New York session",
    "Trade the London/New York overlap",
    "Only trade when the London session is open",
  ])("plain: %s", (text) => expect(isPlainSessionRule(text)).toBe(true));

  // Regression (#13): these used to be checked from the clock, so a negated
  // rule PASSED while the session it forbids was open.
  it.each([
    "Never trade during the Asian session",
    "Don't enter in the Asian session",
    "Avoid the Asian session",
    "No trades outside the London session",
    "Only the first hour of the London session",
    "Enter after the New York session opening",
    "Trade the London session before 10:00",
    "London session high must be swept",
    "Risk 1% per trade",
  ])("not plain (trader answers it): %s", (text) => expect(isPlainSessionRule(text)).toBe(false));
});

describe("checkSessionRule", () => {
  it("passes when the named session is open", () => {
    expect(checkSessionRule("Entry during the Asian session", TUE_ASIAN, "forex")?.pass).toBe(true);
    expect(checkSessionRule("Entry during the London session", TUE_LONDON_ONLY, "forex")?.pass).toBe(true);
  });

  it("fails when the named session is closed", () => {
    expect(checkSessionRule("Entry during the London session", TUE_ASIAN, "forex")?.pass).toBe(false);
  });

  it("overlap needs London and New York both open", () => {
    expect(checkSessionRule("Trade the London/New York overlap", TUE_OVERLAP, "forex")?.pass).toBe(true);
    expect(checkSessionRule("Trade the London/New York overlap", TUE_LONDON_ONLY, "forex")?.pass).toBe(false);
  });

  it("never guesses: a negated rule gets no clock answer (Inconclusive), never a pass", () => {
    expect(checkSessionRule("Never trade during the Asian session", TUE_ASIAN, "forex")).toBeNull();
  });

  it("forex is closed at the weekend", () => {
    const r = checkSessionRule("Entry during the London session", SAT, "forex");
    expect(r?.pass).toBe(false);
  });
});

describe("weekendClosed", () => {
  it("closes forex Friday 17:00 to Sunday 17:00 New York, never crypto", () => {
    expect(weekendClosed(SAT, "forex")).toBe(true);
    expect(weekendClosed(SAT, "crypto")).toBe(false);
    expect(weekendClosed(TUE_LONDON_ONLY, "forex")).toBe(false);
    expect(weekendClosed(new Date("2026-11-27T21:59:00Z"), "forex")).toBe(false); // Fri 16:59 NY
    expect(weekendClosed(new Date("2026-11-27T22:00:00Z"), "forex")).toBe(true); // Fri 17:00 NY
  });
});

describe("sessionsInRule", () => {
  it("reads session names, and 'any' is not New York", () => {
    expect(sessionsInRule("Trade in any session")).toBeNull();
    expect(sessionsInRule("NY session only")?.keys).toEqual(["newyork"]);
  });
});
