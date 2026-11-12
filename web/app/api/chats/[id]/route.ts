import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { chatView, getChat } from "@/lib/chats";

interface Params {
  params: Promise<{ id: string }>;
}

/** GET -> chat, messages, the live draft checklist and open questions. */
export async function GET(_req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const chat = getChat(id, user.id);
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json(chatView(chat));
}

/**
 * DELETE -> remove the chat transcript. The edge it built (and its approved
 * versions) stays: checklists are archived, never deleted with a chat (EC-P11).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const res = db.prepare("DELETE FROM chats WHERE id = ? AND user_id = ?").run(id, user.id);
  if (res.changes === 0) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
