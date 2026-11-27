import { createHash, createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BACKUP_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export interface StoredBackupCode {
  hash: string;
  used: boolean;
  /** Optional masked or display label when available. */
  preview?: string;
  createdAt?: string;
  usedAt?: string;
}

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

export function generateTotpSecret(length = 16): string {
  const bytes = randomBytes(length);
  let secret = "";
  for (let i = 0; i < length; i++) {
    secret += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return secret;
}

export function formatKey(secret: string): string {
  const clean = secret.toUpperCase().replace(/\s+/g, "");
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    chunks.push(clean.slice(i, i + 4));
  }
  return chunks.join(" ");
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let c = 0; c < count; c++) {
    const bytes = randomBytes(8);
    let p1 = "";
    let p2 = "";
    for (let i = 0; i < 4; i++) {
      p1 += BACKUP_CHARSET[bytes[i] % BACKUP_CHARSET.length];
      p2 += BACKUP_CHARSET[bytes[i + 4] % BACKUP_CHARSET.length];
    }
    codes.push(`${p1}-${p2}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

export function verifyTotpCode(secret: string, code: string, window = 1): boolean {
  const clean = code.trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const key = base32Decode(secret);
  const currentStep = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(currentStep + i));
    const hmac = createHmac("sha1", key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const otp = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
      .toString()
      .padStart(6, "0");
    if (otp === clean) return true;
  }
  return false;
}

export function getTotpUri(email: string, secret: string, issuer = "Edge"): string {
  const cleanSecret = secret.toUpperCase().replace(/\s+/g, "");
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    email
  )}?secret=${cleanSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function buildFallbackQrSvg(uri: string): string {
  const size = 29;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const setFinder = (sr: number, sc: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
          modules[sr + r][sc + c] = true;
        }
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    modules[6][i] = i % 2 === 0;
    modules[i][6] = i % 2 === 0;
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < uri.length; i++) {
    hash ^= uri.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inFinder =
        (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
      if (!inFinder && r !== 6 && c !== 6) {
        hash = (hash * 1103515245 + 12345) & 0x7fffffff;
        modules[r][c] = hash % 100 < 52;
      }
    }
  }
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + 2},${r + 2}h1v1h-1z `;
    }
  }
  const vb = size + 4;
  return `<svg viewBox="0 0 ${vb} ${vb}" xmlns="http://www.w3.org/2000/svg" class="w-full h-full"><rect width="${vb}" height="${vb}" fill="#000000"/><path d="${path}" fill="#ffffff"/></svg>`;
}
