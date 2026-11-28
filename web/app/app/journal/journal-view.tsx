"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppFrame from "../../_components/app-frame";
import { IconBook, IconCheck, IconRetry, IconX } from "../../_components/icons";
import { toast } from "../../_components/toaster";
import MonthReview from "./month-review";
import { OutcomeBadge, TradeOutcome } from "../../_components/trade-outcome";
import { handleSessionExpired } from "@/lib/client-auth";
import type { TradeView } from "@/lib/outcome";

interface OverrideInfo {
  id: string;
  rulesOverridden: Array<{ itemKey: string; text: string }>;
  reasonCode: string | null;
  reasonText: string | null;
}

interface RuleCheckDetail {
  rule: {
    item_key: string;
    text: string;
    category?: string;
    hard_gate?: boolean;
    required_timeframe?: string | null;
  };
  mode: string;
  status: "pass" | "fail" | "inconclusive" | "not_checked";
  check?: {
    observed?: string;
    reasoning?: string;
    missing?: string | null;
  };
}

interface JournalEntry {
  id: string;
  journalId: string | null;
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  riskPct: number | null;
  riskReward: number | null;
  result: "approved" | "denied" | "needs_evidence";
  hardGateStatus: string;
  resolution: string | null;
  decidedAt: string;
  resolvedAt: string | null;
  reasons: {
    ticket?: string[];
    cannotCheck?: string | null;
    failing?: Array<{ itemKey: string; text: string; reason?: string }>;
    missing?: Array<{ itemKey: string; text: string; reason?: string }>;
    softFails?: Array<{ itemKey: string; text: string; reason?: string }>;
  };
  snapshot: {
    timeframe?: string;
    rules?: RuleCheckDetail[];
    ticket?: {
      side?: string;
      entry?: number;
      stop?: number | null;
      target?: number | null;
    };
  };
  override: OverrideInfo | null;
  userNotes: string;
  lessons: string;
  executionQuality: string | null;
  /** Task D5: the placed trade Edge watches, and how it ended. */
  trade: TradeView | null;
}

