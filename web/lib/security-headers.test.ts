import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const live = { dev: false, preview: false };
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " ")) ?? "";

describe("contentSecurityPolicy on the live site", () => {
  const csp = contentSecurityPolicy(live);

  it("never allows eval, plugins, or other sites framing Edge", () => {
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("lets the browser connect only to Edge itself (AI and data stay on the server)", () => {
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
  });

  it("allows Google Fonts and nothing else from outside", () => {
    const hosts = csp.match(/https:\/\/[^\s;]+/g) ?? [];
    expect(new Set(hosts)).toEqual(new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]));
  });

  it("keeps forms and the base URL on Edge", () => {
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
  });
});

describe("contentSecurityPolicy in development and previews", () => {
  it("allows eval and the hot-reload socket only in development", () => {
    const csp = contentSecurityPolicy({ dev: true, preview: false });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain("ws:");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("allows Vercel's toolbar only on preview builds", () => {
    expect(contentSecurityPolicy(live)).not.toContain("vercel.live");
    expect(contentSecurityPolicy({ dev: false, preview: true })).toContain("https://vercel.live");
  });
});

describe("securityHeaders", () => {
  const byKey = (opts: typeof live) => Object.fromEntries(securityHeaders(opts).map((h) => [h.key, h.value]));

  it("sends the hardening headers on the live site", () => {
    const h = byKey(live);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Strict-Transport-Security"]).toMatch(/^max-age=\d+/);
    // voice notes need the microphone on Edge itself; the camera is never needed
    expect(h["Permissions-Policy"]).toContain("microphone=(self)");
    expect(h["Permissions-Policy"]).toContain("camera=()");
  });

  it("doesn't send HSTS on localhost", () => {
    expect(byKey({ dev: true, preview: false })["Strict-Transport-Security"]).toBeUndefined();
  });
});
