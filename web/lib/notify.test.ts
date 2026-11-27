import { describe, expect, it } from "vitest";
import { vapidSubject } from "./notify";

describe("vapidSubject: push services only accept https: or mailto:", () => {
  it("keeps a valid subject", () => {
    expect(vapidSubject("mailto:alerts@edge.ng", "http://localhost:3000")).toBe("mailto:alerts@edge.ng");
    expect(vapidSubject("https://edge.ng", "http://localhost:3000")).toBe("https://edge.ng");
  });
  it("falls back from http://localhost", () => {
    expect(vapidSubject("http://localhost:3000", "http://localhost:3000")).toBe("https://edge.ng");
    expect(vapidSubject("", "https://app.edge.ng")).toBe("https://app.edge.ng");
  });
});
