"use client";

/**
 * "Your rules" (PR-TW-3, PR-TW-4; design by Daniel, 2026-11-21): the
 * approved checklist beside the chart, with each rule's latest result.
 * Chart rules show what Edge saw; session rules are read from the clock;
 * rules only the trader can judge take an "I confirm".
 */
import Link from "next/link";
import { useState } from "react";
import { Chevron, Info, Lock, Pencil, Refresh, STATUS_TEXT, STATUS_TONE, StatusDot, type DotState } from "./marks";
import { TF_LABEL, type RuleView, type Timeframe, type View } from "./types";

export default function RulesPanel({
  view,
  tf,
  checking,
  warming,
  onShowTf,
  onAnswer,
  onRecheck,
}: {
  view: View;
  tf: Timeframe;
  /** Edge is checking the view on screen. */
  checking: boolean;
  /** Edge is refreshing checks ahead of Buy / Sell. */
  warming: boolean;
  onShowTf: (t: Timeframe) => void;
  onAnswer: (itemKey: string, answer: "yes" | "clear") => void;
  onRecheck: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const needViews = [
    ...new Set(
      view.rules
        .filter((r) => r.mode === "chart" && r.timeframe && r.timeframe !== tf && r.status !== "pass" && r.status !== "fail")
        .map((r) => r.timeframe!)
    ),
  ];
  const noExamples = view.rules.filter((r) => r.mode === "chart" && r.confirmedExamples === 0);

  const dotFor = (r: RuleView): DotState => {
    if (r.mode === "chart" && (warming || (checking && (!r.timeframe || r.timeframe === tf)))) return "checking";
    return r.status;
  };

  return (
    <section className="card flex flex-col p-0" aria-labelledby="rules-title">
      <header className="flex items-center justify-between gap-3 px-5 pt-[18px] pb-3">
        <h2 id="rules-title" className="text-[15px] font-semibold">Your rules</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRecheck}
            disabled={checking}
            aria-label="Check this view again"
            title="Check this view again"
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-panel hover:text-ink disabled:opacity-50"
          >
            <span className={checking ? "animate-spin motion-reduce:animate-none" : ""}><Refresh /></span>
          </button>
          <Link href="/checklist" className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-accent hover:underline">
            <Pencil />
            Edit rules
          </Link>
        </div>
      </header>

      {/* PR-TW-4: ask for the views Edge still needs */}
      {needViews.length > 0 && (
        <div className="mx-5 mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-maybe/10 px-2.5 py-2 text-xs text-maybe">
          <span>Edge still needs:</span>
          {needViews.map((t) => (
            <button key={t} type="button" className="rounded-md border border-line px-2 py-0.5 text-ink hover:bg-panel" onClick={() => onShowTf(t)}>
              Show {TF_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      {noExamples.length > 0 && (
        <p className="mx-5 mb-2 rounded-lg bg-maybe/10 px-2.5 py-2 text-xs text-maybe">
          {noExamples.length} chart rule{noExamples.length === 1 ? " has" : "s have"} no confirmed example yet, so Edge can&apos;t pass{" "}
          {noExamples.length === 1 ? "it" : "them"}.{" "}
          <Link href="/app/evidence" className="text-ink underline">Add examples</Link>
        </p>
      )}

      <ul className="divide-y divide-line px-5">
        {view.rules.map((r) => {
          const dot = dotFor(r);
          const isOpen = open === r.itemKey;
          const canOpen = r.mode === "chart" && Boolean(r.check);
          const lock = r.hardGate ? (
            <span className="ml-1.5 inline-block align-[-1px] text-muted" title="Hard gate: this rule can block a trade">
              <Lock />
              <span className="sr-only"> (hard gate)</span>
            </span>
          ) : null;
          const text = (
            <span className="min-w-0 flex-1 text-sm leading-snug text-ink/90">
              {r.text}
              {lock}
            </span>
          );

          let right: React.ReactNode;
          if (r.mode === "trader") {
            const on = r.status === "pass";
            right = (
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onAnswer(r.itemKey, on ? "clear" : "yes")}
                className={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition ${
                  on ? "border-accent/45 bg-accent/10 text-accent" : "border-line text-ink hover:bg-panel"
                }`}
              >
                {on ? "Confirmed" : r.status === "fail" ? "Not met · confirm" : "I confirm"}
              </button>
            );
          } else if (r.mode === "code") {
            right = <span className="shrink-0 text-xs text-muted">From your ticket</span>;
          } else {
            right = (
              <span className={`inline-flex shrink-0 items-center gap-1 text-xs ${STATUS_TONE[dot]}`}>
                {dot === "checking" && r.timeframe ? `Checking ${TF_LABEL[r.timeframe]}…` : STATUS_TEXT[dot]}
                {canOpen && <Chevron className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />}
              </span>
            );
          }

          const row = (
            <>
              <StatusDot state={r.mode === "code" ? "unchecked" : dot} />
              {text}
              {right}
            </>
          );

          // one line under the rule: why (session), what's missing (chart), or staleness
          let sub: string | null = null;
          if (r.mode === "session" && r.check) sub = r.check.reasoning;
          else if (r.mode === "code") sub = "Checked when you press Buy or Sell.";
          else if (r.stale && r.mode === "chart") sub = `The last check is over 15 minutes old. ${r.timeframe ? `Show the ${TF_LABEL[r.timeframe]} chart` : "Check this view again"} to refresh it.`;
          else if (r.stale && r.mode === "trader") sub = "Your answer is over 15 minutes old. Confirm it again.";
          else if (r.mode === "chart" && r.check && (r.status === "inconclusive" || r.status === "unchecked") && !isOpen)
            sub = r.check.missing ? `Needs ${r.check.missing}.` : r.check.reasoning;

          return (
            <li key={r.itemKey}>
              {canOpen ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-3 text-left"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : r.itemKey)}
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-center gap-3 py-3">{row}</div>
              )}
              {sub && !isOpen && <p className={`-mt-1.5 mb-3 ml-[30px] text-xs leading-snug ${r.mode === "session" && r.status === "fail" ? "text-fail" : "text-muted"}`}>{sub}</p>}
              {isOpen && r.check && <Why rule={r} />}
            </li>
          );
        })}
      </ul>

      <p className="flex items-start gap-2 px-5 pt-3.5 pb-[18px] text-xs leading-relaxed text-muted">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
        Edge checks your trade against these rules. The decision stays with you.
      </p>
    </section>
  );
}

function Why({ rule }: { rule: RuleView }) {
  const c = rule.check!;
  const tfLabel = c.timeframe ? `${TF_LABEL[c.timeframe as Timeframe] ?? c.timeframe} chart` : "";
  return (
    <div className="-mt-1 mb-3 ml-[30px] space-y-1.5 rounded-lg bg-panel px-3 py-2.5 text-[13px] leading-relaxed">
      <p className="text-ink">{c.reasoning}</p>
      {c.observed && <p className="text-ink/70">{c.observed}</p>}
      {c.missing && <p className="text-maybe">Needs {c.missing}.</p>}
      <p className="text-[11px] text-muted">
        {tfLabel}
        {c.evidence?.candleRange ? ` · candles ${c.evidence.candleRange[0]}–${c.evidence.candleRange[1]}` : ""}
        {c.confidence ? ` · ${c.confidence} confidence` : ""}
        {` · checked ${new Date(c.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
      </p>
      {(c.evidence?.referenceImageIds?.length ?? 0) > 0 && (
        <div className="flex gap-2 pt-1">
          {c.evidence!.referenceImageIds!.slice(0, 3).map((id) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/api/evidence/${id}/file`} alt="Your example this was compared with" className="h-11 w-16 rounded-md border border-line object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}
