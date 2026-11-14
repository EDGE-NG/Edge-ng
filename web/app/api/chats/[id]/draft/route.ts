import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { chatView, getChat } from "@/lib/chats";
import { ASSESSABILITY, CATEGORIES, loadDraft } from "@/lib/edge-builder";

interface Params {
  params: Promise<{ id: string }>;
}

interface ItemPatch {
  id: string;
  text?: string;
  category?: string;
  hard_gate?: boolean;
  assessability?: string;
  required_timeframe?: string | null;
}

/**
 * PATCH { items: ItemPatch[] } -> direct edits to the open draft (PR-CL-2):
 * edit wording, change category, flip hard gate / soft, reorder, or delete
 * (an existing rule missing from the list is removed). Edits keep each rule's
 * source span; new rules come through the chat so they can be quoted.
 */
export async function PATCH(req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const chat = await getChat(id, user.id);
  if (!chat?.edge_id) return NextResponse.json({ error: "No checklist in this chat yet" }, { status: 404 });
  const draft = await loadDraft(chat.edge_id);
  if (!draft) return NextResponse.json({ error: "No open draft" }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { items?: ItemPatch[] };
  if (!Array.isArray(body.items)) return NextResponse.json({ error: "items required" }, { status: 400 });

  const known = new Map(draft.items.map((r) => [r.id!, r]));
  const keep = body.items.filter((p) => p && known.has(p.id));

  await db.tx(async (t) => {
    const kept = new Set(keep.map((p) => p.id));
    for (const r of draft.items) {
      if (!kept.has(r.id!)) await t.run("DELETE FROM checklist_items WHERE id = ? AND version_id = ?", r.id!, draft.versionId);
    }
    for (const [i, p] of keep.entries()) {
      const cur = known.get(p.id)!;
      const text = typeof p.text === "string" && p.text.trim() ? p.text.trim().slice(0, 240) : cur.text;
      const category = CATEGORIES.includes(p.category as never) ? p.category! : cur.category;
      const assess = ASSESSABILITY.includes(p.assessability as never) ? p.assessability! : cur.assessability;
      const tf =
        p.required_timeframe === undefined
          ? cur.required_timeframe
          : (p.required_timeframe ?? "").trim().slice(0, 12) || null;
      const hard = typeof p.hard_gate === "boolean" ? p.hard_gate : cur.hard_gate;
      await t.run(
        `UPDATE checklist_items SET title = ?, category = ?, severity = ?, assessability = ?,
           required_timeframe = ?, position = ? WHERE id = ? AND version_id = ?`,
        text,
        category,
        hard ? "hard_gate" : "soft",
        assess,
        tf,
        i,
        p.id,
        draft.versionId
      );
    }
    await t.run("UPDATE checklists SET updated_at = now() WHERE id = ?", draft.edgeId);
  });
  return NextResponse.json(await chatView((await getChat(id, user.id))!));
}
