import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, json } from "@/lib/db";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // 1. Gate decisions stats
  const decisions = await db.all<{
    id: string;
    result: string;
    resolution: string | null;
    decided_at: string;
    instrument: string;
    side: string;
  }>(
    `SELECT d.id, d.result, d.resolution, d.decided_at, i.instrument, i.side
     FROM gate_decisions d
     JOIN trade_intents i ON i.id = d.intent_id
     WHERE d.user_id = ?
     ORDER BY d.decided_at DESC`,
    user.id
  );

  const totalChecks = decisions.length;
  let approvedCount = 0;
  let acceptedDenialCount = 0;
  let overriddenCount = 0;
  let needsEvidenceCount = 0;

  for (const d of decisions) {
    if (d.resolution === "overridden") {
      overriddenCount++;
    } else if (d.resolution === "accepted_denial") {
      acceptedDenialCount++;
    } else if (d.result === "approved") {
      approvedCount++;
    } else if (d.result === "needs_evidence") {
      needsEvidenceCount++;
    } else if (d.result === "denied") {
      // Unresolved denial counts as disciplined avoidance
      acceptedDenialCount++;
    }
  }

  const decidedCount = approvedCount + acceptedDenialCount + overriddenCount;
  const adherenceRate = decidedCount > 0
    ? Math.round(((approvedCount + acceptedDenialCount) / decidedCount) * 100)
    : 100;

  // 2. Active checklist version check
  const activeChecklist = await db.one<{ id: string; name: string; version_number: number }>(
    `SELECT c.id, c.name, v.version_number
     FROM checklists c
     JOIN checklist_versions v ON v.checklist_id = c.id
     WHERE c.user_id = ? AND v.status = 'approved'
     ORDER BY v.approved_at DESC LIMIT 1`,
    user.id
  );

  // 3. Evidence count
  const evidenceCountRow = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM evidence_images WHERE user_id = ?",
    user.id
  );

  return NextResponse.json({
    metrics: {
      totalChecks,
      adherenceRate,
      approvedCount,
      acceptedDenialCount,
      overriddenCount,
      needsEvidenceCount,
      evidenceImagesCount: evidenceCountRow?.n ?? 0,
      activeChecklist: activeChecklist ? `${activeChecklist.name} (v${activeChecklist.version_number})` : null,
    },
    recentDecisions: decisions.slice(0, 5),
  });
}

