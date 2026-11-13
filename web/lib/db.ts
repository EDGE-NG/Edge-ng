/**
 * Database access: Supabase Postgres (tables in supabase/migrations/).
 *
 * Server only. Connects with DATABASE_URL (Supabase → Connect → Transaction
 * pooler). Row-level security protects the tables from browser access; this
 * server connection bypasses it, so every query here must filter by the
 * signed-in user's id, exactly like the old SQLite code did.
 *
 * Queries keep the `?` placeholder style; they are turned into $1, $2, ...
 */
import postgres from "postgres";

declare global {
  var __edgeSql: postgres.Sql | undefined;
}

function createSql(): postgres.Sql {
  return postgres(process.env.DATABASE_URL ?? "", {
    // Supabase's transaction pooler (port 6543) does not support prepared
    // statements, and older Supavisor versions hang on pipelined queries.
    prepare: false,
    max_pipeline: 1,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    // Return values the way the app expects them: numbers, and ISO date strings.
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      timestamptz: {
        to: 1184,
        from: [1184, 1114],
        serialize: (x: unknown) => (x instanceof Date ? x.toISOString() : String(x)),
        parse: (x: string) => new Date(x.includes("T") || x.includes("+") ? x : x + "Z").toISOString(),
      },
    },
    onnotice: () => {},
  });
}

/** One shared pool per server process (also across dev hot reloads). */
export const sql: postgres.Sql = globalThis.__edgeSql ?? (globalThis.__edgeSql = createSql());

/** Turn `?` placeholders into `$1, $2, ...`, skipping anything inside quotes. */
export function toPg(text: string): string {
  let n = 0;
  let out = "";
  let quote: string | null = null;
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = null;
      out += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      out += c;
    } else if (c === "?") {
      out += `$${++n}`;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * A query value. For json/jsonb columns pass the object itself (not
 * JSON.stringify): the driver encodes it, and a string would be stored as a
 * JSON string. Arrays work for uuid[] / text[] columns.
 */
type Param = unknown;

export interface Db {
  /** First row, or undefined. */
  one<T = Record<string, unknown>>(text: string, ...params: Param[]): Promise<T | undefined>;
  /** All rows. */
  all<T = Record<string, unknown>>(text: string, ...params: Param[]): Promise<T[]>;
  /** Run a statement; returns the number of rows it changed. */
  run(text: string, ...params: Param[]): Promise<number>;
  /** Run several statements in one transaction (all or nothing). */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

function wrap(conn: postgres.Sql | postgres.TransactionSql): Db {
  const exec = (text: string, params: Param[]) =>
    conn.unsafe(toPg(text), params.map((p) => (p === undefined ? null : p)) as postgres.ParameterOrJSON<never>[]);
  return {
    async one(text, ...params) {
      const rows = await exec(text, params);
      return rows[0] as never;
    },
    async all(text, ...params) {
      return (await exec(text, params)) as never;
    },
    async run(text, ...params) {
      return (await exec(text, params)).count;
    },
    tx(fn) {
      return (conn as postgres.Sql).begin((t) => fn(wrap(t))) as Promise<never>;
    },
  };
}

export const db: Db = wrap(sql);

/** JSON columns come back parsed; older rows or text columns may still be strings. */
export function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
