import { describe, expect, it } from "vitest";
import { isSuffixInRangeResponse } from "./password-breach";

describe("Password breach k-Anonymity helper (Task M4, Figma 1b)", () => {
  const sampleRange = [
    "0018A45C4D1DEF81644B54AB7F969B88D65:1",
    "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2",
    "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493",
    "FFFFFF00000000000000000000000000000:0",
  ].join("\r\n");

  it("matches a breached SHA-1 suffix case-insensitively when count > 0", () => {
    expect(isSuffixInRangeResponse(sampleRange, "1E4C9B93F3F0682250B6CF8331B7EE68FD8")).toBe(true);
    expect(isSuffixInRangeResponse(sampleRange, "1e4c9b93f3f0682250b6cf8331b7ee68fd8")).toBe(true);
  });

  it("returns false for zero-count padded entries or non-matching suffixes", () => {
    expect(isSuffixInRangeResponse(sampleRange, "FFFFFF00000000000000000000000000000")).toBe(false);
    expect(isSuffixInRangeResponse(sampleRange, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
    expect(isSuffixInRangeResponse("", "1E4C9B93F3F0682250B6CF8331B7EE68FD8")).toBe(false);
  });
});
