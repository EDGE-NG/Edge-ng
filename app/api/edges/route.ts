import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { chatJson } from "@/lib/ai";


interface DraftItem {
  category: string;
  text: string;
  // The AI may emit a string ("false" is truthy in JS — coerce explicitly)
  hard_gate?: boolean | string;
  notes?: string;
}

/** Coerce an AI-provided hard_gate to 0/1 — never trust bare truthiness. */
function hardGateFlag(v: boolean | string | undefined): number {
  return v === true || v === "true" ? 1 : 0;
}

interface DraftResponse {
  name?: string;
  clarifying_questions?: string[];
  items?: DraftItem[];
}

const CATEGORIES = new Set([
  "entry",
  "context",
  "confirmation",
  "invalidation",
  "risk",
  "note",
]);

const SYSTEM_PROMPT = `You are the Edge Builder for a trading-discipline app.
The trader describes their trading edge in their own words. Convert it into a structured checklist.

Rules for you:
- Only extract rules the trader actually stated. Never invent a rule they did not mention.
- Flag vague terms (e.g. "strong momentum", "clean level") by adding a clarifying_question.
- Ask a clarifying_question for anything ambiguous instead of guessing.
- Classify each rule into exactly one category: entry, context, confirmation, invalidation, risk, or note.
- Mark hard_gate=true only for rules that must never be broken (e.g. max risk per trade, no trades during news).
- Keep the trader's wording where possible; make it concise and checkable.

Respond ONLY with JSON:
{
  "name": "short name for this edge",
  "clarifying_questions": ["..."],
  "items": [
    {"category": "entry|context|confirmation|invalidation|risk|note", "text": "checkable rule", "hard_gate": false, "notes": "optional"}
  ]
}`;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (description.length < 20) {
    return NextResponse.json(
      { error: "Describe your edge in at least a couple of sentences." },
      { status: 400 }
    );
  }

  let parsed: DraftResponse;
  try {
    parsed = await chatJson<DraftResponse>(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `My trading edge:\n\n${description}` },
      ],
      { userId: user.id, feature: "edge_builder" }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `AI draft failed: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 502 }
    );
  }

  const items = (parsed.items ?? []).filter(
    (i) => i && typeof i.text === "string" && CATEGORIES.has(i.category)
  );
  if (items.length === 0) {
    return NextResponse.json(
      { error: "The AI could not extract any rules. Add more detail about your conditions." },
      { status: 422 }
    );
  }

  const edgeId = uuid();
  const versionId = uuid();
  const ts = now();

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO edges (id, user_id, name, description, active_version_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`
    ).run(edgeId, user.id, parsed.name?.trim() || "My edge", description, ts, ts);

    db.prepare(
      `INSERT INTO edge_versions (id, edge_id, version_number, status, source_text, created_at)
       VALUES (?, ?, 1, 'draft', ?, ?)`
    ).run(versionId, edgeId, description, ts);

    const insert = db.prepare(
      `INSERT INTO checklist_items (id, version_id, category, text, hard_gate, position, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    items.forEach((item, i) => {
      insert.run(
        uuid(),
        versionId,
        item.category,
        item.text.trim(),
        hardGateFlag(item.hard_gate),
        i,
        typeof item.notes === "string" ? item.notes : null
      );
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({
    edgeId,
    versionId,
    name: parsed.name?.trim() || "My edge",
    clarifying_questions: parsed.clarifying_questions ?? [],
    items: db
      .prepare("SELECT * FROM checklist_items WHERE version_id = ? ORDER BY position")
      .all(versionId),
  });
}
