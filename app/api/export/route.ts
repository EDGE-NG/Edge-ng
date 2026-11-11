import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

/**
 * GET -> full export of the signed-in user's data as JSON
 * (privacy: account controls — PRD 4.8).
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const all = (sql: string, ...args: Array<string | number | null>) =>
    db.prepare(sql).all(...args) as Array<Record<string, unknown>>;

  const data = {
    exported_at: new Date().toISOString(),
    profile: {
      email: user.email,
      name: user.name,
      timezone: user.timezone,
      created_at: user.created_at,
    },
    edges: all("SELECT * FROM edges WHERE user_id = ?", user.id),
    edge_versions: all(
      `SELECT v.* FROM edge_versions v JOIN edges e ON e.id = v.edge_id WHERE e.user_id = ?`,
      user.id
    ),
    checklist_items: all(
      `SELECT ci.* FROM checklist_items ci
       JOIN edge_versions v ON v.id = ci.version_id
       JOIN edges e ON e.id = v.edge_id WHERE e.user_id = ?`,
      user.id
    ),
    visual_references: all(
      `SELECT vr.* FROM visual_references vr
       JOIN checklist_items ci ON ci.id = vr.item_id
       JOIN edge_versions v ON v.id = ci.version_id
       JOIN edges e ON e.id = v.edge_id WHERE e.user_id = ?`,
      user.id
    ),
    trade_reviews: all("SELECT * FROM trade_reviews WHERE user_id = ?", user.id),
    review_evidence: all(
      `SELECT re.* FROM review_evidence re
       JOIN trade_reviews tr ON tr.id = re.review_id WHERE tr.user_id = ?`,
      user.id
    ),
    review_results: all(
      `SELECT rr.* FROM review_results rr
       JOIN trade_reviews tr ON tr.id = rr.review_id WHERE tr.user_id = ?`,
      user.id
    ),
    trades: all("SELECT * FROM trades WHERE user_id = ?", user.id),
    journal_entries: all("SELECT * FROM journal_entries WHERE user_id = ?", user.id),
  };

  const res = NextResponse.json(data);
  res.headers.set(
    "Content-Disposition",
    `attachment; filename="edge-export-${new Date().toISOString().slice(0, 10)}.json"`
  );
  return res;
}
