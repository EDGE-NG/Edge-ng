import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, uuid } from "@/lib/db";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const d = await db.one<{ id: string; result: string; resolution: string | null }>(
    "SELECT id, result, resolution FROM gate_decisions WHERE id = ? AND user_id = ?",
    id,
    user.id
  );
  if (!d) return NextResponse.json({ error: "Decision not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    userNotes?: string;
    lessons?: string;
    executionQuality?: string;
  };

  const existing = await db.one<{ id: string }>(
    "SELECT id FROM journal_entries WHERE decision_id = ? AND user_id = ?",
    id,
    user.id
  );

  const traderDecision =
    d.resolution === "overridden"
      ? "overridden"
      : d.resolution === "accepted_denial"
      ? "accepted_denial"
      : "followed";

  if (existing) {
    await db.run(
      `UPDATE journal_entries
       SET user_notes = COALESCE(?, user_notes),
           lessons = COALESCE(?, lessons),
           execution_quality = COALESCE(?, execution_quality),
           status = 'edited',
           updated_at = now()
       WHERE id = ? AND user_id = ?`,
      body.userNotes ?? null,
      body.lessons ?? null,
      body.executionQuality ?? null,
      existing.id,
      user.id
    );
  } else {
    await db.run(
      `INSERT INTO journal_entries (id, user_id, decision_id, edge_result, trader_decision, user_notes, lessons, execution_quality, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'edited')`,
      uuid(),
      user.id,
      d.id,
      d.result,
      traderDecision,
      body.userNotes ?? null,
      body.lessons ?? null,
      body.executionQuality ?? null
    );
  }

  return NextResponse.json({ ok: true });
}
