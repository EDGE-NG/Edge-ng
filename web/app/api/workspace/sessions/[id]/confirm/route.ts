import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { confirmByTrader, getSession, sessionView } from "@/lib/workspace-session";

/** POST { itemKey, confirmed } -> the trader ticks a rule only they can confirm (EC-P6). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const s = await getSession(id, user.id);
  if (!s) return NextResponse.json({ error: "Session ended." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { itemKey?: string; confirmed?: boolean };
  if (!(await confirmByTrader(s, String(body.itemKey ?? ""), body.confirmed === true))) {
    return NextResponse.json({ error: "That rule isn't one you confirm yourself." }, { status: 400 });
  }
  return NextResponse.json(await sessionView(s));
}
