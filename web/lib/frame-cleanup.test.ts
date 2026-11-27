import { describe, expect, it } from "vitest";
import { ownsKey } from "./frame-cleanup";

const USER = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9876543210fe";

describe("ownsKey: the cleanup only deletes files in the owner's own folder", () => {
  it("accepts a frame file in the trader's folder", () => {
    expect(ownsKey(USER, `${USER}/frame-1234.png`)).toBe(true);
  });

  it.each([
    [`${OTHER}/frame-1234.png`, "another trader's folder"],
    [`${USER}/`, "the folder itself"],
    [`${USER}/sub/frame.png`, "a sub-folder"],
    [`${USER}/../${OTHER}/frame.png`, "path tricks"],
    [`${USER}frame.png`, "no slash after the id"],
    ["frame.png", "no folder at all"],
    ["", "an empty key"],
  ])("refuses %s (%s)", (key) => expect(ownsKey(USER, key)).toBe(false));

  it("refuses a user id that isn't a uuid", () => {
    expect(ownsKey("..", "../frame.png")).toBe(false);
  });
});
