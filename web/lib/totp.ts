import { createHash, createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BACKUP_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // Unambiguous alphanumeric characters

/**
 * Decodes a base32 string into a Buffer.
 */
export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/\s+/g, "").replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/**
 * Generates a random base32 TOTP secret (16 uppercase chars, matching Figma screen 3).
 */
export function generateTotpSecret(length = 16): string {
  const bytes = randomBytes(length);
  let secret = "";
  for (let i = 0; i < length; i++) {
    secret += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return secret;
}

/**
 * Formats a secret key into space-separated groups of 4 (e.g. "K4Q7 M2XD 9PLA 3VRT").
 */
export function formatKey(secret: string): string {
  const clean = secret.toUpperCase().replace(/\s+/g, "");
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    chunks.push(clean.slice(i, i + 4));
  }
  return chunks.join(" ");
}

/**
 * Generates 8 backup codes in format XXXX-XXXX (matching Figma screen 4).
 */
export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let c = 0; c < count; c++) {
    const bytes = randomBytes(8);
    let part1 = "";
    let part2 = "";
    for (let i = 0; i < 4; i++) {
      part1 += BACKUP_CHARSET[bytes[i] % BACKUP_CHARSET.length];
      part2 += BACKUP_CHARSET[bytes[i + 4] % BACKUP_CHARSET.length];
    }
    codes.push(`${part1}-${part2}`);
  }
  return codes;
}

/**
 * SHA-256 hash of a normalized backup code (lowercase, hyphen stripped).
 */
export function hashBackupCode(code: string): string {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Computes an RFC 6238 TOTP token for the given time step.
 */
export function generateTotp(
  secret: string,
  timeStep = Math.floor(Date.now() / 1000 / 30)
): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(timeStep));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const otp = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
  return otp;
}

/**
 * Verifies a 6-digit TOTP code against the secret with a clock drift window (default ±1 step).
 */
export function verifyTotpCode(secret: string, code: string, window = 1): boolean {
  const cleanCode = code.trim();
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const currentStep = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (generateTotp(secret, currentStep + i) === cleanCode) {
      return true;
    }
  }
  return false;
}

export const TWO_STEP_PENDING_COOKIE = "edge_2fa_pending";

export interface BackupCodeEntry {
  hash: string;
  used: boolean;
  createdAt?: string;
  usedAt?: string;
}

export interface TwoStepSettings {
  enabled?: boolean;
  factorId?: string | null;
  secret?: string | null;
  backupCodes?: BackupCodeEntry[];
  enabledAt?: string;
  acknowledged?: boolean;
  acknowledgedAt?: string;
}

/**
 * Checks an input backup code against stored hashed codes.
 * Each backup code is single-use: if matched and unused, returns updated list with used=true.
 */
export function consumeBackupCode(
  backupCodes: BackupCodeEntry[],
  inputCode: string
): { matched: boolean; updatedCodes: BackupCodeEntry[] } {
  const clean = inputCode.trim();
  if (!clean) return { matched: false, updatedCodes: backupCodes };
  const targetHash = hashBackupCode(clean);
  const idx = backupCodes.findIndex((c) => !c.used && c.hash === targetHash);
  if (idx === -1) {
    return { matched: false, updatedCodes: backupCodes };
  }
  const updatedCodes = backupCodes.map((c, i) =>
    i === idx ? { ...c, used: true, usedAt: new Date().toISOString() } : c
  );
  return { matched: true, updatedCodes };
}

/**
 * Builds an otpauth:// URI for authenticator apps.
 */
export function getTotpUri(email: string, secret: string, issuer = "Edge"): string {
  const cleanSecret = secret.toUpperCase().replace(/\s+/g, "");
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    email
  )}?secret=${cleanSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
