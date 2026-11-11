import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { interpretExample, refJson } from "@/lib/visual";

export const maxDuration = 120;

type RefRow = {
  id: string;
  item_id: string;
  image_key: string;
  polarity: string;
  explanation: string | null;
  ai_interpretation: string | null;
  confirmed_interpretation: string | null;
  confirmed_at: string | null;
  approval_status: string;
  superseded_by: string | null;
  replaced_at: string | null;
  created_at: string;
};

/** Validate that a checklist item belongs to the caller. */
function ownedItem(itemId: string, userId: string) {
  return db
    .prepare(
      `SELECT ci.id, ci.category, ci.text, ci.hard_gate, ci.notes, ci.position, ci.version_id,
              ev.version_number, e.id AS edge_id, e.name AS edge_name
       FROM checklist_items ci
       JOIN edge_versions ev ON ev.id = ci.version_id
       JOIN edges e ON e.id = ev.edge_id
       WHERE ci.id = ? AND e.user_id = ?`
    )
    .get(itemId, userId) as Record<string, unknown> | undefined;
}

/**
 * GET the Visual Library.
 *  - default: every edge's active approved checklist with its references (PRD 4.3 index)
 *  - ?itemId=: one checklist item with active refs + replacement history (detail page)
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const itemId = new URL(req.url).searchParams.get("itemId");

  if (itemId) {
    const item = ownedItem(itemId, user.id);
    if (!item) return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
    const refs = db
      .prepare(
        `SELECT * FROM visual_references WHERE item_id = ?
         ORDER BY (approval_status = 'replaced'), created_at DESC`
      )
      .all(itemId) as RefRow[];
    return NextResponse.json({
      item: {
        id: item.id,
        category: item.category,
        text: item.text,
        hard_gate: item.hard_gate,
        notes: item.notes,
        version_id: item.version_id,
        version_number: item.version_number,
        edge_id: item.edge_id,
        edge_name: item.edge_name,
      },
      refs: refs.filter((r) => r.approval_status !== "replaced").map(refJson),
      history: refs.filter((r) => r.approval_status === "replaced").map(refJson),
    });
  }

  const edges = db
    .prepare(
      `SELECT e.id, e.name, ev.id AS version_id, ev.version_number
       FROM edges e
       JOIN edge_versions ev ON ev.id = e.active_version_id
       WHERE e.user_id = ?
       ORDER BY e.created_at DESC`
    )
    .all(user.id) as Array<{ id: string; name: string; version_id: string; version_number: number }>;

  const result = [];
  for (const edge of edges) {
    const items = db
      .prepare(
        "SELECT id, category, text, hard_gate, position FROM checklist_items WHERE version_id = ? ORDER BY position"
      )
      .all(edge.version_id) as Array<{
      id: string;
      category: string;
      text: string;
      hard_gate: number;
      position: number;
    }>;
    const refs = items.length
      ? (db
          .prepare(
            `SELECT * FROM visual_references WHERE item_id IN (${items.map(() => "?").join(",")})`
          )
          .all(...items.map((i) => i.id)) as RefRow[])
      : [];
    result.push({
      ...edge,
      items: items.map((i) => {
        const mine = refs.filter((r) => r.item_id === i.id);
        return {
          ...i,
          refs: mine.filter((r) => r.approval_status !== "replaced").map(refJson),
          replaced_count: mine.filter((r) => r.approval_status === "replaced").length,
        };
      }),
    });
  }
  return NextResponse.json({ edges: result });
}

/**
 * POST attach a chart example to a checklist item, then run the AI
 * interpretation (rule → screenshot → explanation → AI interpretation; the
 * trader confirms in a later PATCH).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });

  const itemId = String(form.get("itemId") ?? "");
  const polarity = form.get("polarity") === "negative" ? "negative" : "positive";
  const explanation = String(form.get("explanation") ?? "").trim();
  const file = form.get("file");

  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
  if (!explanation) {
    return NextResponse.json(
      { error: "Explain why this example is valid or invalid" },
      { status: 400 }
    );
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 413 });
  }

  const item = ownedItem(itemId, user.id);
  if (!item) return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  const image = `data:${file.type || "image/png"};base64,${buf.toString("base64")}`;

  const refId = uuid();
  db.prepare(
    `INSERT INTO visual_references (id, item_id, image_key, polarity, explanation, approval_status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).run(refId, itemId, image, polarity, explanation, now());

  // AI interpretation: failure must not lose the upload — surface for retry
  let aiInterpretation: string | null = null;
  let aiError: string | null = null;
  try {
    aiInterpretation = await interpretExample(
      String(item.text),
      polarity,
      explanation,
      image,
      user.id
    );
    db.prepare("UPDATE visual_references SET ai_interpretation = ? WHERE id = ?").run(
      aiInterpretation,
      refId
    );
  } catch (err) {
    aiError = err instanceof Error ? err.message : "Interpretation failed";
  }

  const row = db.prepare("SELECT * FROM visual_references WHERE id = ?").get(refId) as RefRow;
  return NextResponse.json({ ref: refJson(row), ai_error: aiError }, { status: 201 });
}
