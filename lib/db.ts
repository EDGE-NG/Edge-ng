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
  // eslint-disable-next-line no-var
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
  ]);
}

function createDb(): DatabaseSync {
  // The DB must live OUTSIDE the project tree: Turbopack watches the project,
  // and SQLite's WAL writes would trigger a Fast Refresh reload loop.
  const dir = path.dirname(
    process.env.EDGE_DB_PATH || path.join(os.tmpdir(), "edge-fe", "edge.db")
  );
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(process.env.EDGE_DB_PATH || path.join(dir, "edge.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  ensureColumns(db);
  return db;
}

export const db: DatabaseSync = globalThis.__edgeDb ?? (globalThis.__edgeDb = createDb());

export function uuid(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
