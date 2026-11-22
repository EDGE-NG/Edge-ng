import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { MARKET_WEEK_START_SQL, PREV_MARKET_WEEK_START_SQL } from "@/lib/overrides";
import { safeTimeZone } from "@/lib/time";

/**
 * Dashboard (PRD 4.7): how closely the trader followed their own plan.
 *
 * A gate decision counts as:
 *  - broke the plan: the trader overrode it (PR-OV-1);
 *  - pending: Needs evidence and not yet resolved (left out of adherence);
 *  - followed: everything else (traded a pass, or stood aside on a denial).
 * Adherence = followed / (followed + broke). It measures process, never P&L.
 *
 * ?period=week uses the market week (Sunday 18:00 New York, the same reset as
 * the override allowance); ?period=month uses the calendar month in the
 * trader's own time zone. Days are bucketed in the trader's time zone.
 */

const BROKE = `d.resolution = 'overridden'`;
const PENDING = `(d.result = 'needs_evidence' AND d.resolution IS NULL)`;
const FOLLOWED = `(d.resolution IS DISTINCT FROM 'overridden' AND NOT ${PENDING})`;
const RULES = `CASE WHEN jsonb_typeof(d.snapshot->'rules') = 'array' THEN d.snapshot->'rules' ELSE '[]'::jsonb END`;

interface DayRow {
  day: string;
  total: number;
  followed: number;
  broke: number;
}

const pct = (followed: number, broke: number) =>
  followed + broke > 0 ? Math.round((followed / (followed + broke)) * 100) : null;

function dayStats(rows: DayRow[]) {
  return rows.map((r) => {
    const followed = Number(r.followed);
    const broke = Number(r.broke);
    return { day: r.day, trades: Number(r.total), followed, broke, adherence: pct(followed, broke) };
  });
}

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const period = new URL(req.url).searchParams.get("period") === "month" ? "month" : "week";
  const tz = safeTimeZone(user.timezone);

  // Current and previous period start, as instants.
  const bounds = (await db.one<{ cur: string; prev: string; today: string }>(
    period === "week"
      ? `SELECT ${MARKET_WEEK_START_SQL} AS cur, ${PREV_MARKET_WEEK_START_SQL} AS prev,
           to_char((now() AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS today`
      : `SELECT date_trunc('month', now() AT TIME ZONE ?) AT TIME ZONE ? AS cur,
           (date_trunc('month', now() AT TIME ZONE ?) - interval '1 month') AT TIME ZONE ? AS prev,
           to_char((now() AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS today`,
    ...(period === "week" ? [tz] : [tz, tz, tz, tz, tz])
  ))!;

  const [totals, days, lastSessions, recent, rules] = await Promise.all([
    // Period totals, this period and the one before.
    db.one<{
      cur_followed: number;
      cur_broke: number;
      cur_total: number;
      cur_sessions: number;
      prev_followed: number;
      prev_broke: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE d.decided_at >= ? AND ${FOLLOWED})::int AS cur_followed,
         count(*) FILTER (WHERE d.decided_at >= ? AND ${BROKE})::int AS cur_broke,
         count(*) FILTER (WHERE d.decided_at >= ?)::int AS cur_total,
         count(DISTINCT (d.decided_at AT TIME ZONE ?)::date) FILTER (WHERE d.decided_at >= ?)::int AS cur_sessions,
         count(*) FILTER (WHERE d.decided_at < ? AND ${FOLLOWED})::int AS prev_followed,
         count(*) FILTER (WHERE d.decided_at < ? AND ${BROKE})::int AS prev_broke
       FROM gate_decisions d
       WHERE d.user_id = ? AND d.decided_at >= ?`,
      bounds.cur, bounds.cur, bounds.cur, tz, bounds.cur, bounds.cur, bounds.cur, user.id, bounds.prev
    ),
    // Month view: one entry per trading day this month.
    period === "month"
      ? db.all<DayRow>(
          `SELECT to_char((d.decided_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS day,
             count(*)::int AS total,
             count(*) FILTER (WHERE ${FOLLOWED})::int AS followed,
             count(*) FILTER (WHERE ${BROKE})::int AS broke
           FROM gate_decisions d
           WHERE d.user_id = ? AND d.decided_at >= ?
           GROUP BY 1 ORDER BY 1`,
          tz, user.id, bounds.cur
        )
      : Promise.resolve([] as DayRow[]),
    // Week view: the last 5 trading days, whatever week they fall in.
    period === "week"
      ? db.all<DayRow>(
          `SELECT to_char((d.decided_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS day,
             count(*)::int AS total,
             count(*) FILTER (WHERE ${FOLLOWED})::int AS followed,
             count(*) FILTER (WHERE ${BROKE})::int AS broke
           FROM gate_decisions d
           WHERE d.user_id = ?
           GROUP BY 1 ORDER BY 1 DESC LIMIT 5`,
          tz, user.id
        )
      : Promise.resolve([] as DayRow[]),
    // Recent trades with how many of their rules passed.
    db.all<{
      id: string;
      instrument: string;
      side: string;
      result: string;
      resolution: string | null;
      decided_at: string;
      rules_met: number;
      rules_total: number;
    }>(
      `SELECT d.id, i.instrument, i.side, d.result, d.resolution, d.decided_at,
         (SELECT count(*) FROM jsonb_array_elements(${RULES}) r WHERE r->>'status' = 'pass')::int AS rules_met,
         jsonb_array_length(${RULES})::int AS rules_total
       FROM gate_decisions d
       JOIN trade_intents i ON i.id = d.intent_id
       WHERE d.user_id = ?
       ORDER BY d.decided_at DESC LIMIT 3`,
      user.id
    ),
    // Rules of the trader's active checklists, and whether each is ready to be
    // checked: a chart rule needs at least one confirmed example (PR-CL-5).
    db.all<{ assessability: string; ready: boolean }>(
      `SELECT i.assessability,
         (i.assessability <> 'chart' OR EXISTS (
            SELECT 1 FROM evidence_images e
            WHERE e.user_id = ? AND e.checklist_id = c.id AND e.item_key = i.item_key AND e.status = 'confirmed'
         )) AS ready
       FROM checklists c
       JOIN checklist_items i ON i.version_id = c.active_version_id
       WHERE c.user_id = ? AND c.status = 'active'`,
      user.id, user.id
    ),
  ]);

  const t = totals!;
  const ready = rules.filter((r) => r.ready).length;

  return NextResponse.json({
    period,
    timezone: tz,
    today: bounds.today,
    periodStart: bounds.cur,
    adherence: pct(t.cur_followed, t.cur_broke),
    previousAdherence: pct(t.prev_followed, t.prev_broke),
    tradesReviewed: t.cur_total,
    sessions: t.cur_sessions,
    brokeCount: t.cur_broke,
    rules: { total: rules.length, ready, needExamples: rules.length - ready },
    lastSessions: dayStats(lastSessions).reverse(),
    days: dayStats(days),
    recent: recent.map((r) => ({
      id: r.id,
      instrument: r.instrument,
      side: r.side,
      decidedAt: r.decided_at,
      rulesMet: Number(r.rules_met),
      rulesTotal: Number(r.rules_total),
      status:
        r.resolution === "overridden"
          ? "broke"
          : r.result === "needs_evidence" && !r.resolution
            ? "pending"
            : "followed",
    })),
  });
}
