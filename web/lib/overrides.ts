import { db, type Db } from "@/lib/db";

/**
 * Weekly override allowance (new product decision, Daniel, 2026-11-18; not in
 * PRD v2.1). Each trader can override a gate decision OVERRIDES_PER_WEEK times
 * per market week. The market week starts Sunday 18:00 New York time (daylight
 * saving included), and every trader is back to the full allowance then,
 * whatever they used the week before. Overrides are still recorded with the
 * rules they overrode and never judged (PR-OV-1, REQ-GT-6); the limit only
 * caps how often the button can be used.
 */
export const OVERRIDES_PER_WEEK = 3;
export const MARKET_TZ = "America/New_York";

export interface OverrideAllowance {
  limit: number;
  used: number;
  left: number;
  /** When the allowance goes back to the full limit (next Sunday 18:00 New York). */
  resetsAt: string;
}

/*
 * Week start in SQL: take New York wall-clock time, shift it +6h so Sunday
 * 18:00 lands on Monday 00:00, truncate to the ISO week (Monday), shift back
 * 6h, and convert that wall-clock time back to a real instant. Doing it in
 * wall-clock time keeps it at 18:00 New York across DST changes.
 */
const WEEK_START_LOCAL = `(date_trunc('week', (now() AT TIME ZONE '${MARKET_TZ}') + interval '6 hours') - interval '6 hours')`;

export async function overrideAllowance(userId: string, q: Db = db): Promise<OverrideAllowance> {
  const row = (await q.one<{ used: number; resets_at: string }>(
    `SELECT
       (SELECT count(*)::int FROM overrides
         WHERE user_id = ? AND created_at >= (${WEEK_START_LOCAL} AT TIME ZONE '${MARKET_TZ}')) AS used,
       ((${WEEK_START_LOCAL} + interval '7 days') AT TIME ZONE '${MARKET_TZ}') AS resets_at`,
    userId
  ))!;
  const used = Number(row.used);
  return {
    limit: OVERRIDES_PER_WEEK,
    used,
    left: Math.max(0, OVERRIDES_PER_WEEK - used),
    resetsAt: row.resets_at,
  };
}

/** For server messages, e.g. "Sun 23 Nov, 18:00 New York time". */
export function resetText(iso: string): string {
  const s = new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MARKET_TZ,
  });
  return `${s} New York time`;
}
