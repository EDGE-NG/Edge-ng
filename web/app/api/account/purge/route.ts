import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { purgeDueAccounts } from "@/lib/account-deletion";
import { purgeOldAuditLog } from "@/lib/audit-retention";
import { cleanupOldFrames } from "@/lib/frame-cleanup";

/**
 * The daily account purge (PRD F13). A scheduler (cron-job.org, like the
 * alerts) calls this once a day with `Authorization: Bearer <CRON_SECRET>`.
 * It deletes every account whose 14-day grace period has ended: files first,
 * then the account and all its data. It also deletes old chart pictures
 * (lib/frame-cleanup.ts) and audit log rows older than 24 months
 * (lib/audit-retention.ts), so no second scheduler job is needed. Not for browsers.
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
  let auditRowsDeleted: number | null = null;
  try {
    auditRowsDeleted = await purgeOldAuditLog();
  } catch (err) {
    console.error("[account/purge] audit log cleanup failed:", err);
  }
  return NextResponse.json({ ...accounts, frames, auditRowsDeleted });
}

export const GET = run;
export const POST = run;
