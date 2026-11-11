import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";


/**
 * POST approve a draft version → it becomes the active, immutable version.
 * A fresh draft copy (v+1) is created for future edits so historical reviews
 * keep the rules that were active at their time (PRD 4.2).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const draftVersionId: string | undefined = body?.versionId;
  if (!draftVersionId) {
    return NextResponse.json({ error: "versionId required" }, { status: 400 });
  }

  const edge = db
    .prepare("SELECT id FROM edges WHERE id = ? AND user_id = ?")
    .get(id, user.id) as { id: string } | undefined;
  if (!edge) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

  const draft = db
    .prepare("SELECT id, status, version_number FROM edge_versions WHERE id = ? AND edge_id = ?")
    .get(draftVersionId, id) as
    | { id: string; status: string; version_number: number }
    | undefined;
  if (!draft) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  if (draft.status === "approved") {
    return NextResponse.json({ error: "Version already approved" }, { status: 409 });
  }

  const items = db
    .prepare(
      "SELECT id, category, text, hard_gate, position, notes FROM checklist_items WHERE version_id = ? ORDER BY position"
    )
    .all(draft.id) as Array<{
    category: string;
    text: string;
    hard_gate: number;
    position: number;
    notes: string | null;
  }>;
  if (items.length === 0) {
    return NextResponse.json(
      { error: "Add at least one rule before approving" },
      { status: 422 }
    );
  }

  const ts = now();
  const nextId = uuid();
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE edge_versions SET status = 'approved', approved_at = ? WHERE id = ?"
    ).run(ts, draft.id);
    db.prepare("UPDATE edges SET active_version_id = ?, updated_at = ? WHERE id = ?").run(
      draft.id,
      ts,
      id
    );

    // spawn next draft with the same items
    db.prepare(
      `INSERT INTO edge_versions (id, edge_id, version_number, status, source_text, created_at)
       SELECT ?, edge_id, ?, 'draft', source_text, ? FROM edge_versions WHERE id = ?`
    ).run(nextId, draft.version_number + 1, ts, draft.id);

    const insert = db.prepare(
      `INSERT INTO checklist_items (id, version_id, category, text, hard_gate, position, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of items) {
      insert.run(
        uuid(),
        nextId,
        item.category,
        item.text,
        item.hard_gate,
        item.position,
        item.notes
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ ok: true, activeVersionId: draft.id, nextDraftVersionId: nextId });
}
