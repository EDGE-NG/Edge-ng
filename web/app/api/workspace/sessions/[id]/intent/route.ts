import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json, uuid } from "@/lib/db";
import { MarketError, TIMEFRAMES, findInstrument, getCandles, type Timeframe } from "@/lib/market";
import {
  APPROVAL_SECONDS,
  evaluateRiskRule,
  reasonFor,
  rollUp,
  ruleMode,
  ticketKey,
  ticketMath,
  type Check,
  type Ticket,
} from "@/lib/workspace";
import { overrideAllowance } from "@/lib/overrides";
import { getSession, refreshForGate, ruleStates, sessionRules, tradesToday } from "@/lib/workspace-session";

const PRICE_TOLERANCE = 0.0015; // 0.15% of price (REQ-GT-3)

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

const ORDER_TYPES = ["market", "pending", "limit", "stop_limit"] as const;

/**
 * POST { side, entry, stop?, target?, accountSize?, riskAmount?, timeframe, image?, idempotencyKey,
 *        orderType?, size?, sizeUnit? }
 * (orderType / size / sizeUnit come from the platform-style ticket and are kept in the snapshot.)
 * -> the trader pressed Buy or Sell (PR-GT-1). Edge re-checks with a fresh
 * frame and the current price, evaluates risk rules in code, and returns
 * Approved / Denied / Needs evidence (PR-GT-2, REQ-GT-1). Decisions are
 * idempotent per intent (EC-G8) and stored with a full snapshot (REQ-GT-5).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const s = await getSession(id, user.id);
  if (!s) return NextResponse.json({ error: "This workspace session has ended. Pick the instrument again." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const key = typeof b.idempotencyKey === "string" ? b.idempotencyKey.slice(0, 80) : null;
  if (key) {
    const prior = await db.one<{ id: string }>(
      `SELECT d.id FROM trade_intents i JOIN gate_decisions d ON d.intent_id = i.id
       WHERE i.idempotency_key = ? AND i.user_id = ?`,
      key,
      user.id
    );
    if (prior) return NextResponse.json({ decisionId: prior.id, duplicate: true, ...(await decisionView(prior.id)) });
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
  const orderType = (ORDER_TYPES as readonly string[]).includes(String(b.orderType)) ? String(b.orderType) : "market";
  const pending = orderType !== "market";
  const order = {
    type: orderType,
    size: num(b.size),
    sizeUnit: typeof b.sizeUnit === "string" ? b.sizeUnit.slice(0, 12) : null,
    platform: typeof b.platform === "string" && b.platform ? b.platform.slice(0, 40) : s.platform,
  };

  const inst = findInstrument(s.instrument)!;
  // fresh frame + current price at the press of the button (PRD 5.5 step 8).
  // Chart checks count only if made within FRAME_MAX_AGE_MS of this press
  // (REQ-LLM-5); hard-gate rules on other timeframes are re-checked now.
  let lastPrice: number;
  let cannotCheck: string | null = null;
  let freshAfter = Date.now();
  try {
    const image =
      typeof b.image === "string" && b.image.startsWith("data:image/png;base64,")
        ? Buffer.from(b.image.slice(22), "base64")
        : null;
    const refreshed = await refreshForGate(s, { timeframe: tf, image, ticket, pending });
    freshAfter = refreshed.freshAfter;
    if (refreshed.failed.length) {
      cannotCheck = refreshed.failed.map((f) => `${f.timeframe}: ${f.message}`).join(" ");
    }
    // Buy / Sell: candles at most 15 s old; without them the checks fail (Inconclusive)
    const candles = await getCandles(inst, tf, 300, { maxAgeMs: 15_000 });
    lastPrice = candles[candles.length - 1].close;
  } catch (err) {
    // REQ-GT-7: data or frame unavailable -> "cannot check", never a silent approval
    if (!(err instanceof MarketError)) console.error("[gate] fresh check failed:", err);
    cannotCheck = err instanceof MarketError ? err.message : "Edge couldn't refresh the chart.";
    lastPrice = ticket.entry;
  }

  const { rules, risk } = await sessionRules(s);
  const today = await tradesToday(user.id);
  const codeChecks = new Map<string, Check>();
  for (const r of rules) {
    if (ruleMode(r, risk) === "code") codeChecks.set(r.item_key!, evaluateRiskRule(r, risk, ticket, today));
  }
  const states = await ruleStates(s, codeChecks, { freshAfter, ticketKey: ticketKey(ticket, pending) });
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

  // Stored for the database's gate-integrity rule (PRD 9.5): approved only
  // when every hard gate passed; a failed hard gate is always denied.
  const hardGateStatus = result === "approved" ? "passed" : result === "denied" ? "failed" : "unresolved";

  const intentId = uuid();
  const decisionId = uuid();
  try {
    await db.tx(async (t) => {
      await t.run(
        `INSERT INTO trade_intents (id, user_id, session_id, instrument, side, entry_price, stop_price, target_price,
           account_size, risk_amount, risk_pct, risk_reward, status, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'decided', ?)`,
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
        key
      );
      await t.run(
        `INSERT INTO gate_decisions (id, user_id, intent_id, checklist_version_id, result, hard_gate_status, reasons,
           snapshot, reference_price, price_tolerance, valid_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        decisionId,
        user.id,
        intentId,
        s.checklist_version_id,
        result,
        hardGateStatus,
        reasons,
        {
          ticket,
          order,
          timeframe: tf,
          lastPrice,
          risk,
          rules: states.map((st) => ({ rule: st.rule, mode: st.mode, status: st.status, check: st.check })),
          decidedBy: "code",
        },
        lastPrice,
        lastPrice * PRICE_TOLERANCE,
        result === "approved" ? new Date(Date.now() + APPROVAL_SECONDS * 1000).toISOString() : null
      );
    });
  } catch (err) {
    // EC-G8: two presses with the same key at the same moment -> one decision
    const prior = key
      ? await db.one<{ id: string }>(
          `SELECT d.id FROM trade_intents i JOIN gate_decisions d ON d.intent_id = i.id
           WHERE i.idempotency_key = ? AND i.user_id = ?`,
          key,
          user.id
        )
      : undefined;
    if (prior) return NextResponse.json({ decisionId: prior.id, duplicate: true, ...(await decisionView(prior.id)) });
    throw err;
  }

  return NextResponse.json({ decisionId, ...(await decisionView(decisionId)) }, { status: 201 });
}

/** Each rule's result in this decision, in checklist order, for the check popup. */
function ruleResults(snapshot: unknown): Array<{ itemKey: string; status: string; reason: string }> {
  const snap = json<{ rules?: Array<{ rule?: { item_key?: string }; mode?: string; status?: string; check?: { reasoning?: string; missing?: string | null } | null }> }>(snapshot, {});
  return (snap.rules ?? []).map((r) => ({
    itemKey: String(r.rule?.item_key ?? ""),
    status: String(r.status ?? "unchecked"),
    reason: r.check?.reasoning || (r.check?.missing ? `Edge still needs ${r.check.missing}.` : ""),
  }));
}

async function decisionView(decisionId: string) {
  const d = (await db.one<Record<string, unknown>>(
    `SELECT d.*, i.side, i.entry_price, i.stop_price, i.target_price, i.risk_pct, i.risk_reward, i.instrument
     FROM gate_decisions d JOIN trade_intents i ON i.id = d.intent_id WHERE d.id = ?`,
    decisionId
  ))!;
  return {
    result: d.result as "approved" | "denied" | "needs_evidence",
    reasons: json(d.reasons, {}),
    rules: ruleResults(d.snapshot),
    validUntil: d.valid_until as string | null,
    referencePrice: d.reference_price as number,
    resolution: (d.resolution as string) ?? null,
    // weekly override allowance, shown next to the Override button
    overrides: d.result === "approved" ? null : await overrideAllowance(d.user_id as string),
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
