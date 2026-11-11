import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";


interface Params {
  params: Promise<{ id: string }>;
}

/** GET full edge with all versions and items */
export async function GET(_req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const edge = db
    .prepare(
      "SELECT id, name, description, active_version_id, created_at, updated_at FROM edges WHERE id = ? AND user_id = ?"
    )
    .get(id, user.id) as Record<string, unknown> | undefined;
  if (!edge) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

  const versions = db
    .prepare(
      "SELECT id, version_number, status, source_text, created_at, approved_at FROM edge_versions WHERE edge_id = ? ORDER BY version_number DESC"
    )
    .all(id) as Array<Record<string, unknown>>;

  for (const v of versions) {
    v.items = db
      .prepare(
        "SELECT id, category, text, hard_gate, position, notes FROM checklist_items WHERE version_id = ? ORDER BY position"
      )
      .all(v.id as string);
  }

  return NextResponse.json({ edge, versions });
}

/** PATCH update edge metadata or items of a draft version */
export async function PATCH(req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const edge = db
    .prepare("SELECT id, active_version_id FROM edges WHERE id = ? AND user_id = ?")
    .get(id, user.id) as { id: string; active_version_id: string | null } | undefined;
  if (!edge) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

  if (typeof body.name === "string" && body.name.trim()) {
    db.prepare("UPDATE edges SET name = ?, updated_at = ? WHERE id = ?").run(
      body.name.trim(),
      now(),
      id
    );
  }
  if (typeof body.description === "string") {
    db.prepare("UPDATE edges SET description = ?, updated_at = ? WHERE id = ?").run(
      body.description.trim(),
      now(),
      id
    );
  }

  // Spawn a fresh draft copy of the active approved version when the user asks
  // to update a checklist that has no open draft (e.g. after discarding one).
  if (body.spawnDraft === true) {
    const existing = db
      .prepare("SELECT id FROM edge_versions WHERE edge_id = ? AND status = 'draft'")
      .get(id) as { id: string } | undefined;
    if (existing) return NextResponse.json({ ok: true, versionId: existing.id });

    const active = db
      .prepare(
        `SELECT id, version_number, source_text FROM edge_versions
         WHERE edge_id = ? AND status = 'approved'
         ORDER BY version_number DESC LIMIT 1`
      )
      .get(id) as
      | { id: string; version_number: number; source_text: string | null }
      | undefined;
    if (!active) {
      return NextResponse.json(
        { error: "No approved checklist to copy yet — edit the current draft instead." },
        { status: 409 }
      );
    }

    const nextId = uuid();
    const ts = now();
    const copied = db
      .prepare(
        "SELECT category, text, hard_gate, position, notes FROM checklist_items WHERE version_id = ? ORDER BY position"
      )
      .all(active.id) as Array<{
      category: string;
      text: string;
      hard_gate: number;
      position: number;
      notes: string | null;
    }>;
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO edge_versions (id, edge_id, version_number, status, source_text, created_at)
         VALUES (?, ?, ?, 'draft', ?, ?)`
      ).run(nextId, id, active.version_number + 1, active.source_text, ts);
      const insert = db.prepare(
        `INSERT INTO checklist_items (id, version_id, category, text, hard_gate, position, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of copied) {
        insert.run(uuid(), nextId, item.category, item.text, item.hard_gate, item.position, item.notes);
      }
      db.prepare("UPDATE edges SET updated_at = ? WHERE id = ?").run(ts, id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return NextResponse.json({ ok: true, versionId: nextId });
  }

  // Item edits apply to a draft version only (approved versions are immutable)
  if (body.versionId && Array.isArray(body.items)) {
    const version = db
      .prepare("SELECT id, status, edge_id FROM edge_versions WHERE id = ? AND edge_id = ?")
      .get(body.versionId, id) as { id: string; status: string } | undefined;
    if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    if (version.status === "approved") {
      return NextResponse.json(
        { error: "Approved versions are immutable. Create a new version to edit." },
        { status: 409 }
      );
    }

    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM checklist_items WHERE version_id = ?").run(version.id);
      const insert = db.prepare(
        `INSERT INTO checklist_items (id, version_id, category, text, hard_gate, position, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      body.items.forEach(
        (
          item: { category?: string; text?: string; hard_gate?: boolean; notes?: string },
          i: number
        ) => {
          if (!item?.text?.trim()) return;
          insert.run(
            crypto.randomUUID(),
            version.id,
            item.category || "note",
            item.text.trim(),
            item.hard_gate ? 1 : 0,
            i,
            item.notes ?? null
          );
        }
      );
      db.prepare("UPDATE edges SET updated_at = ? WHERE id = ?").run(now(), id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    // Return the saved rows: item ids change on every save (delete + reinsert),
    // and downstream flows (approve → image evidence) need the current ids.
    return NextResponse.json({
      ok: true,
      items: db
        .prepare(
          "SELECT id, category, text, hard_gate, position, notes FROM checklist_items WHERE version_id = ? ORDER BY position"
        )
        .all(body.versionId),
    });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE an edge (with its versions, checklists and image evidence), or a
 * single draft checklist via ?versionId= when it is no longer wanted.
 */
export async function DELETE(req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const versionId = new URL(req.url).searchParams.get("versionId");

  const edge = db
    .prepare("SELECT id, active_version_id FROM edges WHERE id = ? AND user_id = ?")
    .get(id, user.id) as { id: string; active_version_id: string | null } | undefined;
  if (!edge) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

  if (versionId) {
    const version = db
      .prepare("SELECT id, status FROM edge_versions WHERE id = ? AND edge_id = ?")
      .get(versionId, id) as { id: string; status: string } | undefined;
    if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    if (version.status !== "draft" || version.id === edge.active_version_id) {
      return NextResponse.json(
        { error: "Only drafts that are not active can be discarded." },
        { status: 409 }
      );
    }
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM edge_versions WHERE edge_id = ?")
      .get(id) as { n: number };
    if (count.n <= 1) {
      return NextResponse.json(
        { error: "This is the only checklist — delete the edge instead." },
        { status: 409 }
      );
    }
    // cascades to checklist_items → visual_references
    db.prepare("DELETE FROM edge_versions WHERE id = ?").run(versionId);
    db.prepare("UPDATE edges SET updated_at = ? WHERE id = ?").run(now(), id);
    return NextResponse.json({ ok: true });
  }

  // trade_reviews references edge_versions without a cascade, so clear the
  // review history first (evidence/results cascade; trades/journal keep the
  // review id nullified) before the edge tree goes away.
  db.exec("BEGIN");
  try {
    db.prepare(
      `DELETE FROM trade_reviews
       WHERE edge_version_id IN (SELECT id FROM edge_versions WHERE edge_id = ?)`
    ).run(id);
    const res = db.prepare("DELETE FROM edges WHERE id = ? AND user_id = ?").run(id, user.id);
    db.exec("COMMIT");
    if (res.changes === 0) {
      return NextResponse.json({ error: "Edge not found" }, { status: 404 });
    }
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return NextResponse.json({ ok: true });
}
