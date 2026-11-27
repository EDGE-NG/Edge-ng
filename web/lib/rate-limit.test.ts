import { describe, expect, it } from "vitest";
import { hashKey, memoryHit } from "./rate-limit";

describe("hashKey: the table never stores an email or IP", () => {
  it("returns a sha256 hex digest, not the key", () => {
    const h = hashKey("login:trader@example.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("trader");
  });

  it("is stable, and different keys differ", () => {
    expect(hashKey("login:a@b.co")).toBe(hashKey("login:a@b.co"));
    expect(hashKey("login:a@b.co")).not.toBe(hashKey("login-ip:a@b.co"));
  });
});

describe("memoryHit: the fallback counter when the database is down", () => {
  it("counts attempts within the window, then starts again", () => {
    const key = `test-${Math.random()}`;
    const t0 = 1_000_000;
    expect(memoryHit(key, 60_000, t0)).toBe(1);
    expect(memoryHit(key, 60_000, t0 + 1_000)).toBe(2);
    expect(memoryHit(key, 60_000, t0 + 59_999)).toBe(3);
    // window over: back to 1
    expect(memoryHit(key, 60_000, t0 + 60_000)).toBe(1);
  });

  it("keeps separate keys apart", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    memoryHit(a, 60_000, 0);
    memoryHit(a, 60_000, 1);
    expect(memoryHit(b, 60_000, 2)).toBe(1);
  });
});
