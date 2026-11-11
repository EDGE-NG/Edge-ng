import { NextResponse } from "next/server";
import { db, now } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { chatJson } from "@/lib/ai";


interface Params {
  params: Promise<{ id: string }>;
}

interface ReviseResponse {
  clarifying_questions?: string[];
  items?: Array<{
    category: string;
    text: string;
    // The AI may emit a string ("false" is truthy in JS — coerce explicitly)
    hard_gate?: boolean | string;
    notes?: string;
  }>;
}

/** Coerce an AI-provided hard_gate to 0/1 — never trust bare truthiness. */
function hardGateFlag(v: boolean | string | undefined): number {
  return v === true || v === "true" ? 1 : 0;
}

const CATEGORIES = new Set([
  "entry",
  "context",
  "confirmation",
  "invalidation",
  "risk",
  "note",
]);

const REVISE_PROMPT = `You are the Edge Builder for a trading-discipline app.
The trader reviewed the draft checklist you produced and sent feedback.
Revise the checklist so it matches what the trader actually wants:
- Apply every change they asked for.
- Keep the rules they did not object to, unless the feedback contradicts them.
- Never invent a rule the trader did not state or approve.
- Flag anything still ambiguous with a clarifying_question instead of guessing.
- Classify each rule into exactly one category: entry, context, confirmation, invalidation, risk, or note.
- Mark hard_gate=true only for rules that must never be broken.
- Keep the trader's wording where possible; make it concise and checkable.

Respond ONLY with JSON:
{
  "clarifying_questions": ["..."],
  "items": [
    {"category": "entry|context|confirmation|invalidation|risk|note", "text": "checkable rule", "hard_gate": false, "notes": "optional"}
  ]
}`;

/**
 * POST revise the open draft of an edge with AI, based on the trader's
 * feedback about the current checklist lines. Replaces the draft items in
 * place so the trader can review again — the loop continues until they
 * approve every line.
 */
export async function POST(req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const draftVersionId: string | undefined = body?.versionId;
  const feedback = typeof body?.feedback === "string" ? body.feedback.trim() : "";
  if (!draftVersionId) {
    return NextResponse.json({ error: "versionId required" }, { status: 400 });
  }
  if (feedback.length < 5) {
    return NextResponse.json(
      { error: "Tell the AI what to change — a short sentence is enough." },
      { status: 400 }
    );
  }

  const edge = db
    .prepare("SELECT id FROM edges WHERE id = ? AND user_id = ?")
    .get(id, user.id) as { id: string } | undefined;
  if (!edge) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

  const version = db
    .prepare("SELECT id, status, source_text FROM edge_versions WHERE id = ? AND edge_id = ?")
    .get(draftVersionId, id) as
    | { id: string; status: string; source_text: string | null }
    | undefined;
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  if (version.status === "approved") {
    return NextResponse.json(
      { error: "Approved versions are immutable. Create a new version to edit." },
      { status: 409 }
    );
  }

  const current = db
    .prepare(
      "SELECT category, text, hard_gate, notes FROM checklist_items WHERE version_id = ? ORDER BY position"
    )
    .all(version.id) as Array<{
    category: string;
    text: string;
    hard_gate: number;
    notes: string | null;
  }>;

  const currentList = current
    .map((i, n) => `${n + 1}. [${i.category}] ${i.text}${i.hard_gate ? " (hard gate)" : ""}`)
    .join("\n");

  let parsed: ReviseResponse;
  try {
    parsed = await chatJson<ReviseResponse>(
      [
        { role: "system", content: REVISE_PROMPT },
        {
          role: "user",
          content:
            `My original description of the edge:\n${version.source_text ?? "(none)"}\n\n` +
            `Current checklist:\n${currentList || "(empty)"}\n\n` +
            `My feedback:\n${feedback}`,
        },
      ],
      { userId: user.id, feature: "edge_builder" }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `AI revision failed: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 502 }
    );
  }

  const items = (parsed.items ?? []).filter(
    (i) => i && typeof i.text === "string" && CATEGORIES.has(i.category)
  );
  if (items.length === 0) {
    return NextResponse.json(
      { error: "The AI could not produce a revised checklist. Rephrase your feedback." },
      { status: 422 }
    );
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM checklist_items WHERE version_id = ?").run(version.id);
    const insert = db.prepare(
      `INSERT INTO checklist_items (id, version_id, category, text, hard_gate, position, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    items.forEach((item, i) => {
      insert.run(
        crypto.randomUUID(),
        version.id,
        item.category,
        item.text.trim(),
        hardGateFlag(item.hard_gate),
        i,
        typeof item.notes === "string" ? item.notes : null
      );
    });
    db.prepare("UPDATE edges SET updated_at = ? WHERE id = ?").run(now(), id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({
    items: db
      .prepare(
        "SELECT id, category, text, hard_gate, position, notes FROM checklist_items WHERE version_id = ? ORDER BY position"
      )
      .all(version.id),
    clarifying_questions: parsed.clarifying_questions ?? [],
  });
}
