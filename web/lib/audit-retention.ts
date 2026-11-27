/**
 * Audit log retention: rows are kept 24 months, then deleted by the daily job
 * (/api/account/purge). The rule itself lives in the database
 * (migration 0006_audit_log_retention.sql): the log stays append-only, and
 * only rows past 24 months can be deleted, only through purge_old_audit_log().
 */
import { db } from "./db";

/** Delete audit rows older than 24 months, up to `limit` per run. Returns how many. */
export async function purgeOldAuditLog(limit = 5000): Promise<number> {
  const row = await db.one<{ n: number }>("SELECT public.purge_old_audit_log(?) AS n", limit);
  return row?.n ?? 0;
}
