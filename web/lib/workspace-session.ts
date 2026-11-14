/** Workspace sessions: state for the live checklist panel, and frame processing. */
import { db, json, now, uuid } from "./db";
import { loadItems, type Rule } from "./edge-builder";
import { activeImages, saveFile } from "./evidence";
import {
  dataAgeSeconds,
  findInstrument,
  getCandles,
  indicatorsFromRules,
  MarketError,
  type IndicatorSpec,
  type Timeframe,
} from "./market";
import { prepareForModel } from "./model-images";
import {
  CHECK_STALE_MS,
  checkChartRule,
  FRAME_MAX_AGE_MS,
  latestChecks,
  normalizeTimeframe,
  parseRiskParams,
  ruleMode,
  saveCheck,
  type Check,
  type RiskParams,
  type RuleState,
  type Ticket,
} from "./workspace";

/** A workspace session. `edge_id` is the checklist it runs against. */
export interface SessionRow {
  id: string;
  user_id: string;
  edge_id: string;
  checklist_version_id: string;
  instrument: string;
  asset_class: string;
  platform: string | null;
  risk_params: unknown;
  started_at: string;
}

const SESSION_COLS = `id, user_id, checklist_id AS edge_id, checklist_version_id, instrument, asset_class,
  platform, risk_params, started_at`;

export async function getSession(id: string, userId: string): Promise<SessionRow | null> {
  return (
    (await db.one<SessionRow>(
      `SELECT ${SESSION_COLS} FROM workspace_sessions WHERE id = ? AND user_id = ? AND ended_at IS NULL`,
      id,
      userId
    )) ?? null
  );
}

/** The trader's open session, if any. */
export async function openSession(userId: string): Promise<SessionRow | null> {
  return (
    (await db.one<SessionRow>(
      `SELECT ${SESSION_COLS} FROM workspace_sessions
       WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      userId
    )) ?? null
  );
}

export async function sessionRules(s: SessionRow): Promise<{ rules: Rule[]; risk: RiskParams; indicators: IndicatorSpec[] }> {
  const rules = await loadItems(s.checklist_version_id);
  const risk = json<RiskParams | null>(s.risk_params, null) ?? parseRiskParams(rules);
  return { rules, risk, indicators: indicatorsFromRules(rules.map((r) => r.text)) };
}

/**
 * Rule states for the panel / gate. Code rules need a ticket (else "unchecked").
 * `freshAfter` (epoch ms) is the gate's stricter cut-off: a chart check made
 * before it is stale and counts as unchecked (REQ-LLM-5). Without it, the
 * panel's display window applies.
 */
export async function ruleStates(
  s: SessionRow,
  codeChecks?: Map<string, Check>,
  opts: { freshAfter?: number } = {}
): Promise<RuleState[]> {
  const { rules, risk } = await sessionRules(s);
  const latest = await latestChecks(s.id);
  const cutoff = opts.freshAfter ?? Date.now() - CHECK_STALE_MS;
  return rules.map((rule) => {
    const mode = ruleMode(rule, risk);
    const check = mode === "code" ? codeChecks?.get(rule.item_key!) ?? null : latest.get(rule.item_key!) ?? null;
    const stale = Boolean(check && mode === "chart" && Date.parse(check.checkedAt) < cutoff);
    let status: RuleState["status"] = check ? check.result : "unchecked";
    if (mode === "trader" && check?.result !== "pass") status = "unchecked";
    if (stale) status = "unchecked";
    return { rule, mode, check, status, stale };
  });
}

/** What the client panel shows. */
export async function sessionView(s: SessionRow) {
  const { risk, indicators } = await sessionRules(s);
  const states = await ruleStates(s);
  const examples = new Map<string, number>();
  for (const img of await activeImages(s.edge_id)) {
    if (img.confirmed) examples.set(img.item_key, (examples.get(img.item_key) ?? 0) + 1);
  }
  const edge = await db.one<{ name: string }>("SELECT name FROM checklists WHERE id = ?", s.edge_id);
  const version = await db.one<{ version_number: number }>(
    "SELECT version_number FROM checklist_versions WHERE id = ?",
    s.checklist_version_id
  );
  return {
    session: {
      id: s.id,
      edgeId: s.edge_id,
      edgeName: edge?.name ?? "My edge",
      versionNumber: version?.version_number ?? null,
      instrument: s.instrument,
      platform: s.platform,
    },
    risk,
    indicators,
    rules: states.map((st) => ({
      itemKey: st.rule.item_key,
      text: st.rule.text,
      category: st.rule.category,
      hardGate: st.rule.hard_gate,
      mode: st.mode,
      requiredTimeframe: st.rule.required_timeframe,
      timeframe: normalizeTimeframe(st.rule.required_timeframe),
      confirmedExamples: examples.get(st.rule.item_key!) ?? 0,
      status: st.status,
      stale: st.stale,
      check: st.check,
    })),
  };
}

export async function startSession(userId: string, edgeId: string, instrument: string, platform: string | null): Promise<SessionRow> {
  const edge = await db.one<{ id: string; active_version_id: string | null }>(
    "SELECT id, active_version_id FROM checklists WHERE id = ? AND user_id = ?",
    edgeId,
    userId
  );
  if (!edge?.active_version_id) throw new Error("no_active_checklist");
  const inst = findInstrument(instrument);
  if (!inst) throw new Error("unknown_instrument");
  const id = uuid();
  const rules = await loadItems(edge.active_version_id);
  await db.tx(async (t) => {
    // one open session per trader: a new instrument starts fresh (EC: instrument changed)
    await t.run("UPDATE workspace_sessions SET ended_at = now() WHERE user_id = ? AND ended_at IS NULL", userId);
    await t.run(
      `INSERT INTO workspace_sessions (id, user_id, checklist_id, checklist_version_id, instrument, asset_class, platform, risk_params)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      edgeId,
      edge.active_version_id,
      inst.symbol,
      inst.assetClass,
      platform,
      parseRiskParams(rules)
    );
  });
  return (await getSession(id, userId))!;
}

