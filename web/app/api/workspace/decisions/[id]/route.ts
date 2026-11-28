import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json, uuid, type Db } from "@/lib/db";
import { findInstrument, getCandles } from "@/lib/market";
import { overrideAllowance, resetText } from "@/lib/overrides";
import { openTrade } from "@/lib/trade-watch";

/**
 * POST { action, reason? } on a gate decision:
 *  accept   -> the trader accepts the denial; the trade is not taken (PR-GT-4)
 *  override -> one confirmation, optional reason; recorded with the rules it
 *              overrode, never judged (PR-OV-1, REQ-GT-6). Limited to
 *              OVERRIDES_PER_WEEK per trader per market week, which resets
 *              Sunday 18:00 New York (new decision, lib/overrides.ts); over
 *              the limit -> 429 override_limit
 *  placed   -> Phase 1: the trader placed it on their platform. Allowed for a
 *              still-valid approval (expiry + price tolerance, REQ-GT-3) or
 *              after an override. Opens the trade, which Edge then watches
 *              for its stop loss and take profit (Task D5, lib/trade-watch.ts).
 *  cancel   -> the trader changed their mind
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const d = await db.one<{
        id: string;
        intent_id: string;
        result: string;
        resolution: string | null;
        valid_until: string | null;
        reference_price: number;
        price_tolerance: number;
        reasons: unknown;
        instrument: string;
      }>(
    `SELECT d.*, i.instrument, i.id AS intent_id FROM gate_decisions d
     JOIN trade_intents i ON i.id = d.intent_id WHERE d.id = ? AND i.user_id = ?`,
    id,
    user.id
  );
  if (!d) return NextResponse.json({ error: "Decision not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
  const resolve = (resolution: string, intentStatus: string, also?: (t: Db) => Promise<void>) =>
    db.tx(async (t) => {
      await t.run("UPDATE gate_decisions SET resolution = ?, resolved_at = now() WHERE id = ?", resolution, d.id);
      await t.run("UPDATE trade_intents SET status = ? WHERE id = ?", intentStatus, d.intent_id);
      if (also) await also(t);
    });

  if (body.action === "accept") {
    if (d.result === "approved") return NextResponse.json({ error: "Nothing to accept: this trade passed." }, { status: 409 });
    if (d.resolution) return NextResponse.json({ error: "This decision is already closed." }, { status: 409 });
    await resolve("accepted_denial", "cancelled");
    return NextResponse.json({ ok: true, resolution: "accepted_denial" });
  }

  if (body.action === "override") {
    if (d.result === "approved") return NextResponse.json({ error: "This trade passed; there's nothing to override." }, { status: 409 });
    if (d.resolution && d.resolution !== "overridden") {
      return NextResponse.json({ error: "This decision is already closed." }, { status: 409 });
    }
    const reasons = json(d.reasons, { failing: [], missing: [], ticket: [] }) as {
      failing: Array<{ itemKey: string; text: string }>;
      missing: Array<{ itemKey: string; text: string }>;
      ticket: string[];
    };
    // Pressing Override again on an overridden decision is a no-op and uses nothing.
    if (d.resolution === "overridden") {
      return NextResponse.json({ ok: true, resolution: "overridden", overrides: await overrideAllowance(user.id) });
    }
    // Weekly allowance (new decision, see lib/overrides.ts). The lock makes two
    // presses at once count one after the other, so nobody gets a 4th.
    const outcome = await db.tx(async (t) => {
      await t.one("SELECT pg_advisory_xact_lock(hashtext(?))", `overrides:${user.id}`);
      const allowance = await overrideAllowance(user.id, t);
      if (allowance.left === 0) return { blocked: true as const, allowance };
      // One override per decision.
      await t.run(
        `INSERT INTO overrides (id, decision_id, user_id, rules_overridden, reason_text)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT (decision_id) DO NOTHING`,
        uuid(),
        d.id,
        user.id,
        { failing: reasons.failing, missing: reasons.missing, ticket: reasons.ticket },
        typeof body.reason === "string" ? body.reason.trim().slice(0, 500) || null : null
      );
      await t.run("UPDATE gate_decisions SET resolution = 'overridden', resolved_at = now() WHERE id = ?", d.id);
      await t.run("UPDATE trade_intents SET status = 'decided' WHERE id = ?", d.intent_id);
      return { blocked: false as const, allowance: await overrideAllowance(user.id, t) };
    });
    if (outcome.blocked) {
      const { limit, resetsAt } = outcome.allowance;
      return NextResponse.json(
        {
          error: `You've used all ${limit} overrides for this week. They reset to ${limit} on ${resetText(resetsAt)}. You can still accept the result.`,
          code: "override_limit",
          overrides: outcome.allowance,
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ ok: true, resolution: "overridden", overrides: outcome.allowance });
  }

  if (body.action === "placed") {
    const overridden = d.resolution === "overridden";
    if (!overridden) {
      if (d.result !== "approved") return NextResponse.json({ error: "This trade didn't pass your checklist." }, { status: 409 });
      if (d.resolution) return NextResponse.json({ error: "This decision is already closed." }, { status: 409 });
      if (!d.valid_until || Date.parse(d.valid_until) < Date.now()) {
        await resolve("expired", "expired");
        return NextResponse.json({ error: "The approval expired. Check the trade again before placing it.", code: "expired" }, { status: 409 });
      }
      // price moved beyond tolerance since the approval (EC-G4)
      const inst = findInstrument(d.instrument);
      if (inst) {
        try {
          // EC-G4: compare against a price at most 5 s old (never old cached candles)
          const c = await getCandles(inst, "1m", 300, { maxAgeMs: 5_000 });
          const p = c[c.length - 1].close;
          if (Math.abs(p - d.reference_price) > d.price_tolerance) {
            await resolve("expired", "expired");
            return NextResponse.json(
              { error: "Price moved too far since the check. Check the trade again.", code: "price_moved" },
              { status: 409 }
            );
          }
        } catch {
          // EC-G4 / REQ-GT-7: no fresh price means the check couldn't run, so the
          // placement isn't recorded. The decision stays open: the trader tries again.
          return NextResponse.json(
            { error: "Edge couldn't confirm the current price. Try again in a few seconds.", code: "price_unconfirmed" },
            { status: 503 }
          );
        }
      }
    }
    // Open the trade so Edge can watch its stop loss and take profit (Task D5).
    await resolve("placed", "placed", (t) => openTrade(t, d.id, user.id));
    return NextResponse.json({ ok: true, resolution: "placed" });
  }

  if (body.action === "cancel") {
    if (d.resolution && d.resolution !== "overridden") {
      return NextResponse.json({ error: "This decision is already closed." }, { status: 409 });
    }
    await resolve("cancelled", "cancelled");
    return NextResponse.json({ ok: true, resolution: "cancelled" });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
