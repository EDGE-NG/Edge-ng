import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { safeTimeZone } from "@/lib/time";

/**
 * Journal month in review (PRD 4.6): how each rule held up at the pre-trade
 * check over one calendar month in the trader's time zone: the rules kept best
 * and the rules that failed most, given equal weight. Read from the decision
 * snapshots (REQ-GT-5), so no extra storage is needed.
 *
 * GET /api/journal/month?month=YYYY-MM (default: the current month)
 */

const RULES = `CASE WHEN jsonb_typeof(d.snapshot->'rules') = 'array' THEN d.snapshot->'rules' ELSE '[]'::jsonb END`;

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const tz = safeTimeZone(user.timezone);
  const months = (await db.one<{ current: string; first: string | null }>(
    `SELECT to_char(now() AT TIME ZONE ?, 'YYYY-MM') AS current,
       (SELECT to_char(min(decided_at) AT TIME ZONE ?, 'YYYY-MM') FROM gate_decisions WHERE user_id = ?) AS first`,
    tz, tz, user.id
  ))!;

  const asked = new URL(req.url).searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= months.current ? asked : months.current;

  // Month start and end as instants: local midnight on the 1st, in the trader's zone.
  const range = `d.decided_at >= (?::date)::timestamp AT TIME ZONE ?
                 AND d.decided_at < ((?::date) + interval '1 month')::timestamp AT TIME ZONE ?`;
  const first = `${month}-01`;
  const rangeArgs = [first, tz, first, tz];

  const [totals, perRule] = await Promise.all([
    db.one<{ trades: number; clean: number; checks: number; passes: number; fails: number }>(
      `SELECT
         count(*)::int AS trades,
         count(*) FILTER (WHERE x.total > 0 AND x.passes = x.total)::int AS clean,
         coalesce(sum(x.total), 0)::int AS checks,
         coalesce(sum(x.passes), 0)::int AS passes,
         coalesce(sum(x.fails), 0)::int AS fails
       FROM (
         SELECT
           (SELECT count(*) FROM jsonb_array_elements(${RULES}) r) AS total,
           (SELECT count(*) FROM jsonb_array_elements(${RULES}) r WHERE r->>'status' = 'pass') AS passes,
           (SELECT count(*) FROM jsonb_array_elements(${RULES}) r WHERE r->>'status' = 'fail') AS fails
         FROM gate_decisions d
         WHERE d.user_id = ? AND ${range}
       ) x`,
      user.id, ...rangeArgs
    ),
    db.all<{ text: string; checks: number; passes: number; fails: number }>(
      `SELECT (array_agg(r->'rule'->>'text' ORDER BY d.decided_at DESC))[1] AS text,
         count(*)::int AS checks,
         count(*) FILTER (WHERE r->>'status' = 'pass')::int AS passes,
         count(*) FILTER (WHERE r->>'status' = 'fail')::int AS fails
       FROM gate_decisions d, jsonb_array_elements(${RULES}) r
       WHERE d.user_id = ? AND ${range} AND r->'rule'->>'item_key' IS NOT NULL
       GROUP BY r->'rule'->>'item_key'`,
      user.id, ...rangeArgs
    ),
  ]);

  const rules = perRule.map((r) => ({
    text: r.text,
    checks: Number(r.checks),
    passes: Number(r.passes),
    fails: Number(r.fails),
  }));
  const kept = rules
    .filter((r) => r.passes > 0)
    .sort((a, b) => b.passes / b.checks - a.passes / a.checks || b.passes - a.passes)
    .slice(0, 5)
    .map(({ text, passes, checks }) => ({ text, passes, checks }));
  const slipped = rules
    .filter((r) => r.fails > 0)
    .sort((a, b) => b.fails - a.fails || b.fails / b.checks - a.fails / a.checks)
    .slice(0, 5)
    .map(({ text, fails, checks }) => ({ text, fails, checks }));

  const t = totals!;
  return NextResponse.json({
    month,
    currentMonth: months.current,
    firstMonth: months.first ?? months.current,
    trades: Number(t.trades),
    cleanTrades: Number(t.clean),
    checks: Number(t.checks),
    passes: Number(t.passes),
    fails: Number(t.fails),
    kept,
    slipped,
  });
}
