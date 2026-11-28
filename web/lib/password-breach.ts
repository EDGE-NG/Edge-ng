import { createHash } from "node:crypto";

/**
 * Checks whether a SHA-1 suffix (35 uppercase hex chars) appears with count > 0
 * in a Have I Been Pwned k-Anonymity range response.
 */
export function isSuffixInRangeResponse(body: string, suffix: string): boolean {
  const target = suffix.toUpperCase();
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const lineSuffix = line.slice(0, colon).trim().toUpperCase();
    const count = Number.parseInt(line.slice(colon + 1).trim(), 10);
    if (lineSuffix === target && Number.isFinite(count) && count > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a password appears in known data breaches using Have I Been Pwned's
 * k-Anonymity API (only the first 5 characters of the SHA-1 hash are sent).
 * Fails open (returns false) if the external service is unavailable or times out.
 */
export async function checkPasswordBreached(password: string): Promise<boolean> {
  if (!password) return false;
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "Edge-PreTrade-App",
      },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const text = await res.text();
    return isSuffixInRangeResponse(text, suffix);
  } catch {
    return false;
  }
}
