import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { chatJson } from "@/lib/ai";

export const maxDuration = 120;

interface RuleResult {
  item_id?: string | null;
  verdict: "pass" | "fail" | "inconclusive";
  evidence?: string | null;
  explanation?: string | null;
}

interface ReviewResponse {
  results?: RuleResult[];
  summary?: string;
  missing_evidence?: string;
}

const SYSTEM_PROMPT = `You are a pre-trade review engine for a trading-discipline app.
The trader has an APPROVED checklist. You receive the checklist rules and evidence the trader provided (chart screenshots and/or text notes about timeframes and price action).

For EACH rule, respond with a verdict:
- "pass": evidence clearly satisfies the rule
- "fail": evidence clearly conflicts with the rule
- "inconclusive": evidence is missing, unclear, or conflicting — say exactly what view/timeframe/annotation would resolve it

Hard rules:
- Only use the evidence provided. Never invent prices, candles, indicators, fills, or account state.
- Distinguish observed facts from inferred interpretations in your explanation.
- Distinguish the chart view/timeframe you are using for each result.
- Never describe a pass as a prediction of profitability.
- If an image is provided, prefer reading it; if text notes conflict with an image, say so and lean inconclusive.
- A hard-gate rule that fails must be reported as "fail" — never averaged away.
- The trader's confirmed visual references describe how THEY interpret their own rule. Use them to judge their intent, but they are not evidence that the current setup satisfies the rule.

Respond ONLY with JSON:
{
  "results": [
    {"item_id": "<rule id>", "verdict": "pass|fail|inconclusive", "evidence": "what you observed", "explanation": "why this verdict for this rule"}
  ],
  "summary": "2-4 sentence overall assessment of whether the setup fits the trader's edge",
  "missing_evidence": "what is missing, or empty string"
}`;

function rollup(results: Array<{ verdict: string }>, items: Array<{ id: string; hard_gate: number }>): string {
  const hardFail = results.some(
    (r) => r.verdict === "fail" && items.find((i) => i.id === (r as RuleResult).item_id)?.hard_gate
  );
  if (hardFail) return "fail";
  if (results.some((r) => r.verdict === "fail")) return "fail";
  if (results.some((r) => r.verdict === "inconclusive")) return "inconclusive";
  return "pass";
}

/** POST run the AI review against the approved checklist + collected evidence */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const review = db
    .prepare(
      `SELECT r.id, r.status, r.edge_version_id, r.instrument, r.direction, r.context_json,
              v.version_number, v.status AS version_status
       FROM trade_reviews r
       JOIN edge_versions v ON v.id = r.edge_version_id
       WHERE r.id = ? AND r.user_id = ?`
    )
    .get(id, user.id) as Record<string, unknown> | undefined;
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  if (review.status === "completed") {
    return NextResponse.json({ error: "Review already completed" }, { status: 409 });
  }

  const items = db
    .prepare(
      "SELECT id, category, text, hard_gate FROM checklist_items WHERE version_id = ? ORDER BY position"
    )
    .all(review.edge_version_id as string) as Array<{
    id: string;
    category: string;
    text: string;
    hard_gate: number;
  }>;
  if (items.length === 0) {
    return NextResponse.json({ error: "Checklist has no rules" }, { status: 422 });
  }

  const evidence = db
    .prepare(
      "SELECT kind, payload, timeframe, provenance FROM review_evidence WHERE review_id = ? ORDER BY created_at"
    )
    .all(id) as Array<{ kind: string; payload: string; timeframe: string | null }>;

  const hasImage = evidence.some((e) => e.kind === "image");
  const hasText = evidence.some((e) => e.kind === "note");

  if (!hasImage && !hasText) {
    return NextResponse.json(
      {
        error:
          "No evidence yet. Add a chart capture or a text note describing the chart before running the review.",
      },
      { status: 422 }
    );
  }

  const checklistText = items
    .map(
      (i, n) =>
        `${n + 1}. [${i.category}${i.hard_gate ? " | HARD GATE" : ""}] (id=${i.id}) ${i.text}`
    )
    .join("\n");

  // Trader-confirmed Visual Library interpretations for these rules (PRD 4.3 → 4.4)
  const confirmedVisual = db
    .prepare(
      `SELECT item_id, confirmed_interpretation FROM visual_references
       WHERE item_id IN (${items.map(() => "?").join(",")})
         AND approval_status = 'approved' AND confirmed_interpretation IS NOT NULL`
    )
    .all(...items.map((i) => i.id)) as Array<{
    item_id: string;
    confirmed_interpretation: string;
  }>;
  const visualText = confirmedVisual.length
    ? [
        ``,
        `Trader's confirmed visual references (their own examples of how these rules look):`,
        ...confirmedVisual.map(
          (v) => `- (rule id=${v.item_id}) ${v.confirmed_interpretation}`
        ),
      ].join("\n")
    : "";

  const context = JSON.parse((review.context_json as string) || "{}");
  const userText = [
    `Instrument: ${review.instrument} (${review.direction})`,
    `Context: ${JSON.stringify(context)}`,
    `Checklist version: v${review.version_number}`,
    ``,
    `Rules:`,
    checklistText,
    visualText,
    ``,
    `Evidence provided by trader:`,
    ...evidence.map((e) =>
      e.kind === "note"
        ? `- Text note${e.timeframe ? ` [${e.timeframe}]` : ""}: ${e.payload}`
        : `- Chart screenshot${e.timeframe ? ` [${e.timeframe}]` : ""} (attached below)`
    ),
  ].join("\n");

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: userText },
  ];
  for (const e of evidence) {
    if (e.kind === "image") content.push({ type: "image_url", image_url: { url: e.payload } });
  }

  let parsed: ReviewResponse;
  try {
    parsed = await chatJson<ReviewResponse>(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      { userId: user.id, feature: "trade_review" }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Review failed: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 502 }
    );
  }

  const results: RuleResult[] = (parsed.results ?? [])
    .filter((r) => r && ["pass", "fail", "inconclusive"].includes(r.verdict))
    .map((r) => ({
      item_id: items.find((i) => i.id === r.item_id)?.id ?? r.item_id,
      verdict: r.verdict,
      evidence: typeof r.evidence === "string" ? r.evidence : null,
      explanation: typeof r.explanation === "string" ? r.explanation : null,
    }))
    .filter((r) => items.some((i) => i.id === r.item_id));

  if (results.length === 0) {
    return NextResponse.json(
      { error: "The AI returned no usable results. Try again or add clearer evidence." },
      { status: 422 }
    );
  }

  const overall = rollup(results, items);
  const ts = now();

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM review_results WHERE review_id = ?").run(id);
    const insert = db.prepare(
      `INSERT INTO review_results (id, review_id, item_id, verdict, evidence, explanation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of results) {
      insert.run(uuid(), id, r.item_id ?? null, r.verdict, r.evidence ?? null, r.explanation ?? null, ts);
    }
    db.prepare(
      `UPDATE trade_reviews SET status = 'completed', overall = ?, summary = ?, missing_evidence = ?, completed_at = ?
       WHERE id = ?`
    ).run(
      overall,
      typeof parsed.summary === "string" ? parsed.summary : null,
      typeof parsed.missing_evidence === "string" ? parsed.missing_evidence : null,
      ts,
      id
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ overall, results });
}
