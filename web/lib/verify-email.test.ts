import { describe, expect, it } from "vitest";

function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "your email";
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const first = local.charAt(0);
  return `${first}***@${domain}`;
}

function isValidCode(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

describe("Verify email helpers (Task M1, Figma 2)", () => {
  describe("maskEmail", () => {
    it("masks email to format h***@example.com matching Figma screen 2", () => {
      expect(maskEmail("helen@example.com")).toBe("h***@example.com");
      expect(maskEmail("trader@edge.ng")).toBe("t***@edge.ng");
      expect(maskEmail("a@domain.com")).toBe("a***@domain.com");
    });

    it("handles missing or malformed emails gracefully", () => {
      expect(maskEmail("")).toBe("your email");
      expect(maskEmail("invalid")).toBe("your email");
    });
  });

  describe("isValidCode", () => {
    it("accepts strictly 6 numeric digits", () => {
      expect(isValidCode("123456")).toBe(true);
      expect(isValidCode("000000")).toBe(true);
      expect(isValidCode("987654")).toBe(true);
    });

    it("rejects non-numeric, short, long, or whitespace codes", () => {
      expect(isValidCode("12345")).toBe(false);
      expect(isValidCode("1234567")).toBe(false);
      expect(isValidCode("12345a")).toBe(false);
      expect(isValidCode("")).toBe(false);
      expect(isValidCode("12 345")).toBe(false);
    });
  });
});