/**
 * A captured chart view: store it with the server's own candles (the
 * grounding snapshot), then re-check only the chart rules this view can
 * answer (REQ-LLM-6). Unchanged views reuse the last results.
 */
export async function processFrame(
  s: SessionRow,
  args: {
    timeframe: Timeframe;
    /** PNG from Edge's own chart (source A); null = candle data only (source B). */
    image: Buffer | null;
    visibleFrom?: number;
    visibleTo?: number;
    ticket?: Ticket | null;
    force?: boolean;
    /** Reuse the last frame on this timeframe only if it is younger than this. */
    maxReuseMs?: number;
  }
): Promise<{ frameId: string; dataAge: number; reused: boolean }> {
  const inst = findInstrument(s.instrument)!;
  const candles = await getCandles(inst, args.timeframe, 300);
  const last = candles[candles.length - 1];
  const { rules, risk, indicators } = await sessionRules(s);

  // skip unchanged frames (PRD 5.7 cost control)
  const prev = await db.one<{ id: string; captured_at: string; candles: unknown }>(
    `SELECT id, captured_at, candles FROM chart_frames
     WHERE session_id = ? AND timeframe = ? ORDER BY captured_at DESC LIMIT 1`,
    s.id,
    args.timeframe
  );
  if (!args.force && prev && Date.now() - Date.parse(prev.captured_at) < (args.maxReuseMs ?? 60_000)) {
    const prevLast = json<Array<{ time: number; close: number }>>(prev.candles, []).at(-1);
    if (prevLast && prevLast.time === last.time && prevLast.close === last.close) {
      return { frameId: prev.id, dataAge: dataAgeSeconds(candles, args.timeframe), reused: true };
    }
  }

  const frameId = uuid();
  const objectKey = args.image ? await saveFile(s.user_id, `frame-${frameId}`, "image/png", args.image, "frames") : null;
  const epoch = (v: number | undefined) => (v ? new Date(v * 1000).toISOString() : null);
  await db.run(
    `INSERT INTO chart_frames (id, user_id, session_id, instrument, timeframe, source, visible_from, visible_to,
       indicators, object_key, candles, data_as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    frameId,
    s.user_id,
    s.id,
    s.instrument,
    args.timeframe,
    args.image ? "edge_chart" : "data_render", // PRD 5.4 source A (Edge's chart) or B (candles)
    epoch(args.visibleFrom),
    epoch(args.visibleTo),
    indicators,
    objectKey,
    candles.slice(-120),
    last.time
  );

  // only the chart rules this timeframe can answer; the rest keep their last result
  const targets = rules.filter((r) => {
    if (ruleMode(r, risk) !== "chart") return false;
    const need = normalizeTimeframe(r.required_timeframe);
    return !need || need === args.timeframe;
  });
  // downscale the live frame once for all rule checks (REQ-LLM-9); the stored
  // original above is kept for the audit snapshot
  const modelImage = args.image ? await prepareForModel(args.image, "image/png") : null;
  const checks = await Promise.all(
    targets.map((rule) =>
      checkChartRule({
        userId: s.user_id,
        edgeId: s.edge_id,
        rule,
        frame: { id: frameId, timeframe: args.timeframe, image: modelImage, candles, indicators, decimals: inst.decimals },
        ticket: args.ticket ?? null,
      })
    )
  );
  await Promise.all(checks.map((c, i) => saveCheck(s, c, targets[i].hard_gate, "vision")));
  return { frameId, dataAge: dataAgeSeconds(candles, args.timeframe), reused: false };
}

/** A little under the cut-off, so a reused frame's checks are never already stale. */
const GATE_REUSE_MS = FRAME_MAX_AGE_MS - 3_000;

/**
 * Fresh checks at the press of Buy / Sell (PRD 5.5 step 8, REQ-LLM-5).
 *
 * The view on screen is checked from its captured frame. Every hard-gate
 * chart rule that needs a different timeframe, and has no check younger than
 * FRAME_MAX_AGE_MS, is re-checked from the server's own candles for that
 * timeframe (source B), so the trader does not have to click through each
 * timeframe again. A timeframe whose data cannot be loaded leaves its rules
 * unchecked, which the roll-up turns into Needs evidence, never an approval.
 *
 * Returns the cut-off the roll-up must use, and any timeframes that failed.
 */
export async function refreshForGate(
  s: SessionRow,
  args: { timeframe: Timeframe; image: Buffer | null; ticket: Ticket }
): Promise<{ freshAfter: number; failed: Array<{ timeframe: string; message: string }> }> {
  const freshAfter = Date.now() - FRAME_MAX_AGE_MS;

  // 1. the view on screen (errors here are the caller's "cannot check")
  await processFrame(s, { timeframe: args.timeframe, image: args.image, ticket: args.ticket, maxReuseMs: GATE_REUSE_MS });

  // 2. hard-gate chart rules on other timeframes whose last check is too old
  const { rules, risk } = await sessionRules(s);
  const latest = await latestChecks(s.id);
  const needed = new Set<Timeframe>();
  for (const r of rules) {
    if (!r.hard_gate || ruleMode(r, risk) !== "chart") continue;
    const tf = normalizeTimeframe(r.required_timeframe);
    if (!tf || tf === args.timeframe) continue;
    const last = latest.get(r.item_key!);
    if (!last || Date.parse(last.checkedAt) < freshAfter) needed.add(tf);
  }

  const failed: Array<{ timeframe: string; message: string }> = [];
  await Promise.all(
    [...needed].map(async (tf) => {
      try {
        await processFrame(s, { timeframe: tf, image: null, ticket: args.ticket, maxReuseMs: GATE_REUSE_MS });
      } catch (err) {
        if (!(err instanceof MarketError)) console.error(`[gate] ${tf} re-check failed:`, err);
        failed.push({
          timeframe: tf,
          message: err instanceof MarketError ? err.message : "Edge couldn't load this timeframe.",
        });
      }
    })
  );
  return { freshAfter, failed };
}

/** Trader confirmation for rules only they can confirm (EC-P6). */
export async function confirmByTrader(s: SessionRow, itemKey: string, confirmed: boolean): Promise<boolean> {
  const { rules, risk } = await sessionRules(s);
  const rule = rules.find((r) => r.item_key === itemKey);
  if (!rule || ruleMode(rule, risk) !== "trader") return false;
  await saveCheck(
    s,
    {
      itemKey,
      result: confirmed ? "pass" : "inconclusive",
      observed: "",
      reasoning: confirmed ? "You confirmed this." : "Not confirmed yet.",
      confidence: null,
      missing: confirmed ? null : "your confirmation",
      source: "trader",
      timeframe: null,
      frameId: null,
      evidence: null,
      checkedAt: now(),
    },
    rule.hard_gate
  );
  return true;
}

/** Trades the trader confirmed placing today (UTC), for "max N trades a day". */
export async function tradesToday(userId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const row = await db.one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM gate_decisions d JOIN trade_intents i ON i.id = d.intent_id
     WHERE i.user_id = ? AND d.resolution = 'placed' AND d.resolved_at >= ?`,
    userId,
    start.toISOString()
  );
  return row?.n ?? 0;
}
