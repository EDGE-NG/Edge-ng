import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";


/** GET list of reviews (for linking trades and pickers) */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const reviews = db
    .prepare(
      `SELECT r.id, r.instrument, r.direction, r.overall, r.status, r.created_at, r.completed_at,
              r.overridden_at, e.name AS edge_name
       FROM trade_reviews r
       JOIN edge_versions v ON v.id = r.edge_version_id
       JOIN edges e ON e.id = v.edge_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC
       LIMIT 100`
    )
    .all(user.id) as Array<Record<string, unknown>>;
  return NextResponse.json({ reviews });
}
