import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";


/** POST record a trade manually (V1 has no broker connectivity) */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const instrument = typeof body.instrument === "string" ? body.instrument.trim() : "";
  if (!instrument) return NextResponse.json({ error: "instrument required" }, { status: 400 });

  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };

  let reviewId: string | null = null;
  if (body.reviewId) {
    const review = db
      .prepare("SELECT id FROM trade_reviews WHERE id = ? AND user_id = ?")
      .get(body.reviewId, user.id) as { id: string } | undefined;
    if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
    reviewId = review.id;
  }

  const tradeId = uuid();
  db.prepare(
    `INSERT INTO trades (id, user_id, review_id, instrument, direction, entry_price, exit_price, opened_at, closed_at, pnl, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tradeId,
    user.id,
    reviewId,
    instrument,
    body.direction === "short" ? "short" : "long",
    num(body.entryPrice),
    num(body.exitPrice),
    typeof body.openedAt === "string" ? body.openedAt : null,
    typeof body.closedAt === "string" ? body.closedAt : null,
    num(body.pnl),
    typeof body.notes === "string" ? body.notes : null,
    now()
  );

  return NextResponse.json({ tradeId });
}

/** GET recent trades */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const trades = db
    .prepare(
      `SELECT t.*, r.overall AS review_overall, r.instrument AS review_instrument,
              (SELECT COUNT(*) FROM journal_entries je WHERE je.trade_id = t.id) AS journal_count
       FROM trades t
       LEFT JOIN trade_reviews r ON r.id = t.review_id
       WHERE t.user_id = ?
       ORDER BY t.created_at DESC
       LIMIT 100`
    )
    .all(user.id) as Array<Record<string, unknown>>;
  return NextResponse.json({ trades });
}
