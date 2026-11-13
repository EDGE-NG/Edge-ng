import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addMessage, chatView, getChat, listMessages } from "@/lib/chats";
import {
  MAX_MESSAGE_CHARS,
  buildFromConversation,
  createEdgeWithDraft,
  loadDraft,
  replaceDraftItems,
} from "@/lib/edge-builder";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * POST { content, viaVoice? } -> the trader says something in the chat;
 * Edge replies with the extracted / revised checklist, a clarifying question,
 * or a request for more detail (PRD F2, PR-CH-3/4, PR-CL-2).
 */
export async function POST(req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const chat = await getChat(id, user.id);
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { content?: string; viaVoice?: boolean; retry?: boolean };
  const content = String(body.content ?? "").trim();

  // A retry re-runs the AI on the conversation so far without adding a message.
  if (!body.retry) {
    if (!content) return NextResponse.json({ error: "Write or record your plan first." }, { status: 400 });
    if (content.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        {
          error: `That's ${content.length.toLocaleString()} characters; the limit is ${MAX_MESSAGE_CHARS.toLocaleString()}. Split it into two messages.`,
        },
        { status: 413 }
      );
    }
    await addMessage(chat, { role: "trader", content, viaVoice: Boolean(body.viaVoice) });
    if (!chat.title) {
      await db.run("UPDATE chats SET title = ? WHERE id = ?", content.replace(/\s+/g, " ").slice(0, 60), chat.id);
    }
  }

  const traderMessages = (await listMessages(chat.id)).filter((m) => m.role === "trader").map((m) => m.content);
  if (traderMessages.length === 0) {
    return NextResponse.json({ error: "Nothing to read yet." }, { status: 400 });
  }
  const draft = chat.edge_id ? await loadDraft(chat.edge_id) : null;

  let result;
  try {
    result = await buildFromConversation({
      userId: user.id,
      traderMessages,
      current: draft?.items ?? [],
    });
  } catch (err) {
    // EC-P9: the input is saved; say so and offer a retry. Never fail silently.
    console.error("[chat] plan extraction failed:", err);
    await addMessage(chat, {
      role: "edge",
      kind: "error",
      content:
        "I couldn't read your plan just now (the AI service didn't respond). Your message is saved, so nothing is lost. Try again in a moment.",
    });
    return NextResponse.json(await chatView((await getChat(chat.id, user.id))!), { status: 502 });
  }

  const sourceText = traderMessages.join("\n\n");
  const changesRules = (result.intent === "extract" || result.intent === "revise") && result.rules.length > 0;

  if (changesRules) {
    let versionNumber = draft?.versionNumber ?? 1;
    if (!chat.edge_id || !draft) {
      const edgeId = await createEdgeWithDraft(user.id, result.name ?? "My edge", sourceText, result.rules);
      await db.run(
        "UPDATE chats SET checklist_id = ?, title = COALESCE(?, title) WHERE id = ?",
        edgeId,
        result.name,
        chat.id
      );
      versionNumber = 1;
    } else {
      await replaceDraftItems(draft.versionId, sourceText, result.rules);
      await db.run("UPDATE checklists SET updated_at = now() WHERE id = ?", draft.edgeId);
    }
    if (result.rejected > 0) {
      console.warn(`[chat ${chat.id}] dropped ${result.rejected} ungrounded rule(s) (no source span)`);
    }
    await addMessage(chat, {
      role: "edge",
      kind: "checklist",
      content: result.reply,
      payload: { rules: result.rules, questions: result.questions, versionNumber, rejected: result.rejected },
    });
  } else {
    // need_more / clarify (or an extraction that found nothing grounded)
    const reply =
      (result.intent === "extract" || result.intent === "revise") && result.rules.length === 0
        ? "I couldn't find a rule I could quote back to you yet. Tell me what you need to see before you enter, where your stop goes and how much you risk."
        : result.reply;
    await addMessage(chat, {
      role: "edge",
      kind: "text",
      content: [reply, ...result.questions.filter((q) => !reply.includes(q))].join("\n\n"),
    });
  }

  return NextResponse.json(await chatView((await getChat(chat.id, user.id))!));
}
