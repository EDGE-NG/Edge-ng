/**
 * Chart frame cleanup (storage cost control, PRD 5.7; decision by Sheyi,
 * 2026-11-27).
 *
 * Every chart check saves a PNG of the trader's chart in the private `frames`
 * bucket. Most are never used by a Buy / Sell decision, and the free Supabase
 * plan has 1 GB of storage, so the daily job (/api/account/purge) deletes:
 *
 * - pictures no gate decision used, once they are UNUSED_FRAME_DAYS old;
 * - every picture, once it is DECISION_FRAME_DAYS old.
 *
 * Only the picture goes. The chart_frames row stays, with its candles, so
 * rule checks (append-only) and decision snapshots still point at a frame and
 * still show what Edge saw; object_key is set to NULL once the file is gone.
 */
import { db } from "./db";
import { removeObjects } from "./supabase";

export const UNUSED_FRAME_DAYS = 7;
export const DECISION_FRAME_DAYS = 90;

/** Storage accepts at most this many keys per remove call. */
const REMOVE_CHUNK = 100;

interface FrameRow {
  id: string;
  user_id: string;
  object_key: string;
}

/**
 * True only for a key inside the trader's own folder (`<userId>/<file>`), so a
 * bad row can never make the job delete another trader's file.
 */
export function ownsKey(userId: string, key: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return false;
  const prefix = `${userId}/`;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/") && !rest.includes("..");
}

/** Frames whose picture is due for deletion, oldest first. */
async function dueFrames(limit: number): Promise<FrameRow[]> {
  // A frame counts as used when a decision snapshot of the same session holds
  // a rule check made on it (snapshot.rules[].check.frameId, REQ-GT-5).
  return db.all<FrameRow>(
    `SELECT f.id, f.user_id, f.object_key
     FROM chart_frames f
     WHERE f.object_key IS NOT NULL
       AND (
         f.captured_at < now() - make_interval(days => ?)
         OR (
           f.captured_at < now() - make_interval(days => ?)
           AND NOT EXISTS (
             SELECT 1
             FROM trade_intents i
             JOIN gate_decisions g ON g.intent_id = i.id AND g.user_id = i.user_id
             WHERE i.session_id = f.session_id
               AND i.user_id = f.user_id
               AND jsonb_path_exists(g.snapshot, '$.rules[*].check.frameId ? (@ == $id)', jsonb_build_object('id', f.id::text))
           )
         )
       )
     ORDER BY f.captured_at
     LIMIT ?`,
    DECISION_FRAME_DAYS,
    UNUSED_FRAME_DAYS,
    limit
  );
}

/**
 * Delete the pictures that are due, up to `limit` per run (the next daily run
 * carries on). One failed batch doesn't stop the rest; its frames keep their
 * key and are tried again tomorrow.
 */
export async function cleanupOldFrames(limit = 2000): Promise<{ removed: number; failed: number }> {
  const rows = await dueFrames(limit);
  let removed = 0;
  let failed = 0;

  // never touch a key outside its owner's folder; just forget it
  const bad = rows.filter((r) => !ownsKey(r.user_id, r.object_key));
  const good = rows.filter((r) => ownsKey(r.user_id, r.object_key));
  if (bad.length) {
    console.error(`[frame-cleanup] ${bad.length} frame(s) with an unexpected file key; not deleting those files`);
    failed += bad.length;
  }

  for (let i = 0; i < good.length; i += REMOVE_CHUNK) {
    const batch = good.slice(i, i + REMOVE_CHUNK);
    try {
      // files first: if this fails, the rows keep their key and the next run retries
      await removeObjects("frames", batch.map((r) => r.object_key));
      await db.run(
        `UPDATE chart_frames f SET object_key = NULL
         FROM unnest(?::uuid[], ?::uuid[]) AS x(id, user_id)
         WHERE f.id = x.id AND f.user_id = x.user_id`,
        batch.map((r) => r.id),
        batch.map((r) => r.user_id)
      );
      removed += batch.length;
    } catch (err) {
      failed += batch.length;
      console.error("[frame-cleanup] batch failed:", err);
    }
  }
  return { removed, failed };
}
