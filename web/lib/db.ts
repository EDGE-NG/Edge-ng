import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  timezone TEXT DEFAULT 'UTC',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  active_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_versions (
  id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source_text TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES edge_versions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  hard_gate INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS visual_references (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  image_key TEXT NOT NULL,
  polarity TEXT NOT NULL DEFAULT 'positive',
  explanation TEXT,
  ai_interpretation TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edge_version_id TEXT NOT NULL REFERENCES edge_versions(id),
  instrument TEXT NOT NULL,
  direction TEXT,
  context_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  overall TEXT,
  summary TEXT,
  missing_evidence TEXT,
  override_reason TEXT,
  overridden_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS review_evidence (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES trade_reviews(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  timeframe TEXT,
  provenance TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_results (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES trade_reviews(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES checklist_items(id) ON DELETE SET NULL,
  verdict TEXT NOT NULL,
  evidence TEXT,
  explanation TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_id TEXT REFERENCES trade_reviews(id) ON DELETE SET NULL,
  instrument TEXT NOT NULL,
  direction TEXT,
  entry_price REAL,
  exit_price REAL,
  opened_at TEXT,
  closed_at TEXT,
  pnl REAL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE,
  review_id TEXT REFERENCES trade_reviews(id) ON DELETE SET NULL,
  summary TEXT,
  compliance_json TEXT,
  execution_quality TEXT,
  strengths TEXT,
  deviations TEXT,
  lessons TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  feature TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- PRD 9.3 "Chat and plan": every chat has a purpose and (once rules are
-- extracted) the edge it is building.
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'build_edge',
  edge_id TEXT REFERENCES edges(id) ON DELETE SET NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_user_updated ON chats(user_id, updated_at DESC);

-- kind: text | checklist | error. payload_json holds the checklist snapshot
-- (rules + clarifying questions) an Edge reply showed at that moment.
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  payload_json TEXT,
  via_voice INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages(chat_id, created_at);

-- PRD 4.3 / 9.3 Evidence: 1 to 6 chart images per rule, attached to
-- (edge, item_key) so they survive checklist revisions. Replaced and archived
-- images are kept (status) so past decisions keep what they used (PR-EV-6).
CREATE TABLE IF NOT EXISTS evidence_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  polarity TEXT NOT NULL,              -- valid | invalid
  status TEXT NOT NULL,                -- uploaded | interpreted | confirmed | replaced | archived
  object_key TEXT NOT NULL,            -- file name in the evidence store
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  trader_note TEXT,
  interpretation_text TEXT,            -- what Edge reads in the image for this rule
  interpretation_json TEXT,            -- structured reading (timeframe, instrument, features, flags)
  interpretation_confirmed_at TEXT,
  corrected INTEGER NOT NULL DEFAULT 0, -- 1 when the trader rewrote Edge's reading
  supersedes_id TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS evidence_rule ON evidence_images(edge_id, item_key, status);

-- PRD 5.3 rule card: Edge's stored reading of a rule, rebuilt whenever its
-- confirmed images change; supplied as context at comparison time.
CREATE TABLE IF NOT EXISTS rule_cards (
  edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  card_version INTEGER NOT NULL,
  valid_summary TEXT,
  invalid_summary TEXT,
  coverage_json TEXT,
  source_image_ids TEXT,
  built_at TEXT NOT NULL,
  PRIMARY KEY (edge_id, item_key)
);

-- PRD 4.4 / 4.5 / 9.3 Trade workspace and pre-trade gate.
CREATE TABLE IF NOT EXISTS workspace_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  checklist_version_id TEXT NOT NULL,   -- the version checks run against (EC-P10)
  instrument TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  platform TEXT,
  risk_params_json TEXT,                -- risk limits read from the risk rules, checked in code
  started_at TEXT NOT NULL,
  ended_at TEXT
);

-- A captured chart view: Edge-rendered frame + the metadata and candles behind it.
CREATE TABLE IF NOT EXISTS chart_frames (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source TEXT NOT NULL,                 -- edge_chart | data_render | tab_capture | user_capture
  visible_from INTEGER,
  visible_to INTEGER,
  indicators_json TEXT,
  object_key TEXT,
  candles_json TEXT NOT NULL,           -- market snapshot used for grounding
  data_as_of INTEGER,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chart_frames_session ON chart_frames(session_id, timeframe, captured_at DESC);

CREATE TABLE IF NOT EXISTS rule_checks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  frame_id TEXT,
  result TEXT NOT NULL,                 -- pass | fail | inconclusive
  observed_facts TEXT,
  reasoning TEXT,
  confidence TEXT,                      -- high | medium | low
  evidence_json TEXT,                   -- frame, candle range, reference image ids
  missing_evidence TEXT,
  is_hard_gate INTEGER NOT NULL,
  source TEXT NOT NULL,                 -- llm | code | trader
  model TEXT,
  checked_at TEXT NOT NULL,
  stale_after TEXT
);
CREATE INDEX IF NOT EXISTS rule_checks_session ON rule_checks(session_id, item_key, checked_at DESC);

CREATE TABLE IF NOT EXISTS trade_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  side TEXT NOT NULL,                   -- buy | sell
  entry_price REAL NOT NULL,
  stop_price REAL,
  target_price REAL,
  account_size REAL,
  risk_amount REAL,
  risk_pct REAL,
  risk_reward REAL,
  status TEXT NOT NULL,                 -- decided | expired | cancelled | placed
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_decisions (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES trade_intents(id) ON DELETE CASCADE,
  checklist_version_id TEXT NOT NULL,
  result TEXT NOT NULL,                 -- approved | denied | needs_evidence
  reasons_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,          -- rules, checks, frames, ticket, model versions (REQ-GT-5)
  reference_price REAL,
  price_tolerance REAL,
  valid_until TEXT,
  decided_at TEXT NOT NULL,
  resolution TEXT,                      -- accepted_denial | overridden | expired | placed | cancelled
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS overrides (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES gate_decisions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rules_overridden_json TEXT NOT NULL,
  reason_text TEXT,
  created_at TEXT NOT NULL
);

-- PRD F1 step 3: the disclaimer the trader accepted, by version and time.
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
`;

declare global {
  var __edgeDb: DatabaseSync | undefined;
}

/**
 * Add columns introduced after a table was first created. SQLite has no
 * ADD COLUMN IF NOT EXISTS, so we inspect PRAGMA table_info first.
 */
function ensureColumns(database: DatabaseSync): void {
  const ensure = (table: string, add: Array<[string, string]>) => {
    const have = new Set(
      (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    for (const [name, type] of add) {
      if (!have.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  };
  ensure("visual_references", [
    ["confirmed_interpretation", "TEXT"], // trader-confirmed (or corrected) interpretation
    ["confirmed_at", "TEXT"],
    ["superseded_by", "TEXT"], // replaced references keep their history
    ["replaced_at", "TEXT"],
  ]);
  ensure("users", [
    ["settings_json", "TEXT"], // notification preferences + account settings (PRD 4.8)
    ["password_hash", "TEXT"], // scrypt hash (PRD REQ-ID-1); null for email-code/demo accounts
    ["last_login_at", "TEXT"],
  ]);
  // PRD 5.2: every extracted rule keeps the exact words it came from, how it
  // can be checked, and which timeframe it needs.
  ensure("checklist_items", [
    ["source_span", "TEXT"],
    ["assessability", "TEXT"], // chart | context_needed | manual
    ["required_timeframe", "TEXT"],
    ["item_key", "TEXT"], // stable across versions (PRD 9.3)
  ]);
  database.exec("UPDATE checklist_items SET item_key = id WHERE item_key IS NULL");
  database.exec("CREATE INDEX IF NOT EXISTS checklist_items_key ON checklist_items(item_key)");
}

function createDb(): DatabaseSync {
  // `next build` loads the API routes in several workers at once. Each opening the
  // same file made builds fail at random with "database is locked", and a build
  // never needs real data, so each build worker gets its own in-memory database.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    const buildDb = new DatabaseSync(":memory:");
    buildDb.exec("PRAGMA foreign_keys = ON;");
    buildDb.exec(SCHEMA);
    ensureColumns(buildDb);
    return buildDb;
  }

  // The DB must live OUTSIDE the project tree: Turbopack watches the project,
  // and SQLite's WAL writes would trigger a Fast Refresh reload loop.
  const dir = path.dirname(
    process.env.EDGE_DB_PATH || path.join(os.tmpdir(), "edge-fe", "edge.db")
  );
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(process.env.EDGE_DB_PATH || path.join(dir, "edge.db"));
  // Wait for a lock (up to 10 s) instead of failing straight away.
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  ensureColumns(db);
  return db;
}

export const db: DatabaseSync = globalThis.__edgeDb ?? (globalThis.__edgeDb = createDb());
// The connection is cached across dev hot reloads, so apply the (idempotent)
// schema again whenever this module reloads: new tables/columns appear
// without restarting the server.
if (globalThis.__edgeDb && process.env.NODE_ENV !== "production") {
  db.exec(SCHEMA);
  ensureColumns(db);
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
