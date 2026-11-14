import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { addMessage, chatView, getChat } from "@/lib/chats";
import { ApproveError, approveDraft, loadDraft } from "@/lib/edge-builder";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * POST -> the trader approves the draft checklist (PRD F2 step 5, PR-CL-3).
 * Approval is always the trader's explicit action; the version becomes
 * immutable and a fresh draft opens for future edits.
 */
export async function POST(_req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const chat = await getChat(id, user.id);
  if (!chat?.edge_id) return NextResponse.json({ error: "No checklist to approve yet" }, { status: 404 });
  const draft = await loadDraft(chat.edge_id);
  if (!draft) return NextResponse.json({ error: "No open draft" }, { status: 409 });
  if (!draft.dirty) {
    return NextResponse.json({ error: "Nothing has changed since you approved it." }, { status: 409 });
  }

  try {
    const { approvedVersionNumber } = await approveDraft(draft.edgeId, draft.versionId);
    const hard = draft.items.filter((r) => r.hard_gate).length;
    await addMessage(chat, {
      role: "edge",
      kind: "text",
      content:
        `Approved. "${draft.edgeName}" v${approvedVersionNumber} is now your active checklist: ` +
        `${draft.items.length} rule${draft.items.length === 1 ? "" : "s"}, ${hard} hard gate${hard === 1 ? "" : "s"}. ` +
        `Next, show me what each rule looks like on a chart: add 1 to 6 example images per rule so I can check it at the gate.`,
    });
  } catch (err) {
    if (err instanceof ApproveError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  return NextResponse.json(await chatView((await getChat(id, user.id))!));
}
