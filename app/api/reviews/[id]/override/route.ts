import { NextResponse } from "next/server";
import { db, now } from "@/lib/db";
import { getUser } from "@/lib/auth";


/**
 * POST record an override: the trader proceeds despite a Fail/Inconclusive result.
 * Never blocks (PRD 4.6) — just records reason + timestamp. No judgment in copy.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : null;

  const review = db
    .prepare("SELECT id, status FROM trade_reviews WHERE id = ? AND user_id = ?")
    .get(id, user.id) as { id: string; status: string } | undefined;
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  if (review.status !== "completed") {
    return NextResponse.json({ error: "Run the review first" }, { status: 409 });
  }

  db.prepare(
    "UPDATE trade_reviews SET override_reason = ?, overridden_at = ? WHERE id = ?"
  ).run(reason, now(), id);

  return NextResponse.json({ ok: true, recorded: true });
}
