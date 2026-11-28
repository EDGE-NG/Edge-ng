import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDueMonitors } from "@/lib/alerts";
import { watchTrades } from "@/lib/trade-watch";

/**
 * The scheduler calls this every few minutes with
 * `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends that header
 * itself; Supabase pg_cron or an outside cron service can send it too). It
 * checks the monitors that are due, then the placed trades Edge watches for
 * their stop loss and take profit (Task D5). Not for browsers.
 */
export const maxDuration = 60;
const BUDGET_MS = 40_000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const started = Date.now();
  const results = await runDueMonitors(BUDGET_MS);
  const trades = await watchTrades({ budgetMs: Math.max(5_000, BUDGET_MS - (Date.now() - started)) });
  return NextResponse.json({
    checked: results.length,
    alerted: results.filter((r) => r.alerted).length,
    errors: results.filter((r) => r.error).length,
    trades: { checked: trades.length, hit: trades.filter((t) => t.hit).length, errors: trades.filter((t) => t.error).length },
  });
}

export const GET = run;
export const POST = run;
