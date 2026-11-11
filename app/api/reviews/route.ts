import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";


/** POST create a new pre-trade review session */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const edgeId = body?.edgeId;
  const instrument = typeof body?.instrument === "string" ? body.instrument.trim() : "";
  const direction = body?.direction === "short" ? "short" : "long";
  const context = body?.context && typeof body.context === "object" ? body.context : {};

  if (!edgeId || !instrument) {
    return NextResponse.json({ error: "edgeId and instrument are required" }, { status: 400 });
  }

  const edge = db
    .prepare(
      "SELECT id, active_version_id FROM edges WHERE id = ? AND user_id = ?"
    )
    .get(edgeId, user.id) as { id: string; active_version_id: string | null } | undefined;
  if (!edge) return NextResponse.json({ error: "Edge not found" }, { status: 404 });
  if (!edge.active_version_id) {
    return NextResponse.json(
      { error: "Approve a checklist before running a review." },
      { status: 422 }
    );
  }

  const reviewId = uuid();
  db.prepare(
    `INSERT INTO trade_reviews (id, user_id, edge_version_id, instrument, direction, context_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`
  ).run(reviewId, user.id, edge.active_version_id, instrument, direction, JSON.stringify(context), now());

  return NextResponse.json({ reviewId });
}
