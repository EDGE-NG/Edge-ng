/** Chat persistence helpers (PRD 9.3 chats / chat_messages). */
import { db, json, now, uuid } from "./db";
import { loadDraft, type DraftState, type Rule } from "./edge-builder";

export type Purpose = "build_edge" | "update_edge" | "review_trade";

/** A chat as the screens use it. `edge_id` is the checklist the chat built. */
export interface ChatRow {
  id: string;
  user_id: string;
  purpose: Purpose;
  edge_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistPayload {
  rules: Rule[];
  questions: string[];
  versionNumber: number;
  rejected: number;
}

export interface Message {
  id: string;
  role: "trader" | "edge";
  kind: "text" | "checklist" | "error";
  content: string;
  payload: ChecklistPayload | null;
  via_voice: boolean;
  created_at: string;
}

const CHAT_COLS = `id, user_id, purpose, checklist_id AS edge_id, title, created_at, updated_at`;

export async function getChat(chatId: string, userId: string): Promise<ChatRow | null> {
  return (
    (await db.one<ChatRow>(
      `SELECT ${CHAT_COLS} FROM chats WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      chatId,
      userId
    )) ?? null
  );
}

/**
 * The trader's chats, newest first. Chats that produced a checklist carry its
 * name, rule counts (active version if approved, else the draft) and status.
 */
export async function listChats(userId: string) {
  const rows = await db.all<Record<string, unknown>>(
    `WITH shown AS (
       SELECT c.id, c.purpose, c.title, c.checklist_id, c.updated_at,
              e.name AS edge_name,
              av.version_number AS approved_version,
              COALESCE(e.active_version_id,
                (SELECT v.id FROM checklist_versions v WHERE v.checklist_id = e.id
                 ORDER BY v.version_number DESC LIMIT 1)) AS shown_version
       FROM chats c
       LEFT JOIN checklists e ON e.id = c.checklist_id
       LEFT JOIN checklist_versions av ON av.id = e.active_version_id
       WHERE c.user_id = ? AND c.deleted_at IS NULL
       ORDER BY c.updated_at DESC LIMIT 100
     )
     SELECT s.id, s.purpose, s.title, s.checklist_id AS edge_id, s.updated_at, s.edge_name, s.approved_version,
            (SELECT COUNT(*) FROM checklist_items i WHERE i.version_id = s.shown_version) AS rule_count,
            (SELECT COUNT(*) FROM checklist_items i
               WHERE i.version_id = s.shown_version AND i.severity = 'hard_gate') AS hard_count
     FROM shown s ORDER BY s.updated_at DESC`,
    userId
  );
  return rows;
}

export async function createChat(userId: string, purpose: Purpose = "build_edge"): Promise<ChatRow> {
  const id = uuid();
  await db.run(`INSERT INTO chats (id, user_id, purpose) VALUES (?, ?, ?)`, id, userId, purpose);
  return (await getChat(id, userId)) as ChatRow;
}

export async function addMessage(
  chat: { id: string; user_id: string },
  m: { role: Message["role"]; kind?: Message["kind"]; content: string; payload?: ChecklistPayload | null; viaVoice?: boolean }
): Promise<Message> {
  const id = uuid();
  const ts = now();
  await db.tx(async (t) => {
    await t.run(
      `INSERT INTO chat_messages (id, chat_id, user_id, role, kind, content, payload, via_voice, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      chat.id,
      chat.user_id,
      m.role,
      m.kind ?? "text",
      m.content,
      m.payload ?? null,
      Boolean(m.viaVoice),
      ts
    );
    await t.run("UPDATE chats SET updated_at = ? WHERE id = ?", ts, chat.id);
  });
  return {
    id,
    role: m.role,
    kind: m.kind ?? "text",
    content: m.content,
    payload: m.payload ?? null,
    via_voice: Boolean(m.viaVoice),
    created_at: ts,
  };
}

export async function listMessages(chatId: string): Promise<Message[]> {
  const rows = await db.all<{
    id: string;
    role: Message["role"];
    kind: Message["kind"];
    content: string | null;
    payload: unknown;
    via_voice: boolean;
    created_at: string;
  }>(
    `SELECT id, role, kind, content, payload, via_voice, created_at
     FROM chat_messages WHERE chat_id = ? ORDER BY created_at, id`,
    chatId
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    kind: r.kind,
    content: r.content ?? "",
    payload: json<ChecklistPayload | null>(r.payload, null),
    via_voice: r.via_voice === true,
    created_at: r.created_at,
  }));
}

/** Everything the chat screen needs in one payload. */
export async function chatView(chat: ChatRow): Promise<{
  chat: ChatRow;
  messages: Message[];
  draft: DraftState | null;
  openQuestions: string[];
}> {
  const messages = await listMessages(chat.id);
  const draft = chat.edge_id ? await loadDraft(chat.edge_id) : null;
  const lastChecklist = [...messages].reverse().find((m) => m.kind === "checklist");
  return { chat, messages, draft, openQuestions: lastChecklist?.payload?.questions ?? [] };
}
