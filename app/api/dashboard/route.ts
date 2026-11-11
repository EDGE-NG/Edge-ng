import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

/**
 * GET dashboard aggregates (PRD 4.8):
 * today's activity, status cards, verdict mix, review completion,
 * checklist adherence, 14-day process trend, recent trades & reviews.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const stats = (sql: string, ...args: Array<string | number | null>) =>
    db.prepare(sql).get(...args) as Record<string, number>;

  const edges = stats("SELECT COUNT(*) AS c FROM edges WHERE user_id = ?", user.id).c;
  const approvedEdges = stats(
    `SELECT COUNT(*) AS c FROM edges WHERE user_id = ? AND active_version_id IS NOT NULL`,
    user.id
  ).c;
  const reviews = stats("SELECT COUNT(*) AS c FROM trade_reviews WHERE user_id = ?", user.id).c;
  const completed = stats(
    "SELECT COUNT(*) AS c FROM trade_reviews WHERE user_id = ? AND status = 'completed'",
    user.id
  ).c;
  const overrides = stats(
    "SELECT COUNT(*) AS c FROM trade_reviews WHERE user_id = ? AND overridden_at IS NOT NULL",
    user.id
  ).c;
  const trades = stats("SELECT COUNT(*) AS c FROM trades WHERE user_id = ?", user.id).c;
  const journalCount = stats(
    "SELECT COUNT(*) AS c FROM journal_entries WHERE user_id = ?",
    user.id
  ).c;

  // --- today's activity (UTC, matches stored ISO timestamps) ---
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = stats(
    `SELECT
       (SELECT COUNT(*) FROM trade_reviews  WHERE user_id = ? AND created_at >= ?) AS reviews,
       (SELECT COUNT(*) FROM trades         WHERE user_id = ? AND created_at >= ?) AS trades,
       (SELECT COUNT(*) FROM journal_entries WHERE user_id = ? AND created_at >= ?) AS journals`,
    user.id,
    today,
    user.id,
    today,
    user.id,
    today
  );

  // --- verdict mix across all completed reviews ---
  const verdicts = db
    .prepare(
      `SELECT rr.verdict, COUNT(*) AS c
       FROM review_results rr
       JOIN trade_reviews tr ON tr.id = rr.review_id
       WHERE tr.user_id = ?
       GROUP BY rr.verdict`
    )
    .all(user.id) as Array<{ verdict: string; c: number }>;
  const verdictMap = { pass: 0, fail: 0, inconclusive: 0 } as Record<string, number>;
  for (const v of verdicts) verdictMap[v.verdict] = v.c;
  const totalVerdicts = verdictMap.pass + verdictMap.fail + verdictMap.inconclusive;

  // --- process trend: last 14 days of completed reviews & trades ---
  const days: Array<{ date: string; reviews: number; trades: number }> = [];
  const dayCounts = new Map<string, { reviews: number; trades: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    dayCounts.set(d, { reviews: 0, trades: 0 });
    days.push({ date: d, reviews: 0, trades: 0 });
  }
  const reviewDays = db
    .prepare(
      `SELECT substr(completed_at, 1, 10) AS d, COUNT(*) AS c
       FROM trade_reviews
       WHERE user_id = ? AND status = 'completed' AND completed_at >= ?
       GROUP BY d`
    )
    .all(user.id, days[0].date) as Array<{ d: string; c: number }>;
  const tradeDays = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c
       FROM trades
       WHERE user_id = ? AND created_at >= ?
       GROUP BY d`
    )
    .all(user.id, days[0].date) as Array<{ d: string; c: number }>;
  for (const r of reviewDays) dayCounts.get(r.d) && (dayCounts.get(r.d)!.reviews = r.c);
  for (const t of tradeDays) dayCounts.get(t.d) && (dayCounts.get(t.d)!.trades = t.c);
  for (const day of days) {
    const c = dayCounts.get(day.date)!;
    day.reviews = c.reviews;
    day.trades = c.trades;
  }

  // --- process streak: consecutive days back from today with a completed review ---
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const hit = db
      .prepare(
        `SELECT 1 FROM trade_reviews WHERE user_id = ? AND status = 'completed'
         AND substr(COALESCE(completed_at, created_at), 1, 10) = ? LIMIT 1`
      )
      .get(user.id, d);
    if (hit) streak++;
    else if (i > 0) break; // allow today to be empty without breaking the streak
  }

  // --- recent trades with P&L ---
  const recentTrades = db
    .prepare(
      `SELECT t.id, t.instrument, t.direction, t.pnl, t.created_at, t.notes,
              r.overall AS review_verdict
       FROM trades t
       LEFT JOIN trade_reviews r ON r.id = t.review_id
       WHERE t.user_id = ?
       ORDER BY t.created_at DESC
       LIMIT 5`
    )
    .all(user.id) as Array<Record<string, unknown>>;

  // --- net P&L across closed trades ---
  const pnlRow = stats(
    `SELECT COALESCE(SUM(pnl), 0) AS s FROM trades WHERE user_id = ? AND pnl IS NOT NULL`,
    user.id
  );

  const latestReview = db
    .prepare(
      `SELECT r.id, r.instrument, r.direction, r.overall, r.summary, r.status, r.created_at, r.completed_at,
              r.overridden_at, e.name AS edge_name
       FROM trade_reviews r
       JOIN edge_versions v ON v.id = r.edge_version_id
       JOIN edges e ON e.id = v.edge_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC
       LIMIT 1`
    )
    .get(user.id) as Record<string, unknown> | undefined;

  const recent = db
    .prepare(
      `SELECT r.id, r.instrument, r.direction, r.overall, r.status, r.created_at, r.completed_at, r.overridden_at
       FROM trade_reviews r
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC
       LIMIT 8`
    )
    .all(user.id) as Array<Record<string, unknown>>;

  return NextResponse.json({
    edges,
    approvedEdges,
    reviews,
    completed,
    overrides,
    trades,
    journalCount,
    today: { reviews: todayRow.reviews, trades: todayRow.trades, journals: todayRow.journals },
    verdicts: verdictMap,
    totalVerdicts,
    completionRate: reviews > 0 ? completed / reviews : 0,
    adherence: totalVerdicts > 0 ? verdictMap.pass / totalVerdicts : null,
    trend: days,
    streak,
    netPnl: pnlRow.s,
    recentTrades,
    latestReview: latestReview ?? null,
    recent,
  });
}