export default function JournalView() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "followed" | "broke" | "needs_outcome">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notesState, setNotesState] = useState<Record<string, { notes: string; lessons: string; saving: boolean; saved: boolean }>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/journal");
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (alive) {
            setEntries(data.entries || []);
            const map: Record<string, { notes: string; lessons: string; saving: boolean; saved: boolean }> = {};
            for (const e of data.entries || []) {
              map[e.id] = { notes: e.userNotes || "", lessons: e.lessons || "", saving: false, saved: false };
            }
            setNotesState(map);
            // An alert links to /app/journal?trade=<decision id>: open that trade.
            const linked = new URLSearchParams(window.location.search).get("trade");
            const target = (data.entries as JournalEntry[] | undefined)?.find((e) => e.id === linked);
            if (target) {
              setExpandedId(target.id);
              requestAnimationFrame(() => document.getElementById(`entry-${target.id}`)?.scrollIntoView({ block: "start" }));
            } else if (data.entries?.length > 0) {
              setExpandedId(data.entries[0].id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load journal entries", err);
        toast.error("Network error: Failed to load journal entries. Please check your connection.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function saveNotes(decisionId: string) {
    const curr = notesState[decisionId];
    if (!curr) return;
    setNotesState((prev) => ({ ...prev, [decisionId]: { ...prev[decisionId], saving: true, saved: false } }));
    try {
      const res = await fetch(`/api/journal/${decisionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userNotes: curr.notes, lessons: curr.lessons }),
      });
      if (res.status === 401) {
        handleSessionExpired();
        setNotesState((prev) => ({ ...prev, [decisionId]: { ...prev[decisionId], saving: false } }));
        return;
      }
      if (res.ok) {
        toast.success("Journal notes saved successfully.");
        setNotesState((prev) => ({ ...prev, [decisionId]: { ...prev[decisionId], saving: false, saved: true } }));
        setTimeout(() => {
          setNotesState((prev) => ({ ...prev, [decisionId]: { ...prev[decisionId], saved: false } }));
        }, 2500);
      } else {
        const d = await res.json().catch(() => ({}));
        if (d.error === "Not authenticated") {
          handleSessionExpired();
          setNotesState((prev) => ({ ...prev, [decisionId]: { ...prev[decisionId], saving: false } }));
          return;
        }
        toast.error(d.error || "Failed to save journal notes.");
        setNotesState((prev) => ({ ...prev, [decisionId]: { ...prev[decisionId], saving: false } }));
      }
    } catch {
      toast.error("Network error: Could not save journal notes. Please check your connection.");
      setNotesState((prev) => ({ ...prev, [decisionId]: { ...prev[decisionId], saving: false } }));
    }
  }

  const broke = (e: JournalEntry) => Boolean(e.override) || e.resolution === "overridden";

  const filtered = entries.filter((e) => {
    if (filter === "followed") return !broke(e);
    if (filter === "broke") return broke(e);
    if (filter === "needs_outcome") return e.resolution === "placed" && e.trade?.state !== "closed";
    return true;
  });

  return (
    <AppFrame active="journal" title="Journal">
      <div className="mx-auto w-full max-w-[960px] px-4 py-8 sm:px-6">
        {/* Header bar */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-medium tracking-tight text-ink sm:text-2xl">Discipline Journal</h2>
            <p className="mt-1 text-sm text-muted">
              Every gated decision, rule snapshot, and override recorded without judgment.
            </p>
          </div>

          {/* Summary cards */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-panel p-5 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">Followed your plan</div>
              <div className="mt-1 text-3xl font-light tracking-tight text-ink">
                {entries.length > 0 ? Math.round((entries.filter((e) => !broke(e)).length / entries.length) * 100) : 0}%
              </div>
              <div className="mt-1 text-xs text-muted">
                {entries.filter((e) => !broke(e)).length} of {entries.length} decisions
              </div>
            </div>
            <div className="rounded-xl border border-line bg-panel p-5 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">Broke a rule</div>
              <div className="mt-1 text-3xl font-light tracking-tight text-fail">
                {entries.filter(broke).length}
              </div>
              <div className="mt-1 text-xs text-muted">Overridden decisions</div>
            </div>
            <div className="rounded-xl border border-line bg-panel p-5 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">Waiting for an outcome</div>
              <div className="mt-1 text-3xl font-light tracking-tight text-maybe">
                {entries.filter((e) => e.resolution === "placed" && e.trade?.state !== "closed").length}
              </div>
              <div className="mt-1 text-xs text-muted">Add the result to finish the entry</div>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-surface/60 p-1">
            {(
              [
                { id: "all", label: "All", count: entries.length },
                { id: "followed", label: "Followed plan", count: entries.filter((e) => !broke(e)).length },
                { id: "broke", label: "Broke a rule", count: entries.filter(broke).length },
                { id: "needs_outcome", label: "Needs outcome", count: entries.filter((e) => e.resolution === "placed" && e.trade?.state !== "closed").length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id as "all" | "followed" | "broke" | "needs_outcome")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  filter === tab.id
                    ? "bg-panel text-ink shadow-sm ring-1 ring-line"
                    : "text-muted hover:text-ink"
                }`}
              >
                {tab.label} {tab.count > 0 ? <span className="ml-1">{tab.count}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <MonthReview />

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface/30 py-16">
            <span className="text-sm text-muted">Loading your journal entries...</span>
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface/30 p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-track text-muted">
              <IconBook className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-medium text-ink">
              {filter === "all" ? "No journal entries yet" : `No ${filter} entries found`}
            </h3>
            <p className="mt-1 max-w-md text-sm text-muted">
              When you evaluate trade setups in the workspace, Edge logs each decision, snapshot, and override reason
              here so you can review your discipline over time.
            </p>
            <div className="mt-6">
              <Link href="/app/workspace" className="btn btn-main btn-sm">
                Open Trade Workspace
              </Link>
            </div>
          </div>
        )}

        {/* Entries list */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-4">
            {filtered.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const dateStr = new Date(entry.decidedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZoneName: "short",
              });

              const isOverridden = entry.resolution === "overridden" || Boolean(entry.override);
              const isApproved = entry.result === "approved";
              const isDenied = entry.result === "denied";

              const rulesList = entry.snapshot?.rules || [];

              return (
                <div
                  key={entry.id}
                  id={`entry-${entry.id}`}
                  className={`card overflow-hidden transition ${
                    isExpanded ? "ring-1 ring-line" : "hover:border-line/80"
                  }`}
                >
                  {/* Card Summary Header */}
                  <div
                    className="flex cursor-pointer flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      {/* Side Tag */}
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                          entry.side === "buy" ? "bg-pass-bg text-pass" : "bg-err-bg text-fail"
                        }`}
                      >
                        {entry.side}
                      </span>

                      {/* Instrument */}
                      <span className="text-base font-medium text-ink">{entry.instrument}</span>

                      {/* Timeframe */}
                      {entry.snapshot?.timeframe && (
                        <span className="rounded bg-track px-1.5 py-0.5 text-xs text-muted">
                          {entry.snapshot.timeframe}
                        </span>
                      )}

                      {/* Date */}
                      <span className="text-xs text-muted sm:ml-2">{dateStr}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Gate Result Badge (icon + text, WCAG 2.2 AA compliant) */}
                      {isApproved && (
                        <span className="flex items-center gap-1.5 rounded-full bg-pass-bg px-2.5 py-1 text-xs font-medium text-pass">
                          <IconCheck className="h-3.5 w-3.5" />
                          Passes your checklist
                        </span>
                      )}
                      {isDenied && (
                        <span className="flex items-center gap-1.5 rounded-full bg-err-bg px-2.5 py-1 text-xs font-medium text-fail">
                          <IconX className="h-3.5 w-3.5" />
                          Fails your checklist
                        </span>
                      )}
                      {entry.result === "needs_evidence" && (
                        <span className="flex items-center gap-1.5 rounded-full bg-warn-bg px-2.5 py-1 text-xs font-medium text-maybe">
                          <IconRetry className="h-3.5 w-3.5" />
                          Needs evidence
                        </span>
                      )}

                      {/* Override Resolution Pill */}
                      {isOverridden && (
                        <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-medium text-maybe">
                          Overridden
                        </span>
                      )}
                      {entry.resolution === "accepted_denial" && (
                        <span className="rounded-full bg-track px-2 py-0.5 text-xs font-medium text-muted">
                          Denial accepted
                        </span>
                      )}
                      {entry.resolution === "placed" && (
                        <span className="rounded-full bg-pass-bg px-2 py-0.5 text-xs font-medium text-pass">
                          Placed
                        </span>
                      )}
                      {/* Outcome column: only for placed trades */}
                      {entry.resolution === "placed" && (
                        <div>
                          {entry.trade?.state === "hit" && (
                            <span className="flex items-center gap-1.5 rounded-full bg-warn-bg px-2.5 py-1 text-xs font-medium text-maybe">
                              <IconRetry className="h-3.5 w-3.5" />
                              Confirm outcome
                            </span>
                          )}
                          {entry.trade?.state === "closed" && <OutcomeBadge trade={entry.trade} />}
                        </div>
                      )}

                      <span className="ml-1 text-xs text-muted">
                        {isExpanded ? "Collapse ▲" : "Details ▼"}
                      </span>
                    </div>
                  </div>

                  {/* Expanded Body */}
                  {isExpanded && (
                    <div className="border-t border-line bg-surface/40 p-5 sm:p-6">
                      {/* Trade parameters grid */}
                      <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-line bg-panel p-4 sm:grid-cols-4">
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Entry Price</div>
                          <div className="mt-0.5 font-mono text-sm text-ink">
                            {entry.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 5 })}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Stop Loss</div>
                          <div className="mt-0.5 font-mono text-sm text-ink">
                            {entry.stopPrice != null
                              ? entry.stopPrice.toLocaleString(undefined, { maximumFractionDigits: 5 })
                              : "None"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Take Profit</div>
                          <div className="mt-0.5 font-mono text-sm text-ink">
                            {entry.targetPrice != null
                              ? entry.targetPrice.toLocaleString(undefined, { maximumFractionDigits: 5 })
                              : "None"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Risk / Reward</div>
                          <div className="mt-0.5 font-mono text-sm text-ink">
                            {entry.riskReward ? `1 : ${entry.riskReward.toFixed(2)}` : "—"}
                          </div>
                        </div>
                      </div>

                      {/* Override details if present */}
                      {isOverridden && (
                        <div className="mb-6 rounded-lg border border-maybe/30 bg-warn-bg/40 p-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-maybe">
                            <IconRetry className="h-4 w-4" />
                            Overridden Trade (PR-OV-1)
                          </div>
                          <p className="mt-1 text-xs text-ink/80">
                            The trader bypassed the checklist check and chose to place this trade.
                          </p>
                          {entry.override?.reasonText && (
                            <div className="mt-2 text-xs text-ink">
                              <span className="font-medium text-muted">Trader&apos;s reason: </span>
                              <span className="italic">“{entry.override.reasonText}”</span>
                            </div>
                          )}
                          {entry.override?.rulesOverridden && entry.override.rulesOverridden.length > 0 && (
                            <div className="mt-2">
                              <div className="text-[11px] font-medium text-muted uppercase">Rules Bypassed:</div>
                              <ul className="mt-1 space-y-1">
                                {entry.override.rulesOverridden.map((r, i) => (
                                  <li key={i} className="flex items-center gap-1.5 text-xs text-fail">
                                    <IconX className="h-3 w-3 shrink-0" />
                                    <span>{r.text}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Rules evaluated */}
                      {rulesList.length > 0 && (
                        <div className="mb-6">
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                            Checklist Rules Snapshot ({rulesList.length})
                          </h4>
                          <div className="space-y-2">
                            {rulesList.map((st, idx) => {
                              const isRulePass = st.status === "pass";
                              const isRuleFail = st.status === "fail";
                              const isRuleInc = st.status === "inconclusive";

                              return (
                                <div
                                  key={idx}
                                  className="flex flex-col gap-1.5 rounded border border-line bg-panel p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="flex items-start gap-2.5">
                                    <span className="mt-0.5 shrink-0">
                                      {isRulePass && <IconCheck className="h-4 w-4 text-pass" />}
                                      {isRuleFail && <IconX className="h-4 w-4 text-fail" />}
                                      {isRuleInc && <IconRetry className="h-4 w-4 text-maybe" />}
                                      {!isRulePass && !isRuleFail && !isRuleInc && (
                                        <span className="h-2 w-2 rounded-full bg-muted" />
                                      )}
                                    </span>
                                    <div>
                                      <div className="font-medium text-ink">
                                        {st.rule.text}
                                        {st.rule.hard_gate && (
                                          <span className="ml-2 rounded bg-track px-1.5 py-0.5 text-[10px] text-muted">
                                            Hard gate
                                          </span>
                                        )}
                                      </div>
                                      {st.check?.reasoning && (
                                        <div className="mt-0.5 text-[11px] text-muted">
                                          {st.check.reasoning}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="shrink-0 text-right">
                                    <span
                                      className={`inline-flex items-center gap-1 font-medium ${
                                        isRulePass ? "text-pass" : isRuleFail ? "text-fail" : "text-maybe"
                                      }`}
                                    >
                                      {isRulePass ? "Pass" : isRuleFail ? "Fail" : "Inconclusive"}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Task D5: confirm, close or see the outcome of a placed trade */}
                      {entry.resolution === "placed" && (
                        <div className="mb-6">
                          <TradeOutcome
                            decisionId={entry.id}
                            trade={entry.trade}
                            onChange={(t) => setEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, trade: t } : x)))}
                          />
                        </div>
                      )}

                      {/* Execution Quality & Trader Reflections */}
                      <div className="rounded-lg border border-line bg-panel p-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                          Trader Reflection & Notes (PR-OV-3)
                        </h4>
                        <p className="mt-0.5 text-xs text-muted">
                          Execution discipline is scored separately from financial profit or loss.
                        </p>

                        <div className="mt-3 space-y-3">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-ink">
                              Session Notes
                            </label>
                            <textarea
                              rows={2}
                              value={notesState[entry.id]?.notes ?? ""}
                              onChange={(e) =>
                                setNotesState((prev) => ({
                                  ...prev,
                                  [entry.id]: { ...prev[entry.id], notes: e.target.value },
                                }))
                              }
                              placeholder="Write observations about market context, emotions, or setup quality..."
                              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-ink">
                              Lessons Learned
                            </label>
                            <input
                              type="text"
                              value={notesState[entry.id]?.lessons ?? ""}
                              onChange={(e) =>
                                setNotesState((prev) => ({
                                  ...prev,
                                  [entry.id]: { ...prev[entry.id], lessons: e.target.value },
                                }))
                              }
                              placeholder="What will you repeat or avoid next time?"
                              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
                            />
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs text-pass">
                              {notesState[entry.id]?.saved && "✓ Reflection saved"}
                            </span>
                            <button
                              type="button"
                              onClick={() => saveNotes(entry.id)}
                              disabled={notesState[entry.id]?.saving}
                              className="btn btn-main btn-sm text-xs"
                            >
                              {notesState[entry.id]?.saving ? "Saving..." : "Save Reflection"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppFrame>
  );
}

