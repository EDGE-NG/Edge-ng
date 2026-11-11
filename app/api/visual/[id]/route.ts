import { NextResponse } from "next/server";
import { db, now } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { interpretExample, refJson } from "@/lib/visual";

export const maxDuration = 120;

type Body = {
  action?: string;
  interpretation?: string;
};

/**
 * PATCH the trader's response to an AI interpretation (PRD 4.3 confirmation step):
 *  - confirm: accept the AI interpretation as-is
 *  - correct: accept, but store the trader's own wording (their correction wins)
 *  - reinterpret: re-run the AI (interpretation changed → confirmation resets)
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;

  const ref = db
    .prepare(
      `SELECT vi.*, ci.text AS rule_text, ci.id AS item_check
       FROM visual_references vi
       JOIN checklist_items ci ON ci.id = vi.item_id
       JOIN edge_versions ev ON ev.id = ci.version_id
       JOIN edges e ON e.id = ev.edge_id
       WHERE vi.id = ? AND e.user_id = ?`
    )
    .get(id, user.id) as Record<string, unknown> | undefined;
  if (!ref) return NextResponse.json({ error: "Reference not found" }, { status: 404 });
  if (ref.approval_status === "replaced") {
    return NextResponse.json({ error: "Reference was replaced" }, { status: 409 });
  }

  if (body.action === "confirm") {
    if (!ref.ai_interpretation) {
      return NextResponse.json({ error: "No AI interpretation to confirm" }, { status: 422 });
    }
    db.prepare(
      `UPDATE visual_references
       SET approval_status = 'approved', confirmed_interpretation = ?, confirmed_at = ?
       WHERE id = ?`
    ).run(String(ref.ai_interpretation), now(), id);
  } else if (body.action === "correct") {
    const correction = String(body.interpretation ?? "").trim();
    if (!correction) {
      return NextResponse.json({ error: "interpretation required" }, { status: 400 });
    }
    db.prepare(
      `UPDATE visual_references
       SET approval_status = 'approved', confirmed_interpretation = ?, confirmed_at = ?
       WHERE id = ?`
    ).run(correction, now(), id);
  } else if (body.action === "reinterpret") {
    try {
      const interpretation = await interpretExample(
        String(ref.rule_text),
        String(ref.polarity),
        String(ref.explanation ?? ""),
        String(ref.image_key),
        user.id
      );
      db.prepare(
        `UPDATE visual_references
         SET ai_interpretation = ?, confirmed_interpretation = NULL, confirmed_at = NULL,
             approval_status = 'pending'
         WHERE id = ?`
      ).run(interpretation, id);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Interpretation failed" },
        { status: 502 }
      );
    }
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const updated = db.prepare("SELECT * FROM visual_references WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;
  return NextResponse.json({ ref: refJson(updated) });
}

/** DELETE remove a reference outright (replacement history is kept on the old rows). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const ref = db
    .prepare(
      `SELECT vi.id FROM visual_references vi
       JOIN checklist_items ci ON ci.id = vi.item_id
       JOIN edge_versions ev ON ev.id = ci.version_id
       JOIN edges e ON e.id = ev.edge_id
       WHERE vi.id = ? AND e.user_id = ?`
    )
    .get(id, user.id) as { id: string } | undefined;
  if (!ref) return NextResponse.json({ error: "Reference not found" }, { status: 404 });
  db.prepare("DELETE FROM visual_references WHERE id = ?").run(id);
  return NextResponse.json({ deleted: true });
}
