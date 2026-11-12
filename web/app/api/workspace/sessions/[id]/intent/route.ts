import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, now, uuid } from "@/lib/db";
import { MarketError, TIMEFRAMES, findInstrument, getCandles, type Timeframe } from "@/lib/market";
import {
  APPROVAL_SECONDS,
  evaluateRiskRule,
  reasonFor,
  rollUp,
  ruleMode,
  ticketMath,
  type Check,
  type Ticket,
} from "@/lib/workspace";
import { getSession, processFrame, ruleStates, sessionRules, tradesToday } from "@/lib/workspace-session";

const PRICE_TOLERANCE = 0.0015; // 0.15% of price (REQ-GT-3)

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

/**
 * POST { side, entry, stop?, target?, accountSize?, riskAmount?, timeframe, image?, idempotencyKey }
 * -> the trader pressed Buy or Sell (PR-GT-1). Edge re-checks with a fresh
 * frame and the current price, evaluates risk rules in code, and returns
 * Approved / Denied / Needs evidence (PR-GT-2, REQ-GT-1). Decisions are
 * idempotent per intent (EC-G8) and stored with a full snapshot (REQ-GT-5).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const s = getSession(id, user.id);
  if (!s) return NextResponse.json({ error: "This workspace session has ended. Pick the instrument again." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const key = typeof b.idempotencyKey === "string" ? b.idempotencyKey.slice(0, 80) : null;
  if (key) {
    const prior = db
      .prepare(
        `SELECT d.id FROM trade_intents i JOIN gate_decisions d ON d.intent_id = i.id
         WHERE i.idempotency_key = ? AND i.user_id = ?`
      )
      .get(key, user.id) as { id: string } | undefined;
    if (prior) return NextResponse.json({ decisionId: prior.id, duplicate: true, ...decisionView(prior.id) });
  }

  const side = b.side === "sell" ? "sell" : b.side === "buy" ? "buy" : null;
  const ticket: Ticket | null = side
    ? {
        side,
        entry: num(b.entry) ?? NaN,
        stop: num(b.stop),
        target: num(b.target),
        accountSize: num(b.accountSize),
        riskAmount: num(b.riskAmount),
      }
    : null;
  if (!ticket || !Number.isFinite(ticket.entry) || ticket.entry <= 0) {
    return NextResponse.json({ error: "Enter the entry price and choose Buy or Sell." }, { status: 400 });
  }
  const tf = b.timeframe as Timeframe;
  if (!TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "Unknown timeframe." }, { status: 400 });

  const inst = findInstrument(s.instrument)!;
  // fresh frame + current price at the press of the button (PRD 5.5 step 8)
  let lastPrice: number;
  let cannotCheck: string | null = null;
  try {
    const image =
      typeof b.image === "string" && b.image.startsWith("data:image/png;base64,")
        ? Buffer.from(b.image.slice(22), "base64")
        : null;
    await processFrame(s, { timeframe: tf, image, ticket });
    const candles = await getCandles(inst, tf, 300);
    lastPrice = candles[candles.length - 1].close;
  } catch (err) {
    // REQ-GT-7: data or frame unavailable -> "cannot check", never a silent approval
    if (!(err instanceof MarketError)) console.error("[gate] fresh check failed:", err);
    cannotCheck = err instanceof MarketError ? err.message : "Edge couldn't refresh the chart.";
    lastPrice = ticket.entry;
  }

  const { rules, risk } = sessionRules(s);
  const today = tradesToday(user.id);
  const codeChecks = new Map<string, Check>();
  for (const r of rules) {
    if (ruleMode(r, risk) === "code") codeChecks.set(r.item_key!, evaluateRiskRule(r, risk, ticket, today));
  }
  const states = ruleStates(s, codeChecks);
  const roll = rollUp(states);
  const m = ticketMath(ticket);

  // ticket-level hard checks (EC-G7): a stop the plan requires, on the right side
  const ticketProblems: string[] = [];
  if (risk.stopRequired && ticket.stop == null) ticketProblems.push("Your plan needs a stop. Add one to the ticket.");
  if (m.stopWrongSide) ticketProblems.push(`The stop is on the wrong side of entry for a ${side}.`);
  if (m.targetWrongSide) ticketProblems.push(`The target is on the wrong side of entry for a ${side}.`);

  let result = roll.result;
  if (ticketProblems.length) result = "denied";
  if (cannotCheck && result === "approved") result = "needs_evidence";

  const reasons = {
    ticket: ticketProblems,
    cannotCheck,
    failing: roll.failing.map((st) => ({ itemKey: st.rule.item_key, text: st.rule.text, reason: reasonFor(st) })),
    missing: roll.missing.map((st) => ({ itemKey: st.rule.item_key, text: st.rule.text, reason: reasonFor(st), mode: st.mode, timeframe: st.rule.required_timeframe })),
    softFails: roll.softFails.map((st) => ({ itemKey: st.rule.item_key, text: st.rule.text, reason: reasonFor(st) })),
  };

  const intentId = uuid();
  const decisionId = uuid();
  const ts = now();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO trade_intents (id, user_id, session_id, instrument, side, entry_price, stop_price, target_price,
         account_size, risk_amount, risk_pct, risk_reward, status, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'decided', ?, ?)`
    ).run(
      intentId,
      user.id,
      s.id,
      s.instrument,
      side,
      ticket.entry,
      ticket.stop,
      ticket.target,
      ticket.accountSize,
      ticket.riskAmount,
      m.riskPct,
      m.rr,
      key,
      ts
    );
    db.prepare(
      `INSERT INTO gate_decisions (id, intent_id, checklist_version_id, result, reasons_json, snapshot_json,
         reference_price, price_tolerance, valid_until, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      decisionId,
      intentId,
      s.checklist_version_id,
      result,
      JSON.stringify(reasons),
      JSON.stringify({
        ticket,
        timeframe: tf,
        lastPrice,
        risk,
        rules: states.map((st) => ({ rule: st.rule, mode: st.mode, status: st.status, check: st.check })),
        decidedBy: "code",
      }),
      lastPrice,
      lastPrice * PRICE_TOLERANCE,
      result === "approved" ? new Date(Date.now() + APPROVAL_SECONDS * 1000).toISOString() : null,
      ts
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ decisionId, ...decisionView(decisionId) }, { status: 201 });
}

function decisionView(decisionId: string) {
  const d = db
    .prepare(
      `SELECT d.*, i.side, i.entry_price, i.stop_price, i.target_price, i.risk_pct, i.risk_reward, i.instrument
       FROM gate_decisions d JOIN trade_intents i ON i.id = d.intent_id WHERE d.id = ?`
    )
    .get(decisionId) as Record<string, unknown>;
  return {
    result: d.result as "approved" | "denied" | "needs_evidence",
    reasons: JSON.parse(String(d.reasons_json)),
    validUntil: d.valid_until as string | null,
    referencePrice: d.reference_price as number,
    resolution: (d.resolution as string) ?? null,
    ticket: {
      instrument: d.instrument,
      side: d.side,
      entry: d.entry_price,
      stop: d.stop_price,
      target: d.target_price,
      riskPct: d.risk_pct,
      riskReward: d.risk_reward,
    },
  };
}
