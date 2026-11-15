"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppFrame from "../_components/app-frame";
import { IconBook, IconCandles, IconCheck, IconChecklist, IconImages, IconRetry, IconX } from "../_components/icons";
import { toast } from "../_components/toaster";

interface Metrics {
  totalChecks: number;
  adherenceRate: number;
  approvedCount: number;
  acceptedDenialCount: number;
  overriddenCount: number;
  needsEvidenceCount: number;
  evidenceImagesCount: number;
  activeChecklist: string | null;
}

interface RecentDecision {
  id: string;
  result: "approved" | "denied" | "needs_evidence";
  resolution: string | null;
  decided_at: string;
  instrument: string;
  side: "buy" | "sell";
}

export default function DashboardView() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recentDecisions, setRecentDecisions] = useState<RecentDecision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/dashboard");
        if (res.ok) {
          const data = await res.json();
          if (alive) {
            setMetrics(data.metrics);
            setRecentDecisions(data.recentDecisions || []);
          }
        }
      } catch (err) {
        console.error("Failed to load dashboard metrics", err);
        toast.error("Network error: Failed to load dashboard metrics. Please check your connection.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <AppFrame active="dashboard" title="Dashboard">
      <div className="mx-auto w-full max-w-[960px] px-4 py-8 sm:px-6">
        {/* Welcome & Lead */}
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-medium tracking-tight text-ink sm:text-2xl">Trading Discipline Dashboard</h2>
            <p className="mt-1 text-xs text-muted">
              What your trading plan adherence is worth over time (PRD 4.7).
            </p>
          </div>
          <Link href="/app/workspace" className="btn btn-main btn-sm text-xs self-start sm:self-auto">
            Check Trade in Workspace
          </Link>
        </div>

        {loading ? (
          <div className="rounded-xl border border-line bg-surface/30 py-16 text-center text-xs text-muted">
            Calculating adherence metrics...
          </div>
        ) : (
          <div className="space-y-6">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Adherence Rate */}
              <div className="card p-5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
                  Plan Adherence
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-light tracking-tight text-accent">
                    {metrics?.adherenceRate ?? 100}%
                  </span>
                  <span className="text-xs text-muted">discipline score</span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-track">
                  <div
                    className="h-full bg-accent transition-all duration-500"
                    style={{ width: `${metrics?.adherenceRate ?? 100}%` }}
                  />
                </div>
              </div>

              {/* Total Checks */}
              <div className="card p-5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
                  Total Gated Checks
                </div>
                <div className="mt-2 text-3xl font-light tracking-tight text-ink">
                  {metrics?.totalChecks ?? 0}
                </div>
                <div className="mt-3 text-xs text-muted">Pre-trade evaluations recorded</div>
              </div>

              {/* Passed vs Denied Disciplined */}
              <div className="card p-5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
                  Checklist Passes
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-light tracking-tight text-pass">
                    {metrics?.approvedCount ?? 0}
                  </span>
                  <span className="text-xs text-muted">
                    ({metrics?.acceptedDenialCount ?? 0} denials adhered to)
                  </span>
                </div>
                <div className="mt-3 text-xs text-muted">Disciplined setups</div>
              </div>

              {/* Overrides */}
              <div className="card p-5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
                  Overrides
                </div>
                <div className="mt-2 text-3xl font-light tracking-tight text-maybe">
                  {metrics?.overriddenCount ?? 0}
                </div>
                <div className="mt-3 text-xs text-muted">Trades placed against plan</div>
              </div>
            </div>

            {/* Quick Status & Setup Overview */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="card p-5">
                <h3 className="text-sm font-medium text-ink">System Status</h3>
                <div className="mt-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between border-b border-line pb-2.5">
                    <span className="text-muted">Active Checklist:</span>
                    <span className="font-medium text-ink">
                      {metrics?.activeChecklist ? (
                        <span className="text-pass">{metrics.activeChecklist}</span>
                      ) : (
                        <Link href="/checklist" className="text-accent underline">
                          Create & approve checklist
                        </Link>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-line pb-2.5">
                    <span className="text-muted">Evidence Images Taught:</span>
                    <span className="font-mono text-ink">
                      {metrics?.evidenceImagesCount ?? 0} images
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Decisions Stored:</span>
                    <span className="font-mono text-ink">{metrics?.totalChecks ?? 0} entries</span>
                  </div>
                </div>
              </div>

              {/* Core Loop Navigation Shortcuts */}
              <div className="card p-5">
                <h3 className="text-sm font-medium text-ink">Quick Navigation</h3>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <Link
                    href="/checklist"
                    className="flex items-center gap-2 rounded-lg border border-line bg-panel p-2.5 text-ink transition hover:border-accent"
                  >
                    <IconChecklist className="h-4 w-4 text-accent" />
                    <span>Checklist</span>
                  </Link>
                  <Link
                    href="/app/evidence"
                    className="flex items-center gap-2 rounded-lg border border-line bg-panel p-2.5 text-ink transition hover:border-accent"
                  >
                    <IconImages className="h-4 w-4 text-accent" />
                    <span>Evidence</span>
                  </Link>
                  <Link
                    href="/app/workspace"
                    className="flex items-center gap-2 rounded-lg border border-line bg-panel p-2.5 text-ink transition hover:border-accent"
                  >
                    <IconCandles className="h-4 w-4 text-accent" />
                    <span>Workspace</span>
                  </Link>
                  <Link
                    href="/app/journal"
                    className="flex items-center gap-2 rounded-lg border border-line bg-panel p-2.5 text-ink transition hover:border-accent"
                  >
                    <IconBook className="h-4 w-4 text-accent" />
                    <span>Journal</span>
                  </Link>
                </div>
              </div>
            </div>

            {/* Recent Gate Decisions Table */}
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-ink">Recent Decisions</h3>
                <Link href="/app/journal" className="text-xs text-accent hover:underline">
                  View full journal →
                </Link>
              </div>

              {recentDecisions.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted">
                  No trades checked yet. Open the{" "}
                  <Link href="/app/workspace" className="text-accent underline">
                    workspace
                  </Link>{" "}
                  to run your first pre-trade check.
                </div>
              ) : (
                <div className="mt-4 divide-y divide-line text-xs">
                  {recentDecisions.map((d) => {
                    const isApproved = d.result === "approved";
                    const isDenied = d.result === "denied";
                    const isOverridden = d.resolution === "overridden";

                    return (
                      <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              d.side === "buy" ? "bg-pass-bg text-pass" : "bg-err-bg text-fail"
                            }`}
                          >
                            {d.side}
                          </span>
                          <span className="font-medium text-ink">{d.instrument}</span>
                          <span className="text-[11px] text-muted">
                            {new Date(d.decided_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {isApproved && (
                            <span className="flex items-center gap-1 text-pass">
                              <IconCheck className="h-3.5 w-3.5" />
                              Pass
                            </span>
                          )}
                          {isDenied && (
                            <span className="flex items-center gap-1 text-fail">
                              <IconX className="h-3.5 w-3.5" />
                              Fail
                            </span>
                          )}
                          {!isApproved && !isDenied && (
                            <span className="flex items-center gap-1 text-maybe">
                              <IconRetry className="h-3.5 w-3.5" />
                              Evidence needed
                            </span>
                          )}

                          {isOverridden && (
                            <span className="rounded bg-warn-bg px-1.5 py-0.5 text-[10px] text-maybe">
                              Overridden
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppFrame>
  );
}

