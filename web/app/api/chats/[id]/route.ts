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
  const chat = await getChat(id, user.id);
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json(await chatView(chat));
}

/**
 * DELETE -> remove the chat from the trader's list. The edge it built (and its
 * approved versions) stays: checklists are archived, never deleted with a chat
 * (EC-P11). The chat is soft-deleted (PRD 9.2).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const changed = await db.run(
    "UPDATE chats SET deleted_at = now() WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    id,
    user.id
  );
  if (changed === 0) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
