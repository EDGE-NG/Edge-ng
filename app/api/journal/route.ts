import { NextResponse } from "next/server";
import { db, uuid, now } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { chatJson } from "@/lib/ai";

export const maxDuration = 120;

interface JournalInput {
  instrument: string;
  direction: string | null;
  overall: string | null;
  summary: string | null;
  items: Array<{ text: string; hard_gate: number }>;
  results: Array<{ verdict: string; evidence: string | null; explanation: string | null }>;
  override: { reason: string | null; at: string } | null;
  trade: {
    entry_price: number | null;
    exit_price: number | null;
    pnl: number | null;
    opened_at: string | null;
    closed_at: string | null;
    notes: string | null;
  } | null;
}

interface JournalOutput {
  summary?: string;
  execution_quality?: string;
  strengths?: string;
  deviations?: string;
  lessons?: string;
}

const SYSTEM_PROMPT = `You are the journal engine of a trading-discipline app.
Given a completed pre-trade review, the trader's decisions, and the trade outcome, write a short structured journal entry.

Critical rules:
- Assess EXECUTION QUALITY separately from profit/loss. A profitable trade that broke rules is poor execution; a losing trade that followed every rule is good execution.
- Base statements only on the provided data. Never invent prices, candles, or market events.
- Never shame or praise the trader for overriding; overrides are data, not moral failures.
- Be concrete and specific, plain language, no fluff.
- Strengths: what the trader did according to their own rules.
- Deviations: where the trader's actions differed from the checklist or AI result.
- Lessons: one or two actionable items for next time.
- JSON string values must escape quotes and newlines (use \n). Keep each value to 2-3 sentences.

Respond ONLY with JSON:
{
  "summary": "what happened, 2-3 sentences",
  "execution_quality": "one paragraph assessing process adherence, explicitly separate from P&L",
  "strengths": "bullet-like short lines",
  "deviations": "bullet-like short lines, or 'None recorded'",
  "lessons": "1-2 actionable items"
}`;

function buildUserPrompt(input: JournalInput): string {
  const rules = input.items
    .map(
      (i, n) =>
        `${n + 1}. ${i.text}${i.hard_gate ? " [HARD GATE]" : ""} → ${
          input.results[n]?.verdict ?? "not assessed"
        }: ${input.results[n]?.explanation ?? ""}`
    )
    .join("\n");

  return [
    `Instrument: ${input.instrument} (${input.direction ?? "n/a"})`,
    `AI overall: ${input.overall ?? "n/a"}`,
    `AI summary: ${input.summary ?? "n/a"}`,
    ``,
    `Checklist & verdicts:`,
    rules,
    ``,
    `Override: ${
      input.override
        ? `YES — reason: ${input.override.reason || "no reason given"} at ${input.override.at}`
        : "no"
    }`,
    ``,
    `Trade outcome: ${
      input.trade
        ? `entry ${input.trade.entry_price ?? "?"} → exit ${input.trade.exit_price ?? "?"}, P&L ${
            input.trade.pnl ?? "unknown"
          }, opened ${input.trade.opened_at ?? "?"}, closed ${input.trade.closed_at ?? "?"}${
            input.trade.notes ? `, notes: ${input.trade.notes}` : ""
          }`
        : "not recorded yet"
    }`,
  ].join("\n");
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const tradeId = body?.tradeId;
  const reviewId = body?.reviewId;

  if (!tradeId && !reviewId) {
    return NextResponse.json({ error: "tradeId or reviewId required" }, { status: 400 });
  }

  const trade = tradeId
    ? (db
        .prepare("SELECT * FROM trades WHERE id = ? AND user_id = ?")
        .get(tradeId, user.id) as Record<string, unknown> | undefined)
    : undefined;
  if (tradeId && !trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

  const effectiveReviewId = (trade?.review_id as string | null) ?? reviewId;
  const review = effectiveReviewId
    ? (db
        .prepare(
          `SELECT r.*, v.version_number, e.name AS edge_name
           FROM trade_reviews r
           JOIN edge_versions v ON v.id = r.edge_version_id
           JOIN edges e ON e.id = v.edge_id
           WHERE r.id = ? AND r.user_id = ?`
        )
        .get(effectiveReviewId, user.id) as Record<string, unknown> | undefined)
    : undefined;
  if (effectiveReviewId && !review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }
  if (!review && !trade) {
    return NextResponse.json({ error: "Nothing to journal" }, { status: 404 });
  }

  const items = review
    ? (db
        .prepare(
          "SELECT text, hard_gate FROM checklist_items WHERE version_id = ? ORDER BY position"
        )
        .all(review.edge_version_id as string) as Array<{ text: string; hard_gate: number }>)
    : [];

  const results = review
    ? (db
        .prepare(
          "SELECT verdict, evidence, explanation FROM review_results WHERE review_id = ? ORDER BY created_at"
        )
        .all(review.id as string) as Array<{
        verdict: string;
        evidence: string | null;
        explanation: string | null;
      }>)
    : [];

  const input: JournalInput = {
    instrument: (trade?.instrument as string) ?? (review?.instrument as string) ?? "unknown",
    direction: (trade?.direction as string | null) ?? (review?.direction as string | null),
    overall: (review?.overall as string | null) ?? null,
    summary: (review?.summary as string | null) ?? null,
    items,
    results,
    override:
      review?.overridden_at
        ? {
            reason: (review.override_reason as string | null) ?? null,
            at: review.overridden_at as string,
          }
        : null,
    trade: trade
      ? {
          entry_price: (trade.entry_price as number | null) ?? null,
          exit_price: (trade.exit_price as number | null) ?? null,
          pnl: (trade.pnl as number | null) ?? null,
          opened_at: (trade.opened_at as string | null) ?? null,
          closed_at: (trade.closed_at as string | null) ?? null,
          notes: (trade.notes as string | null) ?? null,
        }
      : null,
  };

  let parsed: JournalOutput;
  try {
    parsed = await chatJson<JournalOutput>(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      { userId: user.id, feature: "journal" }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Journal generation failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    );
  }

  const compliance = {
    total: items.length,
    pass: results.filter((r) => r.verdict === "pass").length,
    fail: results.filter((r) => r.verdict === "fail").length,
    inconclusive: results.filter((r) => r.verdict === "inconclusive").length,
    overridden: Boolean(input.override),
  };

  const entryId = uuid();
  db.prepare(
    `INSERT INTO journal_entries (id, user_id, trade_id, review_id, summary, compliance_json, execution_quality, strengths, deviations, lessons, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    entryId,
    user.id,
    (trade?.id as string | null) ?? null,
    (review?.id as string | null) ?? null,
    parsed.summary ?? null,
    JSON.stringify(compliance),
    parsed.execution_quality ?? null,
    parsed.strengths ?? null,
    parsed.deviations ?? null,
    parsed.lessons ?? null,
    now()
  );

  return NextResponse.json({ entryId, compliance });
}

/** GET journal entries for the logged-in user */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const entries = db
    .prepare(
      `SELECT je.id, je.summary, je.compliance_json, je.execution_quality, je.strengths,
              je.deviations, je.lessons, je.created_at,
              t.id AS trade_id, t.instrument, t.direction, t.pnl,
              r.id AS review_id, r.overall, r.instrument AS review_instrument
       FROM journal_entries je
       LEFT JOIN trades t ON t.id = je.trade_id
       LEFT JOIN trade_reviews r ON r.id = je.review_id
       WHERE je.user_id = ?
       ORDER BY je.created_at DESC
       LIMIT 100`
    )
    .all(user.id) as Array<Record<string, unknown>>;
  return NextResponse.json({ entries });
}
