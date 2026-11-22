/**
 * Checklist alerts: Edge watches instruments with the trader's approved
 * checklist while they are away from the screen, and tells them when the
 * chart rules pass.
 *
 * How a monitor run works (all decisions in code, PRD 5.7):
 *  1. The monitor's chart rules are grouped by timeframe (a rule's own
 *     timeframe, else the monitor's). A timeframe is re-checked once per new
 *     candle, from the server's candles (PRD 5.4 source B), with the same
 *     rule check the workspace uses, so a rule without a confirmed example
 *     can't pass (PR-CL-5) and an AI failure is never a pass (REQ-LLM-2).
 *  2. Only the hard-gate chart rules decide (all chart rules if none is a
 *     hard gate). Higher timeframes go first and the run stops at the first
 *     failing rule, which keeps AI calls down.
 *  3. When they all pass and didn't on the last run, an alert is stored and
 *     sent. One alert per setup, with a cooldown so an on/off flicker
 *     doesn't spam the trader.
 *
 * An alert never approves a trade. Risk rules need a ticket, and rules only
 * the trader can confirm stay with them: the trader opens the workspace and
 * the gate decides as usual. Alert wording says the chart rules pass the
 * trader's checklist; it never predicts (PR-GT-8).
 */
import { db, json, now, uuid } from "./db";
import { loadItems, type Rule } from "./edge-builder";
import { activeImages } from "./evidence";
import { dataAgeSeconds, findInstrument, getCandles, MarketError, type Timeframe } from "./market";
import { appUrl, notifyUser } from "./notify";
import { evaluateSessionRule, latestChecks, normalizeTimeframe, parseRiskParams, ruleMode, type Result, type RiskParams } from "./workspace";
import { processFrame, type SessionRow } from "./workspace-session";

/** Instruments one trader can watch at once (AI and market-data cost). */
export const MAX_MONITORS = Math.max(1, Number(process.env.ALERTS_MAX_MONITORS ?? 3));
/** No second alert for the same monitor within this window. */
export const ALERT_COOLDOWN_MS = 60 * 60_000;
/** Timeframes a monitor can use for rules that don't name one (1m is too noisy and costly). */
export const MONITOR_TIMEFRAMES: Timeframe[] = ["5m", "15m", "30m", "1h", "4h", "1d"];
/** Seconds after a candle closes before checking, so the data provider has it. */
const READY_DELAY_S = 20;
const RETRY_S = 120;

export const TF_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

