/** Chat persistence helpers (PRD 9.3 chats / chat_messages). */
import { db, now, uuid } from "./db";
import { loadDraft, type DraftState, type Rule } from "./edge-builder";

export type Purpose = "build_edge" | "update_edge" | "review_trade";

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

export function getChat(chatId: string, userId: string): ChatRow | null {
  return (
    (db.prepare("SELECT * FROM chats WHERE id = ? AND user_id = ?").get(chatId, userId) as unknown as
      | ChatRow
      | undefined) ?? null
  );
}

/**
 * The trader's chats, newest first. Chats that produced a checklist carry its
 * name, rule counts (active version if approved, else the draft) and status.
 */
export function listChats(userId: string) {
  return db
    .prepare(
      `SELECT c.id, c.purpose, c.title, c.edge_id, c.updated_at,
              e.name AS edge_name,
              av.version_number AS approved_version,
              (SELECT COUNT(*) FROM checklist_items i
                 WHERE i.version_id = COALESCE(e.active_version_id,
                   (SELECT v.id FROM edge_versions v WHERE v.edge_id = e.id ORDER BY v.version_number DESC LIMIT 1))
              ) AS rule_count,
              (SELECT COUNT(*) FROM checklist_items i
                 WHERE i.hard_gate = 1 AND i.version_id = COALESCE(e.active_version_id,
                   (SELECT v.id FROM edge_versions v WHERE v.edge_id = e.id ORDER BY v.version_number DESC LIMIT 1))
              ) AS hard_count
       FROM chats c
       LEFT JOIN edges e ON e.id = c.edge_id
       LEFT JOIN edge_versions av ON av.id = e.active_version_id
       WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 100`
    )
    .all(userId);
}

export function createChat(userId: string, purpose: Purpose = "build_edge"): ChatRow {
  const id = uuid();
  const ts = now();
  db.prepare(
    "INSERT INTO chats (id, user_id, purpose, edge_id, title, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
  ).run(id, userId, purpose, ts, ts);
  return getChat(id, userId) as ChatRow;
}

export function addMessage(
  chatId: string,
  m: { role: Message["role"]; kind?: Message["kind"]; content: string; payload?: ChecklistPayload | null; viaVoice?: boolean }
): Message {
  const id = uuid();
  const ts = now();
  db.prepare(
    `INSERT INTO chat_messages (id, chat_id, role, kind, content, payload_json, via_voice, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    chatId,
    m.role,
    m.kind ?? "text",
    m.content,
    m.payload ? JSON.stringify(m.payload) : null,
    m.viaVoice ? 1 : 0,
    ts
  );
  db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(ts, chatId);
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

export function listMessages(chatId: string): Message[] {
  const rows = db
    .prepare(
      `SELECT id, role, kind, content, payload_json, via_voice, created_at
       FROM chat_messages WHERE chat_id = ? ORDER BY created_at, rowid`
    )
    .all(chatId) as Array<{
    id: string;
    role: Message["role"];
    kind: Message["kind"];
    content: string;
    payload_json: string | null;
    via_voice: number;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    kind: r.kind,
    content: r.content,
    payload: r.payload_json ? (JSON.parse(r.payload_json) as ChecklistPayload) : null,
    via_voice: r.via_voice === 1,
    created_at: r.created_at,
  }));
}

/** Everything the chat screen needs in one payload. */
export function chatView(chat: ChatRow): {
  chat: ChatRow;
  messages: Message[];
  draft: DraftState | null;
  openQuestions: string[];
} {
  const messages = listMessages(chat.id);
  const draft = chat.edge_id ? loadDraft(chat.edge_id) : null;
  const lastChecklist = [...messages].reverse().find((m) => m.kind === "checklist");
  return { chat, messages, draft, openQuestions: lastChecklist?.payload?.questions ?? [] };
}
