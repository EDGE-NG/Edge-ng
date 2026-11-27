import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { purgeDueAccounts } from "@/lib/account-deletion";
import { cleanupOldFrames } from "@/lib/frame-cleanup";
import { purgeExpiredLimits } from "@/lib/rate-limit";

/**
 * The daily account purge (PRD F13). A scheduler (cron-job.org, like the
 * alerts) calls this once a day with `Authorization: Bearer <CRON_SECRET>`.
 * It deletes every account whose 14-day grace period has ended: files first,
 * then the account and all its data. It also deletes old chart pictures
 * (lib/frame-cleanup.ts) and clears expired rate-limit rows
 * (lib/rate-limit.ts), so no second scheduler job is needed. Not for browsers.
 */
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const accounts = await purgeDueAccounts();
  let frames: { removed: number; failed: number } | { error: string };
  try {
    frames = await cleanupOldFrames();
  } catch (err) {
    console.error("[account/purge] frame cleanup failed:", err);
    frames = { error: "frame cleanup failed" };
  }
  let rateLimits: number | null = null;
  try {
    rateLimits = await purgeExpiredLimits();
  } catch (err) {
    console.error("[account/purge] rate-limit cleanup failed:", err);
  }
  return NextResponse.json({ ...accounts, frames, rateLimitsCleared: rateLimits });
}

export const GET = run;
export const POST = run;
