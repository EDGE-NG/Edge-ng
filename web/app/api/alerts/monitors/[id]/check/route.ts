import { NextResponse } from "next/server";
import { getMonitor, monitorView, runMonitor } from "@/lib/alerts";
import { getUser } from "@/lib/auth";

export const maxDuration = 60;

const MIN_GAP_MS = 60_000;

/** POST -> check this monitor now ("Check now"), at most once a minute. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const m = await getMonitor(id, user.id);
  if (!m) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  if (m.status !== "active") return NextResponse.json({ error: "Resume this alert first." }, { status: 409 });
  if (m.last_checked_at && Date.now() - Date.parse(m.last_checked_at) < MIN_GAP_MS) {
    return NextResponse.json({ error: "Edge checked this a moment ago. Try again in a minute." }, { status: 429 });
  }
  const result = await runMonitor(m, { force: true });
  return NextResponse.json({ result, monitor: monitorView((await getMonitor(id, user.id))!) });
}
