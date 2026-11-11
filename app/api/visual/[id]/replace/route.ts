import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { interpretExample, refJson } from "@/lib/visual";

export const maxDuration = 120;

/**
 * POST replace a reference's image (PRD 4.3 "replacement + version history"):
 * the old row is kept with status 'replaced' pointing at its successor; the new
 * row starts over at 'pending' with a fresh AI interpretation.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const old = db
    .prepare(
      `SELECT vi.*, ci.text AS rule_text
       FROM visual_references vi
       JOIN checklist_items ci ON ci.id = vi.item_id
       JOIN edge_versions ev ON ev.id = ci.version_id
       JOIN edges e ON e.id = ev.edge_id
       WHERE vi.id = ? AND e.user_id = ?`
    )
    .get(id, user.id) as Record<string, unknown> | undefined;
  if (!old) return NextResponse.json({ error: "Reference not found" }, { status: 404 });
  if (old.approval_status === "replaced") {
    return NextResponse.json({ error: "Reference was already replaced" }, { status: 409 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 413 });
  }

  const polarity =
    form.get("polarity") === "negative"
      ? "negative"
      : form.get("polarity") === "positive"
        ? "positive"
        : String(old.polarity);
  const explanation =
    typeof form.get("explanation") === "string" && String(form.get("explanation")).trim()
      ? String(form.get("explanation")).trim()
      : String(old.explanation ?? "");
  if (!explanation) {
    return NextResponse.json(
      { error: "Explain why this example is valid or invalid" },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const image = `data:${file.type || "image/png"};base64,${buf.toString("base64")}`;

  const newId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO visual_references (id, item_id, image_key, polarity, explanation, approval_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    ).run(newId, String(old.item_id), image, polarity, explanation, ts);
    db.prepare(
      `UPDATE visual_references SET approval_status = 'replaced', superseded_by = ?, replaced_at = ?
       WHERE id = ?`
    ).run(newId, ts, id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  let aiInterpretation: string | null = null;
  let aiError: string | null = null;
  try {
    aiInterpretation = await interpretExample(
      String(old.rule_text),
      polarity,
      explanation,
      image,
      user.id
    );
    db.prepare("UPDATE visual_references SET ai_interpretation = ? WHERE id = ?").run(
      aiInterpretation,
      newId
    );
  } catch (err) {
    aiError = err instanceof Error ? err.message : "Interpretation failed";
  }

  const row = db.prepare("SELECT * FROM visual_references WHERE id = ?").get(newId) as Record<
    string,
    unknown
  >;
  return NextResponse.json({ ref: refJson(row), replaced: id, ai_error: aiError }, { status: 201 });
}
