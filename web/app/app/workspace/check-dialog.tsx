"use client";

/**
 * The pre-trade check, rule by rule (PR-GT-1, PR-GT-2; flow by Daniel,
 * 2026-11-21). Pressing Buy or Sell opens this popup:
 *  1. rules only the trader can judge are asked here (Yes / No);
 *  2. Edge runs the gate. All checks run at once on the server; fresh ones
 *     from the warm-up are reused, so it usually answers in about a second;
 *  3. each rule ticks or crosses in checklist order, then the result:
 *     Passes your checklist (Place this trade), or Fails / Needs more
 *     evidence (Accept, or Override while the weekly allowance lasts).
 * Code decides; the popup only shows the decision (PR-GT-7).
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Cross, STATUS_TEXT, STATUS_TONE, StatusDot, Tick, type DotState } from "./marks";
import { TF_LABEL, timeframeOf, type Decision, type OverrideAllowance, type RuleView, type TicketDraft, type Timeframe, type View } from "./types";

const REVEAL_MS = 110;

/** The reset time in the trader's own time zone, e.g. "Sun 23 Nov, 23:00". */
function resetWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

type Phase = "ask" | "checking" | "error";

export default function CheckDialog({
  view,
  side,
  draft,
  platform,
  instLabel,
  decimals,
  tf,
  capture,
  onClose,
  onView,
  onShowTf,
}: {
  view: View;
  side: "buy" | "sell";
  draft: TicketDraft;
  platform: string;
  instLabel: string;
  decimals: number;
  tf: Timeframe;
  capture: () => { image: string } | null;
  onClose: () => void;
  onView: (v: View) => void;
  onShowTf: (t: Timeframe) => void;
}) {
  // rules the trader answers here: every one not already confirmed in the panel in the last 15 minutes
  const [questions] = useState(() => view.rules.filter((r) => r.mode === "trader" && !(r.status === "pass" && !r.stale)).map((r) => r.itemKey));
  const [answers, setAnswers] = useState<Record<string, "yes" | "no">>({});
  const [phase, setPhase] = useState<Phase>(() => (questions.length ? "ask" : "checking"));
  const [decision, setDecision] = useState<Decision | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const requested = useRef(false);
  const idem = useRef(crypto.randomUUID());
  const closeRef = useRef<HTMLButtonElement>(null);

  const asking = phase === "ask" ? questions.find((k) => !answers[k]) ?? null : null;

  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function answer(itemKey: string, a: "yes" | "no") {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/workspace/sessions/${view.session.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey, answer: a }),
      });
      if (!res.ok) throw new Error("Couldn't save your answer.");
      onView(await res.json());
      const next = { ...answers, [itemKey]: a };
      setAnswers(next);
      if (questions.every((k) => next[k])) setPhase("checking");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your answer.");
    } finally {
      setSaving(false);
    }
  }

  // run the gate once every question is answered
  useEffect(() => {
    if (phase !== "checking" || requested.current) return;
    requested.current = true;
    const started = performance.now();
    (async () => {
      try {
        const shot = capture();
        const res = await fetch(`/api/workspace/sessions/${view.session.id}/intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            side,
            entry: draft.entry,
            stop: draft.stop,
            target: draft.target,
            accountSize: draft.accountSize,
            riskAmount: draft.riskAmount,
            orderType: draft.orderType,
            size: draft.size,
            sizeUnit: draft.sizeUnit,
            platform: platform || null,
            timeframe: tf,
            image: shot?.image,
            idempotencyKey: idem.current,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Edge couldn't check this trade.");
        setElapsed((performance.now() - started) / 1000);
        setDecision(d as Decision);
        // refresh the rules panel with the gate's fresh checks
        const v = await fetch("/api/workspace/sessions").then((r) => r.json()).catch(() => null);
        if (v?.view) onView(v.view);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Edge couldn't check this trade.");
        setPhase("error");
      }
    })();
  }, [phase, capture, draft, platform, side, tf, view.session.id, onView]);

  // tick the rules off in checklist order once the decision is in
  useEffect(() => {
    if (!decision) return;
    const total = view.rules.length;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      setRevealed(n);
      if (n >= total) clearInterval(t);
    }, REVEAL_MS);
    return () => clearInterval(t);
  }, [decision, view.rules.length]);
  const finished = decision != null && revealed >= view.rules.length;

  const results = new Map((decision?.rules ?? []).map((r) => [r.itemKey, r]));
  const doneCount = decision ? revealed : Object.keys(answers).length;
  const line = `${side === "buy" ? "Buy" : "Sell"}${draft.size != null ? ` ${draft.size} ${draft.sizeUnit ?? ""}` : ""} ${instLabel}${
    draft.entry != null ? ` at ${draft.entry.toFixed(decimals)}` : ""
  }${draft.stop != null ? ` · SL ${draft.stop.toFixed(decimals)}` : ""}${draft.target != null ? ` · TP ${draft.target.toFixed(decimals)}` : ""}`;

  function stateOf(r: RuleView, i: number): { dot: DotState; label: string; note: string | null } {
    if (r.mode === "trader" && answers[r.itemKey]) {
      const yes = answers[r.itemKey] === "yes";
      return { dot: yes ? "pass" : "fail", label: yes ? "Yes" : "No", note: null };
    }
    if (r.itemKey === asking) return { dot: "ask", label: STATUS_TEXT.ask, note: null };
    if (decision && i < revealed) {
      const res = results.get(r.itemKey);
      const s = (res?.status ?? "unchecked") as DotState;
      const showNote = s !== "pass" || r.mode === "session" || r.mode === "code";
      return { dot: s, label: s === "unchecked" ? "Not checked" : STATUS_TEXT[s], note: showNote ? res?.reason || null : null };
    }
    if (phase === "checking" || decision) {
      const label = r.mode === "session" ? "Checking the clock…" : r.mode === "code" ? "Checking your ticket…" : r.timeframe ? `Checking ${TF_LABEL[r.timeframe]}…` : "Checking…";
      return { dot: "checking", label, note: null };
    }
    return { dot: "unchecked", label: "Waiting", note: null };
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="check-title"
        className="max-h-full w-full max-w-[520px] overflow-auto rounded-[20px] border border-line bg-[linear-gradient(180deg,var(--color-card-a),var(--color-card-b))] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-start justify-between gap-3 px-[22px] pt-5 pb-1">
          <div>
            <h2 id="check-title" className="text-[17px] font-semibold tracking-tight">
              Checking your{" "}
              <span className={`rounded-md px-2 py-px text-xs font-semibold align-[1px] ${side === "buy" ? "bg-accent/12 text-accent" : "bg-fail/12 text-fail"}`}>
                {side === "buy" ? "↗ Buy" : "↘ Sell"}
              </span>{" "}
              against your rules
            </h2>
            <p className="mt-1 text-[13px] text-muted tabular-nums">{line}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:text-ink">
            <Cross className="h-4 w-4" />
          </button>
        </div>

        <div className="mx-[22px] mt-2.5 mb-1 flex items-center gap-2.5 text-xs text-muted" aria-live="polite">
          <span>{finished ? (elapsed != null ? `Checked in ${elapsed.toFixed(1)} s` : "Checked") : phase === "ask" ? "A quick question first" : "Checking rule by rule"}</span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-panel">
            <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(doneCount / Math.max(1, view.rules.length)) * 100}%` }} />
          </span>
          <span className="tabular-nums">
            {doneCount} of {view.rules.length}
          </span>
        </div>

        <ul className="divide-y divide-line px-[22px]">
          {view.rules.map((r, i) => {
            const st = stateOf(r, i);
            return (
              <li key={r.itemKey}>
                <div className="flex items-center gap-3 py-3">
                  <StatusDot state={st.dot} />
                  <span className="min-w-0 flex-1 text-sm leading-snug text-ink/90">{r.text}</span>
                  <span className={`shrink-0 text-xs ${STATUS_TONE[st.dot]}`}>{st.label}</span>
                </div>
                {r.itemKey === asking && (
                  <div className="-mt-1 mb-3 ml-[30px] flex flex-wrap items-center gap-2 text-[13px]">
                    Is this met right now?
                    <button type="button" disabled={saving} onClick={() => answer(r.itemKey, "yes")} className="rounded-lg border border-accent/45 px-3 py-1 text-accent disabled:opacity-50">
                      Yes
                    </button>
                    <button type="button" disabled={saving} onClick={() => answer(r.itemKey, "no")} className="rounded-lg border border-line px-3 py-1 disabled:opacity-50">
                      No
                    </button>
                  </div>
                )}
                {st.note && <p className={`-mt-1.5 mb-3 ml-[30px] text-xs leading-snug ${st.dot === "fail" ? "text-fail" : "text-muted"}`}>{st.note}</p>}
              </li>
            );
          })}
        </ul>

        {error && (
          <div className="mx-[22px] mt-2 rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail" role="alert">
            {error}
            {phase === "error" && (
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => {
                  requested.current = false;
                  idem.current = crypto.randomUUID();
                  setError("");
                  setPhase("checking");
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}

        {finished && decision && (
          <Outcome
            decision={decision}
            platform={platform}
            side={side}
            draft={draft}
            instLabel={instLabel}
            decimals={decimals}
            currentTf={tf}
            onShowTf={(t) => {
              onClose();
              onShowTf(t);
            }}
          />
        )}

        <p className="mt-4 border-t border-line px-[22px] pt-3 pb-[18px] text-xs text-muted">
          Edge says whether a trade passes your checklist. It never predicts whether a trade will win.
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ outcome ---- */

/** What the trader's platform reported for an order Edge sent (broker connections, next step). */
interface Execution {
  status: "placed" | "rejected";
  platform: string;
  orderId: string | null;
  summary?: string | null;
  /** Demo: Edge acted as if it placed the order; nothing reached the platform. */
  simulated?: boolean;
}

/**
 * Until accounts can be connected, Edge acts as if it placed the order
 * (decision, Daniel, 2026-11-26) so the full flow can be shown. It is always
 * labelled Demo: Edge never tells a trader a real order exists when it doesn't.
 */
function simulateOrder(platform: string, side: "buy" | "sell", draft: TicketDraft, instLabel: string, decimals: number): Execution {
  const id = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000;
  const kind =
    draft.orderType === "market" ? "" : draft.orderType === "limit" ? " limit" : draft.orderType === "stop_limit" ? " stop limit" : " stop";
  const size = draft.size != null ? `${draft.size} ${draft.sizeUnit === "lots" ? "lots " : ""}` : "";
  const unit = draft.sizeUnit && draft.sizeUnit !== "lots" ? ` ${draft.sizeUnit}` : "";
  const at = draft.entry != null ? draft.entry.toFixed(decimals) : "market";
  const what = `${side === "buy" ? "Buy" : "Sell"}${kind} ${size}${instLabel}${unit}`;
  return {
    status: "placed",
    platform: platform || "platform",
    orderId: String(id).padStart(8, "0"),
    summary: draft.orderType === "market" ? `${what}, filled at ${at}` : `${what} at ${at}, waiting to fill`,
    simulated: true,
  };
}

/**
 * After "Place this trade". When the platform confirms the order, the trader
 * sees it named: "Your trade has been placed on your MT5 / Binance / ...".
 * Until accounts can be connected no order is sent, so Edge says what really
 * happened (the trade is recorded) instead of claiming a placed order.
 */
function Placed({ approved, platform, execution }: { approved: boolean; platform: string; execution: Execution | null }) {
  const placedOnPlatform = execution?.status === "placed";
  const box = approved ? "border-accent/45 bg-pass-bg" : "border-maybe/45 bg-warn-bg";
  const tone = approved ? "text-accent" : "text-maybe";
  const seal = approved ? "bg-accent" : "bg-maybe";
  return (
    <div className={`grid gap-1.5 rounded-[14px] border p-4 ${box}`} role="status">
      <p className={`flex items-center gap-2.5 text-base font-semibold ${tone}`}>
        <span className={`grid h-7 w-7 place-items-center rounded-full text-bg ${seal}`} aria-hidden>
          <Tick className="h-3.5 w-3.5" />
        </span>
        {approved ? "Your checklist has all passed" : "Override recorded"}
      </p>
      {placedOnPlatform ? (
        <>
          <p className="text-[13px] leading-relaxed text-ink/85">
            {execution?.simulated && (
              <span className="mr-1.5 rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] font-medium text-muted">Demo</span>
            )}
            Your trade has been placed on your {platform}.{approved ? "" : " It's in your journal as an override."}
          </p>
          <p className="text-xs text-muted tabular-nums">
            {execution?.summary ? `${execution.summary} · ` : ""}
            {execution?.orderId ? `Order #${execution.orderId}` : ""}
          </p>
          {execution?.simulated && (
            <p className="text-xs text-muted">
              Demo order: Edge isn&apos;t connected to your {platform} yet, so nothing was sent. Place it on your {platform} yourself.
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-ink/85">
          Your trade is recorded in your journal{approved ? "" : " as an override"}. Edge places it on your {platform || "platform"} once your
          account is connected.
        </p>
      )}
    </div>
  );
}

function Outcome({
  decision,
  platform,
  side,
  draft,
  instLabel,
  decimals,
  currentTf,
  onShowTf,
}: {
  decision: Decision;
  platform: string;
  side: "buy" | "sell";
  draft: TicketDraft;
  instLabel: string;
  decimals: number;
  currentTf: Timeframe;
  onShowTf: (t: Timeframe) => void;
}) {
  const [left, setLeft] = useState(() => (decision.validUntil ? Math.max(0, Math.round((Date.parse(decision.validUntil) - Date.now()) / 1000)) : 0));
  const [resolution, setResolution] = useState<string | null>(decision.resolution);
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [allowance, setAllowance] = useState<OverrideAllowance | null>(decision.overrides ?? null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const noOverridesLeft = allowance != null && allowance.left === 0;

  useEffect(() => {
    if (!decision.validUntil || resolution) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.round((Date.parse(decision.validUntil!) - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [decision.validUntil, resolution]);

  async function act(action: "accept" | "override" | "placed" | "cancel") {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/workspace/decisions/${decision.decisionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.overrides) setAllowance(d.overrides);
      if (d.execution) setExecution(d.execution as Execution);
      // No connected account yet: act as if the order was placed, labelled Demo.
      else if (res.ok && action === "placed") setExecution(simulateOrder(platform, side, draft, instLabel, decimals));
      if (!res.ok) {
        setMsg(d.error || "Couldn't save that.");
        if (d.code === "expired" || d.code === "price_moved") setResolution("expired");
        if (d.code === "override_limit") setOverriding(false);
        return;
      }
      setResolution(d.resolution);
    } finally {
      setBusy(false);
    }
  }

  const r = decision.reasons;
  const expired = decision.result === "approved" && left === 0 && !resolution;
  const head =
    decision.result === "approved"
      ? { title: "Passes your checklist", box: "border-accent/45 bg-pass-bg", tone: "text-accent", seal: "bg-accent", mark: <Tick className="h-4 w-4" /> }
      : decision.result === "denied"
        ? { title: "Fails your checklist", box: "border-fail/45 bg-err-bg", tone: "text-fail", seal: "bg-fail", mark: <Cross className="h-4 w-4" /> }
        : { title: "Needs more evidence", box: "border-maybe/45 bg-warn-bg", tone: "text-maybe", seal: "bg-maybe", mark: <span className="text-sm font-bold">?</span> };
  const failingNames = r.failing.map((f) => f.text);
  const btn = "inline-flex h-10 items-center rounded-full border border-line px-4 text-sm font-medium transition hover:bg-panel disabled:opacity-50";
  const main = "inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-50";

  return (
    <div className="px-[22px] pt-2">
      <div className={`grid gap-1 rounded-[14px] border p-4 ${head.box}`}>
        <p className={`flex items-center gap-2.5 text-[17px] font-semibold ${head.tone}`}>
          <span className={`grid h-[30px] w-[30px] place-items-center rounded-full text-bg ${head.seal}`} aria-hidden>
            {head.mark}
          </span>
          {head.title}
        </p>
        <p className="text-[13px] leading-relaxed text-ink/85">
          {decision.result === "approved"
            ? expired || resolution === "expired"
              ? "This approval expired. Press Buy or Sell again to re-check."
              : <>Every rule passes. This approval is valid for <b className="tabular-nums">{left}s</b>.</>
            : decision.result === "denied"
              ? r.ticket.length && !failingNames.length
                ? "Your ticket doesn't match your plan."
                : `${failingNames.length === 1 ? "1 rule fails" : `${failingNames.length} rules fail`}${failingNames.length ? `: ${failingNames.join(", ")}.` : "."}`
              : "Edge couldn't confirm every hard-gate rule."}
        </p>
      </div>

      {/* what to fix: ticket problems, data problems, and views Edge still needs */}
      {(r.ticket.length > 0 || r.cannotCheck || r.missing.length > 0) && (
        <ul className="mt-3 space-y-2 text-[13px]">
          {r.cannotCheck && <li className="text-maybe">Edge can&apos;t check right now: {r.cannotCheck}</li>}
          {r.ticket.map((x) => (
            <li key={x} className="text-fail">✕ {x}</li>
          ))}
          {r.missing.map((f) => {
            const t = timeframeOf(f.timeframe);
            const wantsExample = /example/i.test(f.reason);
            return (
              <li key={f.itemKey}>
                <span className="text-maybe">? {f.text}</span>
                <span className="block text-ink/70">{f.reason}</span>
                {f.mode === "chart" && !wantsExample && t && t !== currentTf && (
                  <button type="button" className="chip-btn mt-1 py-1 text-xs" onClick={() => onShowTf(t)}>
                    Show the {TF_LABEL[t]} chart
                  </button>
                )}
                {wantsExample && (
                  <Link href="/app/evidence" className="chip-btn mt-1 py-1 text-xs">
                    Add an example
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        {resolution === "placed" ? (
          <Placed approved={decision.result === "approved"} platform={execution?.platform || platform} execution={execution} />
        ) : resolution === "accepted_denial" ? (
          <p className="text-sm text-ink/80">Not taken. That decision is recorded in your journal.</p>
        ) : resolution === "cancelled" ? (
          <p className="text-sm text-ink/80">Not taken. That decision is recorded.</p>
        ) : resolution === "expired" || expired ? null : decision.result === "approved" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button className={main} disabled={busy} onClick={() => act("placed")}>Place this trade</button>
              <button className={btn} disabled={busy} onClick={() => act("cancel")}>Don&apos;t trade</button>
            </div>
          </div>
        ) : resolution === "overridden" ? (
          <div className="space-y-2">
            <p className="text-sm text-maybe">Override recorded. You can still place this trade.</p>
            <button className={main} disabled={busy} onClick={() => act("placed")}>Place this trade</button>
            {allowance && <p className="text-xs text-muted">{allowance.left} of {allowance.limit} overrides left this week.</p>}
          </div>
        ) : overriding && !noOverridesLeft ? (
          <div className="space-y-2">
            <label className="block text-[13px] text-ink/80">
              Why are you overriding? <span className="text-muted">(optional)</span>
              <input className="input mt-1 py-2 text-sm" value={reason} maxLength={500} onChange={(x) => setReason(x.target.value)} />
            </label>
            {allowance && (
              <p className="text-xs text-muted">
                This uses 1 of your {allowance.left} override{allowance.left === 1 ? "" : "s"} left this week, and covers every rule that didn&apos;t pass.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button className={`${btn} border-fail/50 text-fail`} disabled={busy} onClick={() => act("override")}>Override and record it</button>
              <button className={btn} onClick={() => setOverriding(false)}>Back</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button className={main} disabled={busy} onClick={() => act("accept")}>Accept, don&apos;t trade</button>
              {!noOverridesLeft && (
                <button className={btn} disabled={busy} aria-describedby="override-allowance" onClick={() => setOverriding(true)}>
                  Override
                </button>
              )}
            </div>
            {allowance && (
              <p id="override-allowance" className="text-xs text-muted">
                {noOverridesLeft
                  ? `You've used all ${allowance.limit} overrides this week, so you can't override this one. They reset when the new market week opens (${resetWhen(allowance.resetsAt)}).`
                  : `${allowance.left} of ${allowance.limit} overrides left this week. Resets ${resetWhen(allowance.resetsAt)}.`}
              </p>
            )}
          </div>
        )}
        {msg && <p role="alert" className="mt-2 text-sm text-fail">{msg}</p>}
      </div>
    </div>
  );
}
