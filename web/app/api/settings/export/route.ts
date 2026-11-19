import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const profile = await db.one(
    "SELECT * FROM profiles WHERE user_id = ?",
    user.id
  );

  const legal = await db.all(
    "SELECT document_type, document_version, accepted_at FROM legal_acceptances WHERE user_id = ?",
    user.id
  );

  const checklists = await db.all(
    "SELECT * FROM checklists WHERE user_id = ?",
    user.id
  );

  const versions = await db.all(
    `SELECT v.* FROM checklist_versions v
     JOIN checklists c ON c.id = v.checklist_id
     WHERE c.user_id = ?`,
    user.id
  );

  const items = await db.all(
    `SELECT i.* FROM checklist_items i
     JOIN checklist_versions v ON v.id = i.version_id
     JOIN checklists c ON c.id = v.checklist_id
     WHERE c.user_id = ?`,
    user.id
  );

  const evidence = await db.all(
    `SELECT id, checklist_id, item_key, slot, polarity, status, object_key, mime_type, bytes, width, height, trader_note, interpretation_text, interpretation_json, created_at, archived_at
     FROM evidence_images WHERE user_id = ? ORDER BY created_at DESC`,
    user.id
  );

  const intents = await db.all(
    "SELECT * FROM trade_intents WHERE user_id = ? ORDER BY created_at DESC",
    user.id
  );

  const decisions = await db.all(
    "SELECT * FROM gate_decisions WHERE user_id = ? ORDER BY decided_at DESC",
    user.id
  );

  const overrides = await db.all(
    "SELECT * FROM overrides WHERE user_id = ? ORDER BY created_at DESC",
    user.id
  );

  const journal = await db.all(
    "SELECT * FROM journal_entries WHERE user_id = ? ORDER BY created_at DESC",
    user.id
  );

  const monitors = await db.all(
    `SELECT id, checklist_id, instrument, timeframe, status, last_state, last_checked_at, last_alert_at, created_at
     FROM checklist_monitors WHERE user_id = ? ORDER BY created_at`,
    user.id
  );
  const alertEvents = await db.all(
    "SELECT * FROM alert_events WHERE user_id = ? ORDER BY created_at DESC",
    user.id
  );

  const exportData = {
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email,
      profile,
    },
    legalAcceptances: legal,
    checklists: checklists.map((c) => ({
      ...c,
      versions: versions
        .filter((v) => v.checklist_id === c.id)
        .map((v) => ({
          ...v,
          items: items.filter((i) => i.version_id === v.id),
        })),
    })),
    evidenceLibrary: evidence.map((e) => ({
      ...e,
      interpretation_json: json((e as Record<string, unknown>).interpretation_json, null),
    })),
    tradeIntents: intents,
    gateDecisions: decisions.map((d) => ({
      ...d,
      reasons: json(d.reasons, {}),
      snapshot: json(d.snapshot, {}),
    })),
    overrides: overrides.map((o) => ({
      ...o,
      rules_overridden: json(o.rules_overridden, []),
    })),
    journalEntries: journal,
    alerts: {
      monitors,
      events: alertEvents.map((e) => ({
        ...e,
        summary: json((e as Record<string, unknown>).summary, null),
        deliveries: json((e as Record<string, unknown>).deliveries, {}),
      })),
    },
  };

  const filename = `edge-export-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