export interface MonitorRow {
  id: string;
  user_id: string;
  checklist_id: string;
  instrument: string;
  asset_class: string;
  timeframe: Timeframe;
  status: "active" | "paused";
  session_id: string | null;
  last_state: "unknown" | "met" | "not_met";
  last_summary: unknown;
  checked_periods: unknown;
  last_checked_at: string | null;
  next_check_at: string;
  last_alert_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface RuleSummary {
  itemKey: string;
  text: string;
  hardGate: boolean;
  timeframe: Timeframe;
  /** pass | fail | inconclusive | unchecked (not checked this candle, or skipped after an earlier fail) */
  status: Result | "unchecked";
  reasoning: string;
  checkedAt: string | null;
  confirmedExamples: number;
}

export interface MonitorSummary {
  edgeName: string;
  versionNumber: number | null;
  lastPrice: number | null;
  /** The rules that decide the alert. */
  watched: RuleSummary[];
  /** Hard-gate rules only the trader can confirm (news, session, feel...). */
  traderRules: string[];
  /** Risk rules checked from the ticket in the workspace. */
  riskRules: string[];
  /** Why this run couldn't check everything (market closed, data limit...). */
  notes: string[];
}

/* -------------------------------------------------------------- plan ---- */

export interface WatchPlan {
  watched: Rule[];
  traderRules: Rule[];
  riskRules: Rule[];
  /** Hard-gate session rules ("during the London session"), checked from the clock. */
  sessionRules: Rule[];
  tfOf: (r: Rule) => Timeframe;
  /** Timeframes to check, highest first. */
  timeframes: Timeframe[];
}

export function watchPlan(rules: Rule[], risk: RiskParams, baseTf: Timeframe): WatchPlan {
  const chart = rules.filter((r) => ruleMode(r, risk) === "chart");
  const hard = chart.filter((r) => r.hard_gate);
  const watched = hard.length ? hard : chart;
  const tfOf = (r: Rule) => normalizeTimeframe(r.required_timeframe) ?? baseTf;
  const timeframes = [...new Set(watched.map(tfOf))].sort((a, b) => TF_SECONDS[b] - TF_SECONDS[a]);
  return {
    watched,
    traderRules: rules.filter((r) => r.hard_gate && ruleMode(r, risk) === "trader"),
    riskRules: rules.filter((r) => ruleMode(r, risk) === "code"),
    sessionRules: rules.filter((r) => r.hard_gate && ruleMode(r, risk) === "session"),
    tfOf,
    timeframes,
  };
}

/** Index of the candle period containing `atSec` (candles are UTC-aligned). */
export function periodOf(tf: Timeframe, atSec: number): number {
  return Math.floor(atSec / TF_SECONDS[tf]);
}

/** When the next candle on any of these timeframes closes, plus a short delay. */
export function nextCheckAt(timeframes: Timeframe[], atSec: number): number {
  const next = Math.min(...timeframes.map((tf) => (periodOf(tf, atSec) + 1) * TF_SECONDS[tf]));
  return Math.max(next + READY_DELAY_S, atSec + 60);
}

/* ----------------------------------------------------------- sessions --- */

const SESSION_COLS = `id, user_id, checklist_id AS edge_id, checklist_version_id, instrument, asset_class,
  platform, risk_params, started_at`;

/**
 * The monitor's background session for the checklist's current version. A new
 * approved version gets a new session, so old checks never count for it.
 */
async function monitorSession(m: MonitorRow, versionId: string, rules: Rule[]): Promise<SessionRow> {
  if (m.session_id) {
    const s = await db.one<SessionRow>(
      `SELECT ${SESSION_COLS} FROM workspace_sessions
       WHERE id = ? AND user_id = ? AND kind = 'monitor' AND ended_at IS NULL AND checklist_version_id = ?`,
      m.session_id,
      m.user_id,
      versionId
    );
    if (s) return s;
  }
  const id = uuid();
  await db.tx(async (t) => {
    if (m.session_id) {
      await t.run(
        "UPDATE workspace_sessions SET ended_at = now() WHERE id = ? AND user_id = ? AND ended_at IS NULL",
        m.session_id,
        m.user_id
      );
    }
    await t.run(
      `INSERT INTO workspace_sessions (id, user_id, checklist_id, checklist_version_id, instrument, asset_class, platform,
         risk_params, kind)
       VALUES (?, ?, ?, ?, ?, ?, 'edge-alerts', ?, 'monitor')`,
      id,
      m.user_id,
      m.checklist_id,
      versionId,
      m.instrument,
      m.asset_class,
      parseRiskParams(rules)
    );
    // checks from the old version don't count: start the candle bookkeeping over
    await t.run(
      "UPDATE checklist_monitors SET session_id = ?, checked_periods = '{}'::jsonb WHERE id = ? AND user_id = ?",
      id,
      m.id,
      m.user_id
    );
  });
  m.checked_periods = {};
  return (await db.one<SessionRow>(`SELECT ${SESSION_COLS} FROM workspace_sessions WHERE id = ? AND user_id = ?`, id, m.user_id))!;
}

/* ---------------------------------------------------------------- run ---- */

async function finish(
  m: MonitorRow,
  fields: {
    state?: MonitorRow["last_state"];
    summary?: MonitorSummary | null;
    periods?: Record<string, number>;
    nextAtSec: number;
    error: string | null;
    paused?: boolean;
    alerted?: boolean;
  }
) {
  await db.run(
    `UPDATE checklist_monitors SET
       last_state = coalesce(?, last_state),
       last_summary = coalesce(?::jsonb, last_summary),
       checked_periods = coalesce(?::jsonb, checked_periods),
       last_checked_at = ?,
       next_check_at = ?,
       last_error = ?,
       status = CASE WHEN ? THEN 'paused' ELSE status END,
       last_alert_at = CASE WHEN ? THEN now() ELSE last_alert_at END,
       updated_at = now()
     WHERE id = ? AND user_id = ?`,
    fields.state ?? null,
    fields.summary ?? null,
    fields.periods ?? null,
    now(),
    new Date(fields.nextAtSec * 1000).toISOString(),
    fields.error,
    Boolean(fields.paused),
    Boolean(fields.alerted),
    m.id,
    m.user_id
  );
}

export interface RunResult {
  monitorId: string;
  state: MonitorRow["last_state"];
  alerted: boolean;
  aiTimeframes: Timeframe[];
  error: string | null;
}

/**
 * Check one monitor now. `force` re-checks every timeframe even if no new
 * candle closed (the "Check now" button).
 */
export async function runMonitor(m: MonitorRow, opts: { force?: boolean } = {}): Promise<RunResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const out = (state: MonitorRow["last_state"], error: string | null, alerted = false, aiTimeframes: Timeframe[] = []) => ({
    monitorId: m.id,
    state,
    alerted,
    aiTimeframes,
    error,
  });

