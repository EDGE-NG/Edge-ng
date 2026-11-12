import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createChat, listChats } from "@/lib/chats";

/** GET -> the trader's chats, newest first (sidebar). */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ user: { name: user.name, email: user.email }, chats: listChats(user.id) });
}

/** POST -> a new, empty "build an edge" chat (PR-CH-1, PR-CH-5). */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ chat: createChat(user.id, "build_edge") }, { status: 201 });
}
