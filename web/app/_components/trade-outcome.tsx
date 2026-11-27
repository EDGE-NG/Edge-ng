"use client";

/**
 * A placed trade's outcome (Task D5; flow by Daniel, 2026-11-27).
 *
 * Edge watches the trade's stop loss and take profit. When the price reaches
 * one, the trader is alerted and confirms here how it ended: Profit, Loss or
 * Break even, with Edge's reading already chosen. Brokers' spreads differ, so
 * nothing is logged until they confirm. A trade closed early by hand is closed
 * here too, with the exit price. Edge works out R and the money itself.
 *
 * Results always show an icon and words, never colour alone (WCAG 2.2 AA).
 * Edge records the outcome; it doesn't judge the trade.
 */
import { useEffect, useId, useRef, useState } from "react";
import { IconTrendDown, IconTrendUp } from "./icons";
import { LEVEL_LABEL, NOTE_MAX, OUTCOME_LABEL, formatPnl, type OutcomeResult, type TradeView } from "@/lib/outcome";

const IconEven = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" className={className} aria-hidden>
    <path d="M5 9.5h14M5 14.5h14" />
  </svg>
);

const RESULT_ICON: Record<OutcomeResult, (p: { className?: string }) => React.ReactElement> = {
  win: IconTrendUp,
  loss: IconTrendDown,
  break_even: IconEven,
};

const RESULT_TONE: Record<OutcomeResult, string> = {
  win: "text-accent",
  loss: "text-fail",
  break_even: "text-ink/80",
};

const fmtPrice = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 5 });

