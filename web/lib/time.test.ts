import { describe, expect, it } from "vitest";
import { safeTimeZone } from "./time";

describe("safeTimeZone: only real time zones reach SQL", () => {
  it("keeps a valid zone", () => expect(safeTimeZone("Africa/Lagos")).toBe("Africa/Lagos"));
  it.each([null, undefined, "", "Not/AZone", "'; DROP TABLE profiles; --"])("falls back to UTC for %s", (tz) =>
    expect(safeTimeZone(tz)).toBe("UTC")
  );
});
