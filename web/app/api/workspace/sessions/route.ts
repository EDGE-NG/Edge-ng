import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { INSTRUMENTS, providerReady } from "@/lib/market";
import { openSession, sessionView, startSession } from "@/lib/workspace-session";

/** GET -> what the workspace needs to start: approved checklists, instruments, the open session. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const checklists = await db.all(
    `SELECT e.id AS "edgeId", e.name, v.version_number AS "versionNumber"
     FROM checklists e JOIN checklist_versions v ON v.id = e.active_version_id
     WHERE e.user_id = ? AND e.deleted_at IS NULL ORDER BY e.updated_at DESC`,
    user.id
  );
  const open = await openSession(user.id);
  return NextResponse.json({
    checklists,
    instruments: INSTRUMENTS.map((i) => ({
      symbol: i.symbol,
      label: i.label,
      assetClass: i.assetClass,
      decimals: i.decimals,
      ready: providerReady(i),
    })),
    view: open ? await sessionView(open) : null,
  });
}

/** POST { edgeId, instrument, platform? } -> start a session (PR-TW-1). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { edgeId?: string; instrument?: string; platform?: string };
  try {
    const s = await startSession(
      user.id,
      String(body.edgeId ?? ""),
      String(body.instrument ?? ""),
      body.platform ? String(body.platform).slice(0, 40) : null
    );
    return NextResponse.json(await sessionView(s), { status: 201 });
  } catch (err) {
    const m = err instanceof Error ? err.message : "";
    if (m === "no_active_checklist") {
      return NextResponse.json({ error: "Approve a checklist before opening the workspace." }, { status: 409 });
    }
    if (m === "unknown_instrument") return NextResponse.json({ error: "Unknown instrument." }, { status: 400 });
    throw err;
  }
}
