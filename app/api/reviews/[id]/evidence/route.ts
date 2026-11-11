import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";


/**
 * POST add evidence to a review.
 * Two kinds:
 *  - "note": plain text context (timeframe observations, what the trader sees)
 *  - "image": screenshot capture, stored as a data URL (PRD capture fallback)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const review = db
    .prepare("SELECT id, status FROM trade_reviews WHERE id = ? AND user_id = ?")
    .get(id, user.id) as { id: string; status: string } | undefined;
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  if (review.status === "completed") {
    return NextResponse.json({ error: "Review already completed" }, { status: 409 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });

  const kind = form.get("kind") === "image" ? "image" : "note";
  const timeframe = typeof form.get("timeframe") === "string" ? (form.get("timeframe") as string) : null;
  const provenance = typeof form.get("provenance") === "string" ? (form.get("provenance") as string) : "user";

  let payload = "";
  if (kind === "image") {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required for image evidence" }, { status: 400 });
    }
    if (file.size > 4 * 1024 * 1024) {
      return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 413 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "image/png";
    payload = `data:${mime};base64,${buf.toString("base64")}`;
  } else {
    payload = String(form.get("text") ?? "").trim();
    if (!payload) return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const evidenceId = uuid();
  db.prepare(
    `INSERT INTO review_evidence (id, review_id, kind, payload, timeframe, provenance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(evidenceId, id, kind, payload, timeframe, provenance, now());

  const count = (
    db.prepare("SELECT COUNT(*) AS c FROM review_evidence WHERE review_id = ?").get(id) as {
      c: number;
    }
  ).c;

  return NextResponse.json({ evidenceId, evidenceCount: count });
}
