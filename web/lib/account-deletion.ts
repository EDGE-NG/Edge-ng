/**
 * Account deletion with a grace period (PRD F13; decision by Daniel, PR #18).
 *
 * - scheduleDeletion: the trader confirms "delete my account". Nothing is
 *   deleted yet: profiles.deletion_due_at is set GRACE_DAYS ahead.
 * - cancelScheduledDeletion: the trader signs in again before that date, so
 *   the deletion is cancelled.
 * - purgeDueAccounts: the daily job (/api/account/purge) deletes every account
 *   whose date has passed: its files first (Storage), then the auth user,
 *   which cascades to all their data in Postgres. A short record (email and
 *   date) stays in audit_log, as the Privacy Policy says.
 *
 * Migration: supabase/migrations/0004_account_deletion_grace.sql.
 */
import { db, uuid } from "./db";
import { adminClient, removeUserFolder, USER_BUCKETS } from "./supabase";

export const GRACE_DAYS = 14;

async function audit(userId: string, action: string, metadata: Record<string, unknown>, actor: "trader" | "system") {
  await db.run(
    `INSERT INTO audit_log (id, actor_user_id, actor_type, action, object_type, object_id, metadata)
     VALUES (?, ?, ?, ?, 'user', ?, ?)`,
    uuid(),
    userId,
    actor,
    action,
    userId,
    metadata
  );
}

/** Mark the account for deletion GRACE_DAYS from now. Returns the date it will be deleted (ISO). */
export async function scheduleDeletion(userId: string, email: string | null): Promise<string> {
  const row = (await db.one<{ due: string }>(
    `UPDATE profiles SET deletion_due_at = now() + make_interval(days => ?), updated_at = now()
     WHERE user_id = ? RETURNING deletion_due_at AS due`,
    GRACE_DAYS,
    userId
  ))!;
  await audit(userId, "account.deletion_scheduled", { email, dueAt: row.due }, "trader");
  return row.due;
}

/**
 * Called after every successful sign-in. If the account was waiting to be
 * deleted, cancel that and return true (so the page can say so).
 */
export async function cancelScheduledDeletion(userId: string): Promise<boolean> {
  const row = await db.one<{ user_id: string }>(
    `UPDATE profiles SET deletion_due_at = NULL, updated_at = now()
     WHERE user_id = ? AND deletion_due_at IS NOT NULL RETURNING user_id`,
    userId
  );
  if (!row) return false;
  await audit(userId, "account.deletion_cancelled", {}, "trader");
  return true;
}

/**
 * Delete one account now: files first, then the auth user (cascades to all
 * Postgres data). Throws on any failure, leaving the account in place so the
 * next run can try again; files are never left behind without an owner.
 */
export async function purgeAccount(userId: string): Promise<void> {
  for (const bucket of USER_BUCKETS) await removeUserFolder(bucket, userId);
  const admin = adminClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`auth delete failed: ${error.message}`);
  // recorded only once the account is really gone (audit_log has no foreign key)
  await audit(userId, "account.deleted", { email: data?.user?.email ?? null, deletedAt: new Date().toISOString() }, "system");
}

/** The daily job: delete accounts whose grace period has ended. One failure doesn't stop the rest. */
export async function purgeDueAccounts(limit = 25): Promise<{ deleted: number; failed: number }> {
  const due = await db.all<{ user_id: string }>(
    `SELECT user_id FROM profiles WHERE deletion_due_at IS NOT NULL AND deletion_due_at <= now()
     ORDER BY deletion_due_at LIMIT ?`,
    limit
  );
  let deleted = 0;
  let failed = 0;
  for (const { user_id } of due) {
    try {
      await purgeAccount(user_id);
      deleted++;
    } catch (err) {
      failed++;
      console.error(`[account-deletion] purge failed for ${user_id}:`, err);
    }
  }
  return { deleted, failed };
}
