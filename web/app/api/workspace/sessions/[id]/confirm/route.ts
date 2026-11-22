import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { confirmByTrader, getSession, sessionView } from "@/lib/workspace-session";

/**
 * POST { itemKey, answer: "yes" | "no" | "clear" } -> the trader's answer for a
 * rule only they can judge (EC-P6). `confirmed: boolean` (yes / clear) is still
 * accepted from older pages.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const s = await getSession(id, user.id);
  if (!s) return NextResponse.json({ error: "Session ended." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { itemKey?: string; answer?: string; confirmed?: boolean };
  const answer =
    body.answer === "yes" || body.answer === "no" || body.answer === "clear"
      ? body.answer
      : body.confirmed === true
        ? "yes"
        : "clear";
  if (!(await confirmByTrader(s, String(body.itemKey ?? ""), answer))) {
    return NextResponse.json({ error: "That rule isn't one you answer yourself." }, { status: 400 });
  }
  return NextResponse.json(await sessionView(s));
}
