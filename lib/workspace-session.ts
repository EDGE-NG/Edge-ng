/** Workspace sessions: state for the live checklist panel, and frame processing. */
import { db, now, uuid } from "./db";
import { loadItems, type Rule } from "./edge-builder";
import { activeImages, saveFile } from "./evidence";
import {
  dataAgeSeconds,
  findInstrument,
  getCandles,
  indicatorsFromRules,
  type IndicatorSpec,
  type Timeframe,
} from "./market";
import {
  CHECK_STALE_MS,
  checkChartRule,
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

export interface SessionRow {
  id: string;
  user_id: string;
  edge_id: string;
  checklist_version_id: string;
  instrument: string;
  asset_class: string;
  platform: string | null;
  risk_params_json: string | null;
  started_at: string;
}

export function getSession(id: string, userId: string): SessionRow | null {
  return (
    (db.prepare("SELECT * FROM workspace_sessions WHERE id = ? AND user_id = ? AND ended_at IS NULL").get(id, userId) as unknown as
      | SessionRow
      | undefined) ?? null
  );
}

export function sessionRules(s: SessionRow): { rules: Rule[]; risk: RiskParams; indicators: IndicatorSpec[] } {
  const rules = loadItems(s.checklist_version_id);
  const risk = s.risk_params_json ? (JSON.parse(s.risk_params_json) as RiskParams) : parseRiskParams(rules);
  return { rules, risk, indicators: indicatorsFromRules(rules.map((r) => r.text)) };
}

/** Rule states for the panel / gate. Code rules need a ticket (else "unchecked"). */
export function ruleStates(s: SessionRow, codeChecks?: Map<string, Check>): RuleState[] {
  const { rules, risk } = sessionRules(s);
  const latest = latestChecks(s.id);
  const t = Date.now();
  return rules.map((rule) => {
    const mode = ruleMode(rule, risk);
    const check = mode === "code" ? codeChecks?.get(rule.item_key!) ?? null : latest.get(rule.item_key!) ?? null;
    const stale = Boolean(check && mode === "chart" && t - Date.parse(check.checkedAt) > CHECK_STALE_MS);
    let status: RuleState["status"] = check ? check.result : "unchecked";
    if (mode === "trader" && check?.result !== "pass") status = "unchecked";
    if (stale) status = "unchecked";
    return { rule, mode, check, status, stale };
  });
}

/** What the client panel shows. */
export function sessionView(s: SessionRow) {
  const { risk, indicators } = sessionRules(s);
  const states = ruleStates(s);
  const examples = new Map<string, number>();
  for (const img of activeImages(s.edge_id)) {
    if (img.confirmed) examples.set(img.item_key, (examples.get(img.item_key) ?? 0) + 1);
  }
  const edge = db.prepare("SELECT name FROM edges WHERE id = ?").get(s.edge_id) as { name: string } | undefined;
  const version = db.prepare("SELECT version_number FROM edge_versions WHERE id = ?").get(s.checklist_version_id) as
    | { version_number: number }
    | undefined;
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

export function startSession(userId: string, edgeId: string, instrument: string, platform: string | null): SessionRow {
  const edge = db.prepare("SELECT id, active_version_id FROM edges WHERE id = ? AND user_id = ?").get(edgeId, userId) as
    | { id: string; active_version_id: string | null }
    | undefined;
  if (!edge?.active_version_id) throw new Error("no_active_checklist");
  const inst = findInstrument(instrument);
  if (!inst) throw new Error("unknown_instrument");
  // one open session per trader: a new instrument starts fresh (EC: instrument changed)
  db.prepare("UPDATE workspace_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL").run(now(), userId);
  const id = uuid();
  const rules = loadItems(edge.active_version_id);
  db.prepare(
    `INSERT INTO workspace_sessions (id, user_id, edge_id, checklist_version_id, instrument, asset_class, platform, risk_params_json, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, edgeId, edge.active_version_id, inst.symbol, inst.assetClass, platform, JSON.stringify(parseRiskParams(rules)), now());
  return getSession(id, userId)!;
}

/**
 * A captured chart view: store it with the server's own candles (the
 * grounding snapshot), then re-check only the chart rules this view can
 * answer (REQ-LLM-6). Unchanged views reuse the last results.
 */
export async function processFrame(
  s: SessionRow,
  args: { timeframe: Timeframe; image: Buffer | null; visibleFrom?: number; visibleTo?: number; ticket?: Ticket | null; force?: boolean }
): Promise<{ frameId: string; dataAge: number; reused: boolean }> {
  const inst = findInstrument(s.instrument)!;
  const candles = await getCandles(inst, args.timeframe, 300);
  const last = candles[candles.length - 1];
  const { rules, risk, indicators } = sessionRules(s);

  // skip unchanged frames (PRD 5.7 cost control)
  const prev = db
    .prepare(
      `SELECT id, data_as_of, captured_at, candles_json FROM chart_frames
       WHERE session_id = ? AND timeframe = ? ORDER BY captured_at DESC LIMIT 1`
    )
    .get(s.id, args.timeframe) as { id: string; data_as_of: number; captured_at: string; candles_json: string } | undefined;
  if (!args.force && prev && Date.now() - Date.parse(prev.captured_at) < 60_000) {
    const prevLast = (JSON.parse(prev.candles_json) as Array<{ time: number; close: number }>).at(-1);
    if (prevLast && prevLast.time === last.time && prevLast.close === last.close) {
      return { frameId: prev.id, dataAge: dataAgeSeconds(candles, args.timeframe), reused: true };
    }
  }

  const frameId = uuid();
  const objectKey = args.image ? saveFile(s.user_id, `frame-${frameId}`, "image/png", args.image) : null;
  db.prepare(
    `INSERT INTO chart_frames (id, session_id, instrument, timeframe, source, visible_from, visible_to, indicators_json,
       object_key, candles_json, data_as_of, captured_at)
     VALUES (?, ?, ?, ?, 'edge_chart', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    frameId,
    s.id,
    s.instrument,
    args.timeframe,
    args.visibleFrom ?? null,
    args.visibleTo ?? null,
    JSON.stringify(indicators),
    objectKey,
    JSON.stringify(candles.slice(-120)),
    last.time,
    now()
  );

  // only the chart rules this timeframe can answer; the rest keep their last result
  const targets = rules.filter((r) => {
    if (ruleMode(r, risk) !== "chart") return false;
    const need = normalizeTimeframe(r.required_timeframe);
    return !need || need === args.timeframe;
  });
  const checks = await Promise.all(
    targets.map((rule) =>
      checkChartRule({
        userId: s.user_id,
        edgeId: s.edge_id,
        rule,
        frame: { id: frameId, timeframe: args.timeframe, image: args.image, candles, indicators, decimals: inst.decimals },
        ticket: args.ticket ?? null,
      })
    )
  );
  checks.forEach((c, i) => saveCheck(s.id, c, targets[i].hard_gate, "vision"));
  return { frameId, dataAge: dataAgeSeconds(candles, args.timeframe), reused: false };
}

/** Trader confirmation for rules only they can confirm (EC-P6). */
export function confirmByTrader(s: SessionRow, itemKey: string, confirmed: boolean) {
  const { rules, risk } = sessionRules(s);
  const rule = rules.find((r) => r.item_key === itemKey);
  if (!rule || ruleMode(rule, risk) !== "trader") return false;
  saveCheck(
    s.id,
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
export function tradesToday(userId: string): number {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM gate_decisions d JOIN trade_intents i ON i.id = d.intent_id
       WHERE i.user_id = ? AND d.resolution = 'placed' AND d.resolved_at >= ?`
    )
    .get(userId, start.toISOString()) as { n: number };
  return row.n;
}