  const edge = await db.one<{ name: string; active_version_id: string | null }>(
    "SELECT name, active_version_id FROM checklists WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    m.checklist_id,
    m.user_id
  );
  const inst = findInstrument(m.instrument);
  if (!edge?.active_version_id || !inst) {
    const error = !inst ? "Edge no longer supports this instrument." : "This checklist has no approved version.";
    await finish(m, { state: "unknown", nextAtSec: nowSec + 3600, error, paused: true });
    return out("unknown", error);
  }
  const version = await db.one<{ version_number: number }>(
    "SELECT version_number FROM checklist_versions WHERE id = ? AND user_id = ?",
    edge.active_version_id,
    m.user_id
  );
  const rules = await loadItems(edge.active_version_id);
  const s = await monitorSession(m, edge.active_version_id, rules);
  const risk = json<RiskParams | null>(s.risk_params, null) ?? parseRiskParams(rules);
  const plan = watchPlan(rules, risk, m.timeframe);
  if (!plan.watched.length) {
    const error = "This checklist has no chart rules Edge can watch.";
    await finish(m, { state: "unknown", nextAtSec: nowSec + 3600, error, paused: true });
    return out("unknown", error);
  }

  const watchedKeys = new Set(plan.watched.map((r) => r.item_key!));
  const periods = { ...json<Record<string, number>>(m.checked_periods, {}) };
  const notes: string[] = [];
  const aiTimeframes: Timeframe[] = [];
  let dataProblem = false;
  let lastPrice: number | null = null;

  // session rules first, from the clock (no AI): outside the trader's session
  // the setup can't pass, so no chart check is spent and no alert is sent
  const sessionFails = plan.sessionRules
    .map((r) => evaluateSessionRule(r, m.asset_class))
    .filter((c) => c.result !== "pass");
  for (const c of sessionFails) notes.push(c.reasoning);

  const failingOn = async (tf: Timeframe) => {
    const latest = await latestChecks(s.id);
    return plan.watched.some((r) => plan.tfOf(r) === tf && latest.get(r.item_key!)?.result === "fail");
  };

  for (const tf of sessionFails.length ? [] : plan.timeframes) {
    const current = periodOf(tf, nowSec);
    if (opts.force || periods[tf] !== current) {
      try {
        const candles = await getCandles(inst, tf, 300);
        lastPrice = candles[candles.length - 1].close;
        // market closed (weekend, holiday) or delayed feed: don't spend an AI call on old data
        if (dataAgeSeconds(candles, tf) > TF_SECONDS[tf] + 15 * 60) {
          notes.push(`No new ${tf} prices (market closed or data delayed).`);
          dataProblem = true;
          break;
        }
        await processFrame(s, {
          timeframe: tf,
          image: null,
          force: true,
          ruleFilter: (r) => watchedKeys.has(r.item_key!) && plan.tfOf(r) === tf,
        });
        periods[tf] = current;
        aiTimeframes.push(tf);
      } catch (err) {
        dataProblem = true;
        notes.push(err instanceof MarketError ? err.message : `Edge couldn't check the ${tf} chart just now.`);
        if (!(err instanceof MarketError)) console.error(`[alerts] ${m.instrument} ${tf} check failed:`, err);
        break;
      }
    }
    // a failing rule on a higher timeframe already rules the setup out: skip the rest
    if (await failingOn(tf)) break;
  }

