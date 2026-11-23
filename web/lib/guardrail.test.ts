import { describe, expect, it } from "vitest";
import { findInAll, findPredictionLanguage } from "./guardrail";

describe("findPredictionLanguage: Edge never predicts (PR-GT-8, REQ-LLM-12)", () => {
  it.each([
    "Price will likely rise from here.",
    "This trade is going to hit your target.",
    "Gold is poised to break out.",
    "This is a great setup.",
    "A high-probability setup.",
    "Profit is guaranteed on this one.",
    "You should buy now.",
    "I recommend you go long.",
  ])("blocks: %s", (text) => expect(findPredictionLanguage(text)).not.toBeNull());

  it.each([
    "The 4H trend is up: higher highs and higher lows on candles 3 to 10.",
    "This passes your checklist.",
    "Your rule fails: price is below the 50 EMA.",
    "Edge still needs the 1H chart.",
  ])("allows factual wording: %s", (text) => expect(findPredictionLanguage(text)).toBeNull());

  it("doesn't flag the trader's own rule quoted back to them", () => {
    const own = ["only buy if price will bounce off support"];
    expect(findPredictionLanguage("Your rule: only buy if price will bounce off support.", own)).toBeNull();
    // but Edge's own prediction next to it is still caught
    expect(findPredictionLanguage("Your rule is met and price will rise.", own)).not.toBeNull();
  });

  it("handles curly quotes and extra spaces", () => {
    expect(findPredictionLanguage("You can’t   lose  here")).not.toBeNull();
  });
});

describe("findInAll", () => {
  it("returns the first hit across fields and skips empty ones", () => {
    expect(findInAll([null, "", "Trend is up.", "It will rally."])).toBe("will rally");
    expect(findInAll([undefined, "Trend is up."])).toBeNull();
  });
});