/** A closed trade's outcome: icon, word, R and money, e.g. "↗ Profit +2R · +100.00 USD". */
export function OutcomeBadge({ trade }: { trade: TradeView }) {
  if (!trade.result) return null;
  const Icon = RESULT_ICON[trade.result];
  const parts = [
    trade.outcomeR != null ? `${trade.outcomeR > 0 ? "+" : ""}${trade.outcomeR}R` : null,
    trade.pnlMinor != null && trade.currency ? formatPnl(trade.pnlMinor, trade.currency) : null,
  ].filter(Boolean);
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium tabular-nums ${RESULT_TONE[trade.result]}`}>
      <Icon />
      {OUTCOME_LABEL[trade.result]}
      {parts.length > 0 && <span className="font-normal text-ink/80">{parts.join(" · ")}</span>}
    </span>
  );
}

/**
 * Confirm or close a trade. `trade` is null for a placed trade from before
 * Edge watched trades: it is closed by hand like any other.
 */
export function OutcomeForm({
  decisionId,
  trade,
  onSaved,
  onCancel,
  autoFocus = false,
}: {
  decisionId: string;
  trade: TradeView | null;
  onSaved: (t: TradeView) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const ids = useId();
  const hit = trade?.state === "hit" ? trade.hit : null;
  const editing = trade?.state === "closed";
  const [result, setResult] = useState<OutcomeResult | null>(() =>
    editing ? trade!.result : hit ? (hit.level === "take_profit" ? "win" : "loss") : null
  );
  const [exitPrice, setExitPrice] = useState(() => (editing && trade!.exitPrice != null ? String(trade!.exitPrice) : ""));
  const [note, setNote] = useState(trade?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) firstRef.current?.focus();
  }, [autoFocus]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!result) {
      setError("Choose Profit, Loss or Break even.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/workspace/decisions/${decisionId}/outcome`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, exitPrice: result === "break_even" ? "" : exitPrice, note }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.trade) {
        setError(d.error || "Couldn't save the outcome. Try again.");
        return;
      }
      onSaved(d.trade as TradeView);
    } catch {
      setError("Couldn't reach Edge. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // After a hit, the level is the exit unless the trader closed elsewhere.
  const exitOptional = Boolean(hit) && result !== null && result !== "break_even" &&
    (result === "win" ? trade?.watching.takeProfit != null : trade?.watching.stopLoss != null);
  const label = "text-[13px] text-ink/80";

  return (
    <form onSubmit={save} className="grid gap-3.5" noValidate>
      {hit && (
        <p className="text-[13px] leading-relaxed text-ink/85">
          Edge saw the price reach your <b className="font-medium text-ink">{LEVEL_LABEL[hit.level]}</b> at{" "}
          <b className="font-medium tabular-nums text-ink">{fmtPrice(hit.price)}</b>
          {hit.at ? ` on ${new Date(hit.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}.
          Spreads differ between brokers, so confirm how the trade ended.
        </p>
      )}

      <fieldset>
        <legend className={`${label} mb-1.5`}>How did the trade end?</legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Result">
          {(["win", "loss", "break_even"] as const).map((r, i) => {
            const Icon = RESULT_ICON[r];
            const on = result === r;
            const ring = on
              ? r === "win"
                ? "border-accent bg-pass-bg"
                : r === "loss"
                  ? "border-fail bg-err-bg"
                  : "border-ink/50 bg-panel"
              : "border-line hover:bg-panel";
            return (
              <button
                key={r}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setResult(r);
                  setError("");
                }}
                className={`flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition ${ring} ${on ? RESULT_TONE[r] : "text-ink/85"}`}
              >
                <Icon />
                {OUTCOME_LABEL[r]}
              </button>
            );
          })}
        </div>
      </fieldset>

      {result !== "break_even" && (
        <label className={label} htmlFor={`${ids}-exit`}>
          {exitOptional ? (
            <>
              Closed at a different price? <span className="text-muted">(optional)</span>
            </>
          ) : (
            "Price you closed at"
          )}
          <input
            id={`${ids}-exit`}
            className="input mt-1 py-2 text-sm tabular-nums"
            inputMode="decimal"
            autoComplete="off"
            placeholder={
              exitOptional
                ? fmtPrice(result === "win" ? trade!.watching.takeProfit! : trade!.watching.stopLoss!)
                : undefined
            }
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value)}
          />
        </label>
      )}

      <label className={label} htmlFor={`${ids}-note`}>
        Note <span className="text-muted">(optional)</span>
        <textarea
          id={`${ids}-note`}
          className="input mt-1 min-h-[56px] py-2 text-sm"
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <p className="text-xs text-muted">Edge works out the result in R, and the money when your ticket had a risk amount.</p>

      {error && (
        <p role="alert" className="text-sm text-fail">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : hit ? "Confirm and log" : editing ? "Save changes" : "Close trade"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm font-medium transition hover:bg-panel"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** The outcome part of a placed trade in the journal: confirm a hit, watch, close by hand, or see how it ended. */
export function TradeOutcome({
  decisionId,
  trade,
  onChange,
}: {
  decisionId: string;
  trade: TradeView | null;
  onChange: (t: TradeView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const saved = (t: TradeView) => {
    setEditing(false);
    onChange(t);
  };

  if (trade?.state === "hit") {
    return (
      <section className="rounded-lg border border-maybe/45 bg-warn-bg/40 p-4" aria-label="Confirm the outcome">
        <h4 className="mb-2 text-sm font-semibold text-ink">Confirm the outcome</h4>
        <OutcomeForm decisionId={decisionId} trade={trade} onSaved={saved} />
      </section>
    );
  }
  if (editing) {
    return (
      <section className="rounded-lg border border-line bg-panel p-4">
        <h4 className="mb-2 text-sm font-semibold text-ink">{trade?.state === "closed" ? "Edit the outcome" : "Close this trade"}</h4>
        <OutcomeForm decisionId={decisionId} trade={trade} onSaved={saved} onCancel={() => setEditing(false)} autoFocus />
      </section>
    );
  }
  if (trade?.state === "closed") {
    return (
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel p-4">
        <span className="text-[13px] text-ink/80">
          Outcome: <OutcomeBadge trade={trade} />
          {trade.exitPrice != null && <span className="ml-2 text-xs text-muted tabular-nums">closed at {fmtPrice(trade.exitPrice)}</span>}
        </span>
        <button type="button" className="text-xs text-muted underline hover:text-ink" onClick={() => setEditing(true)}>
          Edit
        </button>
      </section>
    );
  }
  const w = trade?.watching;
  const levels = [
    w?.takeProfit != null ? `take profit at ${fmtPrice(w.takeProfit)}` : null,
    w?.stopLoss != null ? `stop loss at ${fmtPrice(w.stopLoss)}` : null,
  ].filter(Boolean);
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel p-4">
      <p className="text-[13px] text-ink/80">
        {levels.length
          ? `Edge is watching your ${levels.join(" and ")}, and will ask you to confirm when the price reaches one.`
          : "This trade has no stop loss or take profit for Edge to watch."}
        <span className="block text-xs text-muted">Closed it yourself? Close it here with the price you closed at.</span>
      </p>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex h-9 items-center rounded-full border border-line px-4 text-sm font-medium transition hover:bg-surface"
      >
        Close trade
      </button>
    </section>
  );
}