  // roll-up in code: a rule counts only if checked in this candle or the one before
  const latest = await latestChecks(s.id);
  const examples = new Map<string, number>();
  for (const img of await activeImages(s.edge_id)) {
    if (img.confirmed) examples.set(img.item_key, (examples.get(img.item_key) ?? 0) + 1);
  }
  const watched: RuleSummary[] = plan.watched.map((r) => {
    const tf = plan.tfOf(r);
    const c = latest.get(r.item_key!);
    const fresh = c && Date.parse(c.checkedAt) >= (periodOf(tf, nowSec) - 1) * TF_SECONDS[tf] * 1000;
    return {
      itemKey: r.item_key!,
      text: r.text,
      hardGate: r.hard_gate,
      timeframe: tf,
      status: c && fresh ? c.result : "unchecked",
      reasoning: c && fresh ? c.reasoning || c.missing || "" : "",
      checkedAt: c?.checkedAt ?? null,
      confirmedExamples: examples.get(r.item_key!) ?? 0,
    };
  });
  const met = sessionFails.length === 0 && watched.every((w) => w.status === "pass");
  const anyFail = sessionFails.length > 0 || watched.some((w) => w.status === "fail");
  // a data or AI problem with no failing rule leaves the last state as it was
  const state: MonitorRow["last_state"] = met ? "met" : anyFail || !dataProblem ? "not_met" : m.last_state;

  const summary: MonitorSummary = {
    edgeName: edge.name,
    versionNumber: version?.version_number ?? null,
    lastPrice,
    watched,
    traderRules: plan.traderRules.map((r) => r.text),
    riskRules: plan.riskRules.map((r) => r.text),
    notes,
  };

  const cooledDown = !m.last_alert_at || Date.now() - Date.parse(m.last_alert_at) > ALERT_COOLDOWN_MS;
  const alert = met && m.last_state !== "met" && cooledDown;
  const nextAtSec = dataProblem && !notes.some((n) => n.startsWith("No new")) ? nowSec + RETRY_S : nextCheckAt(plan.timeframes, nowSec);

  await finish(m, { state, summary, periods, nextAtSec, error: dataProblem ? notes.join(" ") : null, alerted: alert });
  if (alert) await createAlert(m, s, edge.active_version_id, summary);
  return out(state, dataProblem ? notes.join(" ") : null, alert, aiTimeframes);
}

/* -------------------------------------------------------------- alert ---- */

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function alertMessage(m: Pick<MonitorRow, "instrument" | "timeframe">, label: string, sm: MonitorSummary, eventId: string) {
  const n = sm.watched.length;
  const title = `${label}: passes your checklist's chart rules`;
  const body =
    `${sm.edgeName}: ${n === 1 ? "the chart rule passes" : `all ${n} chart rules pass`} on ${m.instrument}. ` +
    "Check the trade in Edge before you place it.";
  const path = `/app/alerts?event=${eventId}`;
  const link = appUrl(path);
  const ruleLines = sm.watched.map((w) => `✓ ${w.text} (${w.timeframe})${w.reasoning ? `: ${w.reasoning}` : ""}`);
  const still = [
    ...sm.traderRules.map((t) => `• ${t}`),
    ...(sm.riskRules.length ? ["• Your risk rules are checked from the ticket when you press Buy or Sell."] : []),
  ];
  const text = [
    `${label} now passes the chart rules of your checklist "${sm.edgeName}"${sm.versionNumber ? ` (v${sm.versionNumber})` : ""}.`,
    "",
    ...ruleLines,
    ...(still.length ? ["", "Still yours to check:", ...still] : []),
    "",
    `Open Edge to check the trade before placing it: ${link}`,
    "",
    "Edge checks your own checklist. It doesn't predict prices or recommend trades.",
  ].join("\n");
  const html =
    `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">` +
    `<p><strong>${esc(label)}</strong> now passes the chart rules of your checklist <strong>${esc(sm.edgeName)}</strong>` +
    `${sm.versionNumber ? ` (v${sm.versionNumber})` : ""}.</p><ul>` +
    sm.watched
      .map((w) => `<li>&#10003; ${esc(w.text)} <span style="color:#666">(${w.timeframe})</span>${w.reasoning ? `<br><span style="color:#444">${esc(w.reasoning)}</span>` : ""}</li>`)
      .join("") +
    `</ul>` +
    (still.length ? `<p><strong>Still yours to check:</strong></p><ul>${still.map((s) => `<li>${esc(s.slice(2))}</li>`).join("")}</ul>` : "") +
    `<p><a href="${esc(link)}" style="display:inline-block;background:#5ef088;color:#04110a;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Check the trade in Edge</a></p>` +
    `<p style="color:#666;font-size:12px">Edge checks your own checklist. It doesn't predict prices or recommend trades. ` +
    `<a href="${esc(appUrl("/app/alerts"))}">Manage alerts</a></p></div>`;
  return { title, body, path, text, html };
}

