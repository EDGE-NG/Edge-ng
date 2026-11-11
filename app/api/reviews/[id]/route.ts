import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";


/** GET full review: checklist version, evidence, per-rule results */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const review = db
    .prepare(
      `SELECT r.*, v.version_number, e.name AS edge_name
       FROM trade_reviews r
       JOIN edge_versions v ON v.id = r.edge_version_id
       JOIN edges e ON e.id = v.edge_id
       WHERE r.id = ? AND r.user_id = ?`
    )
    .get(id, user.id) as Record<string, unknown> | undefined;
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const items = db
    .prepare(
      "SELECT id, category, text, hard_gate FROM checklist_items WHERE version_id = ? ORDER BY position"
    )
    .all(review.edge_version_id as string) as Array<Record<string, unknown>>;

  const results = db
    .prepare(
      "SELECT item_id, verdict, evidence, explanation FROM review_results WHERE review_id = ?"
    )
    .all(id) as Array<Record<string, unknown>>;

  const evidence = db
    .prepare(
      "SELECT id, kind, timeframe, provenance, created_at, CASE WHEN kind = 'image' THEN length(payload) ELSE length(payload) END AS size FROM review_evidence WHERE review_id = ? ORDER BY created_at"
    )
    .all(id) as Array<Record<string, unknown>>;

  const trade = db
    .prepare("SELECT id, instrument, direction, pnl, status, created_at FROM trades WHERE review_id = ?")
    .get(id) as Record<string, unknown> | undefined;

  return NextResponse.json({ review, items, results, evidence, trade: trade ?? null });
}
