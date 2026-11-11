"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Dashboard {
  edges: number;
  approvedEdges: number;
  reviews: number;
  completed: number;
  overrides: number;
  trades: number;
  journalCount: number;
  today: { reviews: number; trades: number; journals: number };
  verdicts: { pass: number; fail: number; inconclusive: number };
  totalVerdicts: number;
  completionRate: number;
  adherence: number | null;
  trend: Array<{ date: string; reviews: number; trades: number }>;
  streak: number;
  netPnl: number;
  recentTrades: Array<{
    id: string;
    instrument: string;
    direction: string;
    pnl: number | null;
    created_at: string;
    notes: string | null;
    review_verdict: string | null;
  }>;
  latestReview: {
    id: string;
    instrument: string;
    direction: string;
    overall: string | null;
    summary: string | null;
    status: string;
    created_at: string;
    overridden_at: string | null;
    edge_name: string;
  } | null;
  recent: Array<{
    id: string;
    instrument: string;
    direction: string;
    overall: string | null;
    status: string;
    created_at: string;
    overridden_at: string | null;
  }>;
}

const verdictTag = (v: string | null) => {
  if (v === "pass") return <span className="tag tag-pass">✓ Pass</span>;
  if (v === "fail") return <span className="tag tag-fail">✕ Fail</span>;
  if (v === "inconclusive") return <span className="tag tag-maybe">? Inconclusive</span>;
  return <span className="tag tag-neutral">Not run</span>;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Could not load dashboard"));
  }, []);

  if (error) return <p className="text-fail">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const totalVerdicts = data.verdicts.pass + data.verdicts.fail + data.verdicts.inconclusive;
  const maxTrend = Math.max(1, ...data.trend.map((d) => d.reviews + d.trades));
  const hasActivity = data.reviews > 0 || data.trades > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl tracking-tight">Dashboard</h1>
          <p className="mt-1 text-muted">Your discipline at a glance.</p>
        </div>
        {data.streak > 0 && (
          <span className="tag tag-pass" title="Consecutive days with a completed review">
            🔥 {data.streak}-day process streak
          </span>
        )}
      </div>

      {/* onboarding nudge */}
      {data.edges === 0 && (
        <div className="card border-accent/40">
          <h2 className="text-lg font-medium">Start with your edge</h2>
          <p className="mt-1 text-sm text-muted">
            Describe your trading strategy in your own words. Edge turns it into a checklist you
            approve before anything is reviewed.
          </p>
          <Link href="/app/edge" className="btn btn-main mt-4">
            Define my edge
          </Link>
        </div>
      )}

      {/* today's activity strip */}
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-muted">Today</h2>
        <div className="flex flex-wrap gap-6 text-sm">
          <span>
            <span className="text-xl tracking-tight">{data.today.reviews}</span>{" "}
            <span className="text-muted">reviews</span>
          </span>
          <span>
            <span className="text-xl tracking-tight">{data.today.trades}</span>{" "}
            <span className="text-muted">trades</span>
          </span>
          <span>
            <span className="text-xl tracking-tight">{data.today.journals}</span>{" "}
            <span className="text-muted">journal entries</span>
          </span>
        </div>
      </div>

      {/* status cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Edges defined" value={`${data.approvedEdges}/${data.edges}`} hint="approved" />
        <Stat
          label="Reviews run"
          value={data.completed}
          hint={`${data.reviews} started · ${Math.round(data.completionRate * 100)}% completed`}
        />
        <Stat label="Overrides" value={data.overrides} hint="recorded, not judged" />
        <Stat
          label="Net P&L"
          value={`${data.netPnl >= 0 ? "+" : ""}${data.netPnl.toFixed(1)}`}
          hint={`${data.trades} trades · ${data.journalCount} journals`}
          tone={data.netPnl > 0 ? "pass" : data.netPnl < 0 ? "fail" : undefined}
        />
      </div>

      {/* verdict mix + adherence */}
      {totalVerdicts > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted">
              Checklist adherence across all reviews
            </h2>
            {data.adherence !== null && (
              <span className="text-sm">
                <span className="text-xl tracking-tight text-pass">
                  {Math.round(data.adherence * 100)}%
                </span>{" "}
                <span className="text-muted">of rules passed</span>
              </span>
            )}
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-track">
            <div
              className="bg-pass"
              style={{ width: `${(data.verdicts.pass / totalVerdicts) * 100}%` }}
            />
            <div
              className="bg-fail"
              style={{ width: `${(data.verdicts.fail / totalVerdicts) * 100}%` }}
            />
            <div
              className="bg-maybe"
              style={{ width: `${(data.verdicts.inconclusive / totalVerdicts) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted">
            <span>✓ {data.verdicts.pass} pass</span>
            <span>✕ {data.verdicts.fail} fail</span>
            <span>? {data.verdicts.inconclusive} inconclusive</span>
          </div>
        </div>
      )}

      {/* 14-day process trend */}
      {hasActivity && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted">Process trend · last 14 days</h2>
            <div className="flex gap-4 text-xs text-muted">
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-pass align-middle" />
                reviews completed
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#4a6ff0] align-middle" />
                trades recorded
              </span>
            </div>
          </div>
          <div className="mt-4 flex h-28 items-end gap-1.5">
            {data.trend.map((d) => {
              const h = (v: number) => `${Math.max(v > 0 ? 8 : 0, (v / maxTrend) * 100)}%`;
              return (
                <div
                  key={d.date}
                  className="group flex h-full flex-1 flex-col justify-end gap-0.5"
                  title={`${d.date}: ${d.reviews} reviews, ${d.trades} trades`}
                >
                  <div className="w-full rounded-t bg-pass/80" style={{ height: h(d.reviews) }} />
                  <div
                    className="w-full rounded-b bg-[#4a6ff0]/80"
                    style={{ height: h(d.trades) }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted">
            <span>{fmtDate(data.trend[0].date)}</span>
            <span>{fmtDate(data.trend[data.trend.length - 1].date)}</span>
          </div>
        </div>
      )}

      {/* latest review + recent trades */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted">Latest review</h2>
            {data.latestReview && verdictTag(data.latestReview.overall)}
          </div>
          {data.latestReview ? (
            <div className="mt-3">
              <p className="text-lg">
                {data.latestReview.instrument} · {data.latestReview.direction}{" "}
                <span className="text-sm text-muted">({data.latestReview.edge_name})</span>
              </p>
              <p className="mt-2 line-clamp-3 text-sm text-muted">
                {data.latestReview.summary || "No summary yet."}
              </p>
              {data.latestReview.overridden_at && (
                <p className="mt-2 text-xs text-maybe">Override recorded</p>
              )}
              <Link
                href={`/app/review/${data.latestReview.id}`}
                className="btn mt-4 inline-flex"
              >
                Open review
              </Link>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-muted">
                {data.approvedEdges > 0
                  ? "Run your first pre-trade review."
                  : "Approve a checklist first, then review a setup against it."}
              </p>
              <Link href="/app/review" className="btn btn-main mt-4">
                Start a review
              </Link>
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted">Recent trades</h2>
            <Link href="/app/journal" className="text-xs text-muted hover:text-ink">
              Journal →
            </Link>
          </div>
          {data.recentTrades.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Trades you record after a review land here with their P&L.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {data.recentTrades.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {t.instrument} · {t.direction}
                    </p>
                    <p className="truncate text-xs text-muted">{fmtDate(t.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.review_verdict && verdictTag(t.review_verdict)}
                    <span
                      className={`text-sm tabular-nums ${
                        t.pnl === null
                          ? "text-muted"
                          : t.pnl >= 0
                            ? "text-pass"
                            : "text-fail"
                      }`}
                    >
                      {t.pnl === null ? "—" : `${t.pnl >= 0 ? "+" : ""}${t.pnl}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* recent activity */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted">Recent activity</h2>
          <Link href="/app/review" className="text-xs text-muted hover:text-ink">
            All reviews →
          </Link>
        </div>
        {data.recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {data.recent.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/app/review/${r.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:opacity-80"
                >
                  <span className="text-sm">
                    {r.instrument} · {r.direction}{" "}
                    <span className="text-xs text-muted">{fmtDate(r.created_at)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {r.overridden_at && (
                      <span className="text-xs text-maybe">override</span>
                    )}
                    {r.status === "completed" ? (
                      verdictTag(r.overall)
                    ) : (
                      <span className="tag tag-neutral">draft</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint: string;
  tone?: "pass" | "fail";
}) {
  return (
    <div className="card">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl tracking-tight ${
          tone === "pass" ? "text-pass" : tone === "fail" ? "text-fail" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