async function createAlert(m: MonitorRow, s: SessionRow, versionId: string, sm: MonitorSummary) {
  const inst = findInstrument(m.instrument);
  const label = `${inst?.label ?? m.instrument} ${m.timeframe}`;
  const id = uuid();
  await db.run(
    `INSERT INTO alert_events (id, user_id, monitor_id, checklist_id, checklist_version_id, session_id, instrument, timeframe,
       last_price, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    m.user_id,
    m.id,
    m.checklist_id,
    versionId,
    s.id,
    m.instrument,
    m.timeframe,
    sm.lastPrice,
    sm
  );
  const msg = alertMessage(m, label, sm, id);
  const deliveries = await notifyUser(m.user_id, {
    title: msg.title,
    body: msg.body,
    path: msg.path,
    tag: `edge-alert-${m.id}`,
    email: { subject: msg.title, text: msg.text, html: msg.html },
  });
  await db.run("UPDATE alert_events SET deliveries = ? WHERE id = ? AND user_id = ?", deliveries, id, m.user_id);
}

/* ---------------------------------------------------------- scheduler --- */

/**
 * Called by the scheduler (/api/alerts/run). Claims due monitors one at a
 * time (a 5-minute lease, so overlapping runs never check the same monitor)
 * until the time budget is used. This is a system job across all traders;
 * each monitor is then read and written with its own user id.
 */
export async function runDueMonitors(budgetMs: number): Promise<RunResult[]> {
  const started = Date.now();
  const results: RunResult[] = [];
  while (Date.now() - started < budgetMs) {
    const m = await db.one<MonitorRow>(
      `UPDATE checklist_monitors SET next_check_at = now() + interval '5 minutes'
       WHERE id = (
         SELECT id FROM checklist_monitors WHERE status = 'active' AND next_check_at <= now()
         ORDER BY next_check_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING *`
    );
    if (!m) break;
    try {
      results.push(await runMonitor(m));
    } catch (err) {
      console.error(`[alerts] monitor ${m.id} failed:`, err);
      // the lease above already pushed next_check_at out, so it retries later
      results.push({ monitorId: m.id, state: m.last_state, alerted: false, aiTimeframes: [], error: "run failed" });
    }
  }
  return results;
}

/* ------------------------------------------------------------- views ---- */

export async function getMonitor(id: string, userId: string): Promise<MonitorRow | null> {
  return (await db.one<MonitorRow>("SELECT * FROM checklist_monitors WHERE id = ? AND user_id = ?", id, userId)) ?? null;
}

export function monitorView(m: MonitorRow & { checklist_name?: string | null }) {
  const inst = findInstrument(m.instrument);
  return {
    id: m.id,
    edgeId: m.checklist_id,
    edgeName: m.checklist_name ?? null,
    instrument: m.instrument,
    label: inst?.label ?? m.instrument,
    timeframe: m.timeframe,
    status: m.status,
    state: m.last_state,
    summary: json<MonitorSummary | null>(m.last_summary, null),
    lastCheckedAt: m.last_checked_at,
    nextCheckAt: m.status === "active" ? m.next_check_at : null,
    lastAlertAt: m.last_alert_at,
    error: m.last_error,
  };
}
