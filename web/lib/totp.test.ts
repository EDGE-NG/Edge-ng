import { describe, expect, it } from "vitest";
import { renderQrSvg } from "./qr-svg";
import {
  base32Decode,
  formatKey,
  generateBackupCodes,
  generateTotp,
  generateTotpSecret,
  getTotpUri,
  hashBackupCode,
  verifyTotpCode,
} from "./totp";

describe("Two-Step Auth and Backup Codes (Task M2, Figma 3 & 4)", () => {
  describe("generateTotpSecret and formatKey", () => {
    it("generates a 16-character base32 secret", () => {
      const secret = generateTotpSecret(16);
      expect(secret).toHaveLength(16);
      expect(secret).toMatch(/^[A-Z2-7]{16}$/);
    });

    it("formats secret into space-separated groups of 4 matching Figma screen 3", () => {
      const secret = "K4Q7M2XD9PLA3VRT";
      expect(formatKey(secret)).toBe("K4Q7 M2XD 9PLA 3VRT");
    });
  });

  describe("TOTP verification", () => {
    it("verifies a valid TOTP code for the current time step", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const code = generateTotp(secret);
      expect(verifyTotpCode(secret, code)).toBe(true);
    });

    it("rejects invalid, malformed, or wrong-length codes", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      expect(verifyTotpCode(secret, "000000")).toBe(false);
      expect(verifyTotpCode(secret, "12345")).toBe(false);
      expect(verifyTotpCode(secret, "abcdef")).toBe(false);
    });

    it("constructs valid otpauth:// URI", () => {
      const uri = getTotpUri("helen@example.com", "K4Q7M2XD9PLA3VRT", "Edge");
      expect(uri).toContain("otpauth://totp/Edge:helen%40example.com");
      expect(uri).toContain("secret=K4Q7M2XD9PLA3VRT");
      expect(uri).toContain("issuer=Edge");
    });
  });

  describe("Backup codes generation and hashing", () => {
    it("generates 8 backup codes matching format XXXX-XXXX (Figma screen 4)", () => {
      const codes = generateBackupCodes(8);
      expect(codes).toHaveLength(8);
      for (const code of codes) {
        expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      }
    });

    it("hashes backup codes with SHA-256 in normalized lowercase without hyphens", () => {
      const h1 = hashBackupCode("7H2K-9QXD");
      const h2 = hashBackupCode("7h2k9qxd");
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("renderQrSvg", () => {
    it("returns valid SVG markup with finder patterns", () => {
      const svg = renderQrSvg("", "otpauth://totp/Edge:test?secret=1234");
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain("<path");
    });

    it("passes through valid SVG from Supabase GoTrue", () => {
      const input = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
      expect(renderQrSvg(input, "uri")).toBe(input);
    });
  });
});
