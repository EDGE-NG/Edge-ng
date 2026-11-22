"use client";

import { useEffect, useState } from "react";
import { IconCheckCircle, IconChevronRight, IconXCircle } from "../../_components/icons";
import { handleSessionExpired } from "@/lib/client-auth";

interface MonthReview {
  month: string; // YYYY-MM
  currentMonth: string;
  firstMonth: string;
  trades: number;
  cleanTrades: number;
  checks: number;
  passes: number;
  fails: number;
  kept: Array<{ text: string; passes: number; checks: number }>;
  slipped: Array<{ text: string; fails: number; checks: number }>;
}

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Journal month in review (PRD 4.6): the share of rule checks that passed,
 * trades that met every rule, and side by side, with equal weight, the rules
 * kept best and the rules that failed most. Every status has an icon and text,
 * never colour alone.
 */
export default function MonthReview() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MonthReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/journal/month${month ? `?month=${month}` : ""}`);
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as MonthReview;
        if (alive) {
          setData(body);
          setFailed(false);
        }
      } catch (err) {
        console.error("Failed to load the month in review", err);
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [month]);

  if (!data) {
    return failed ? null : <div className="card mb-6 h-[220px] animate-pulse" aria-busy aria-label="Loading your month in review" />;
  }

  const go = (n: number) => {
    setLoading(true);
    setMonth(shiftMonth(data.month, n));
  };
  const canBack = data.month > data.firstMonth;
  const canForward = data.month < data.currentMonth;
  const passRate = data.checks ? Math.round((data.passes / data.checks) * 100) : null;

  return (
    <section
      className={`card mb-6 p-5 transition-opacity sm:p-6 ${loading ? "opacity-60" : ""}`}
      aria-labelledby="month-review-title"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="month-review-title" className="text-sm font-medium text-ink">Your month in review</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={!canBack || loading}
            aria-label="Previous month"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:text-ink disabled:opacity-40"
          >
            <IconChevronRight className="h-3.5 w-3.5 rotate-180" />
          </button>
          <span className="min-w-[124px] text-center text-sm text-ink" aria-live="polite">{monthName(data.month)}</span>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!canForward || loading}
            aria-label="Next month"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:text-ink disabled:opacity-40"
          >
            <IconChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {data.trades === 0 ? (
        <p className="mt-6 text-sm text-muted">No trades were checked in {monthName(data.month)}.</p>
      ) : (
        <>
          {/* What went right, first */}
          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
            <div>
              <div className="text-4xl font-medium tracking-tight text-accent">{passRate}%</div>
              <div className="mt-1 text-xs text-muted">of your rule checks passed</div>
            </div>
            <ul className="flex flex-wrap gap-2 text-xs">
              <li className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 font-medium text-accent">
                <IconCheckCircle />
                {plural(data.passes, "rule check")} passed
              </li>
              <li className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 font-medium text-accent">
                <IconCheckCircle />
                {data.cleanTrades} of {plural(data.trades, "trade")} met every rule
              </li>
              {data.fails > 0 && (
                <li className="inline-flex items-center gap-1.5 rounded-md border border-fail/40 bg-fail/10 px-2.5 py-1 font-medium text-fail">
                  <IconXCircle />
                  {plural(data.fails, "rule check")} failed
                </li>
              )}
            </ul>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Rules you kept best</h4>
              <ul className="mt-3 space-y-3.5">
                {data.kept.map((r) => (
                  <li key={r.text}>
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="flex min-w-0 items-center gap-2 text-ink">
                        <IconCheckCircle className="h-4 w-4 shrink-0 text-accent" />
                        <span className="truncate" title={r.text}>{r.text}</span>
                      </span>
                      <span className="shrink-0 text-xs text-accent">
                        Passed {r.passes} of {r.checks}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((r.passes / r.checks) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Rules that failed most</h4>
              {data.slipped.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No rule failed a check this month.</p>
              ) : (
                <ul className="mt-3 space-y-3.5">
                  {data.slipped.map((r) => (
                    <li key={r.text}>
                      <div className="flex items-baseline justify-between gap-4 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-ink">
                          <IconXCircle className="h-4 w-4 shrink-0 text-fail" />
                          <span className="truncate" title={r.text}>{r.text}</span>
                        </span>
                        <span className="shrink-0 text-xs text-fail">
                          Failed {r.fails} of {r.checks}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
                        <div className="h-full rounded-full bg-fail" style={{ width: `${Math.round((r.fails / r.checks) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
