import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, now, uuid } from "@/lib/db";
import { findInstrument, getCandles } from "@/lib/market";

/**
 * POST { action, reason? } on a gate decision:
 *  accept   -> the trader accepts the denial; the trade is not taken (PR-GT-4)
 *  override -> one confirmation, optional reason; recorded with the rules it
 *              overrode, never blocked or judged (PR-OV-1, REQ-GT-6)
 *  placed   -> Phase 1: the trader placed it on their platform. Allowed for a
 *              still-valid approval (expiry + price tolerance, REQ-GT-3) or
 *              after an override.
 *  cancel   -> the trader changed their mind
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const d = db
    .prepare(
      `SELECT d.*, i.user_id, i.instrument, i.id AS intent_id FROM gate_decisions d
       JOIN trade_intents i ON i.id = d.intent_id WHERE d.id = ? AND i.user_id = ?`
    )
    .get(id, user.id) as
    | {
        id: string;
        intent_id: string;
        result: string;
        resolution: string | null;
        valid_until: string | null;
        reference_price: number;
        price_tolerance: number;
        reasons_json: string;
        instrument: string;
      }
    | undefined;
  if (!d) return NextResponse.json({ error: "Decision not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
  const ts = now();
  const resolve = (resolution: string, intentStatus: string) => {
    db.prepare("UPDATE gate_decisions SET resolution = ?, resolved_at = ? WHERE id = ?").run(resolution, ts, d.id);
    db.prepare("UPDATE trade_intents SET status = ? WHERE id = ?").run(intentStatus, d.intent_id);
  };

  if (body.action === "accept") {
    if (d.result === "approved") return NextResponse.json({ error: "Nothing to accept: this trade passed." }, { status: 409 });
    resolve("accepted_denial", "cancelled");
    return NextResponse.json({ ok: true, resolution: "accepted_denial" });
  }

  if (body.action === "override") {
    if (d.result === "approved") return NextResponse.json({ error: "This trade passed; there's nothing to override." }, { status: 409 });
    if (d.resolution && d.resolution !== "overridden") {
      return NextResponse.json({ error: "This decision is already closed." }, { status: 409 });
    }
    const reasons = JSON.parse(d.reasons_json) as {
      failing: Array<{ itemKey: string; text: string }>;
      missing: Array<{ itemKey: string; text: string }>;
      ticket: string[];
    };
    db.prepare(
      `INSERT INTO overrides (id, decision_id, user_id, rules_overridden_json, reason_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      uuid(),
      d.id,
      user.id,
      JSON.stringify({ failing: reasons.failing, missing: reasons.missing, ticket: reasons.ticket }),
      typeof body.reason === "string" ? body.reason.trim().slice(0, 500) || null : null,
      ts
    );
    resolve("overridden", "decided");
    return NextResponse.json({ ok: true, resolution: "overridden" });
  }

  if (body.action === "placed") {
    const overridden = d.resolution === "overridden";
    if (!overridden) {
      if (d.result !== "approved") return NextResponse.json({ error: "This trade didn't pass your checklist." }, { status: 409 });
      if (!d.valid_until || Date.parse(d.valid_until) < Date.now()) {
        resolve("expired", "expired");
        return NextResponse.json({ error: "The approval expired. Check the trade again before placing it.", code: "expired" }, { status: 409 });
      }
      // price moved beyond tolerance since the approval (EC-G4)
      const inst = findInstrument(d.instrument);
      if (inst) {
        try {
          const c = await getCandles(inst, "1m", 2);
          const p = c[c.length - 1].close;
          if (Math.abs(p - d.reference_price) > d.price_tolerance) {
            resolve("expired", "expired");
            return NextResponse.json(
              { error: "Price moved too far since the check. Check the trade again.", code: "price_moved" },
              { status: 409 }
            );
          }
        } catch {
          /* price unavailable: the time window still applies */
        }
      }
    }
    resolve("placed", "placed");
    return NextResponse.json({ ok: true, resolution: "placed" });
  }

  if (body.action === "cancel") {
    resolve("cancelled", "cancelled");
    return NextResponse.json({ ok: true, resolution: "cancelled" });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
