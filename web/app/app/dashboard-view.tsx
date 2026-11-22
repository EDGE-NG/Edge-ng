"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppFrame from "../_components/app-frame";
import {
  IconAlertCircle,
  IconArrowRight,
  IconBars,
  IconCheckCircle,
  IconChecklist,
  IconChevronRight,
  IconClock,
  IconPlus,
  IconShield,
  IconTrendDown,
  IconTrendUp,
} from "../_components/icons";
import { toast } from "../_components/toaster";
import { handleSessionExpired } from "@/lib/client-auth";

type Period = "week" | "month";

interface DayStat {
  day: string; // YYYY-MM-DD in the trader's time zone
  trades: number;
  followed: number;
  broke: number;
  adherence: number | null;
}

interface RecentTrade {
  id: string;
  instrument: string;
  side: "buy" | "sell";
  decidedAt: string;
  rulesMet: number;
  rulesTotal: number;
  status: "followed" | "broke" | "pending";
}

interface DashboardData {
  period: Period;
  timezone: string;
  today: string;
  adherence: number | null;
  previousAdherence: number | null;
  tradesReviewed: number;
  sessions: number;
  brokeCount: number;
  rules: { total: number; ready: number; needExamples: number };
  lastSessions: DayStat[];
  days: DayStat[];
  recent: RecentTrade[];
}

/* ------------------------------------------------------------- dates ----- */

/** "2026-11-18" -> a Date at UTC midnight, formatted with timeZone UTC so the calendar day never shifts. */
const utcDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const fmtUtc = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
  utcDate(ymd).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
const addDays = (ymd: string, n: number) => {
  const d = utcDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function shortDay(ymd: string) {
  return `${fmtUtc(ymd, { weekday: "short" })} ${utcDate(ymd).getUTCDate()}`;
}

/** "Today, 09:42", "Yesterday, 15:10", "Mon 16, 08:25" in the trader's time zone. */
function tradeTime(iso: string, today: string, tz: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  if (day === today) return `Today, ${time}`;
  if (day === addDays(today, -1)) return `Yesterday, ${time}`;
  return `${shortDay(day)}, ${time}`;
}

/* ------------------------------------------------------------- view ------ */

export default function DashboardView() {
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/dashboard?period=${period}`);
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as DashboardData;
        if (alive) setData(body);
      } catch (err) {
        console.error("Failed to load the dashboard", err);
        if (alive) toast.error("Couldn't load your dashboard. Check your connection and try again.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [period]);

  const changePeriod = (p: Period) => {
    if (p === period) return;
    setLoading(true);
    setPeriod(p);
  };
  const unit = period === "week" ? "week" : "month";

  return (
    <AppFrame active="dashboard" title="Dashboard">
      <div className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6">
        {/* Heading */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-medium tracking-tight text-ink">Dashboard</h2>
            <p className="mt-1 text-sm text-muted">
              {data ? `${fmtUtc(data.today, { weekday: "long", day: "numeric", month: "long" })}. ` : ""}
              Here is how your plan is holding up.
            </p>
          </div>
          <div className="flex items-center gap-3 self-start">
            <PeriodSwitch value={period} onChange={changePeriod} />
            <Link
              href="/checklist"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-bg transition hover:brightness-110"
            >
              <IconPlus className="h-4 w-4" />
              New checklist
            </Link>
          </div>
        </div>

        {!data ? (
          <Skeleton />
        ) : (
          <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            {/* Stat cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard icon={<IconShield />} label="Plan adherence" value={data.adherence == null ? "–" : `${data.adherence}%`}>
                <AdherenceDelta now={data.adherence} before={data.previousAdherence} unit={unit} />
              </StatCard>
              <StatCard icon={<IconBars />} label="Trades reviewed" value={String(data.tradesReviewed)}>
                <span className="text-muted">
                  {data.tradesReviewed === 0
                    ? `None yet this ${unit}`
                    : `Across ${data.sessions} session${data.sessions === 1 ? "" : "s"} this ${unit}`}
                </span>
              </StatCard>
              <StatCard icon={<IconChecklist className="h-4 w-4" />} label="Active rules" value={String(data.rules.total)}>
                <span className="text-muted">
                  {data.rules.total === 0
                    ? "No approved checklist yet"
                    : data.rules.needExamples > 0
                      ? `${data.rules.needExamples} still need${data.rules.needExamples === 1 ? "s" : ""} chart examples`
                      : "All ready to check"}
                </span>
              </StatCard>
            </div>

            {/* Chart + next step */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
              {period === "week" ? (
                <SessionBars sessions={data.lastSessions} />
              ) : (
                <MonthCalendar days={data.days} today={data.today} />
              )}
              <NextStep rules={data.rules} />
            </div>

            <RecentTrades trades={data.recent} today={data.today} tz={data.timezone} />
          </div>
        )}
      </div>
    </AppFrame>
  );
}

/* ------------------------------------------------------------ pieces ----- */

function PeriodSwitch({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div role="group" aria-label="Dashboard period" className="flex h-10 rounded-lg border border-line bg-surface p-1">
      {(["week", "month"] as const).map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={value === p}
          onClick={() => onChange(p)}
          className={`rounded-md px-3 text-sm transition ${
            value === p ? "bg-panel font-medium text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {p === "week" ? "Week" : "Month"}
        </button>
      ))}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel text-accent">{icon}</span>
        {label}
      </div>
      <div className="mt-5 text-4xl font-medium tracking-tight text-ink">{value}</div>
      <div className="mt-3 text-xs">{children}</div>
    </div>
  );
}

function AdherenceDelta({ now, before, unit }: { now: number | null; before: number | null; unit: string }) {
  if (now == null) return <span className="text-muted">No trades reviewed this {unit}</span>;
  if (before == null) return <span className="text-muted">Nothing to compare with last {unit}</span>;
  const diff = now - before;
  if (diff === 0) return <span className="text-muted">Same as last {unit}</span>;
  const up = diff > 0;
  return (
    <span className={`inline-flex items-center gap-1.5 ${up ? "text-accent" : "text-maybe"}`}>
      {up ? <IconTrendUp /> : <IconTrendDown />}
      {Math.abs(diff)} {Math.abs(diff) === 1 ? "point" : "points"} {up ? "higher" : "lower"} than last {unit}
    </span>
  );
}

/** Week view: adherence for each of the last 5 trading days. */
function SessionBars({ sessions }: { sessions: DayStat[] }) {
  return (
    <section className="card p-5" aria-labelledby="bars-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="bars-title" className="text-sm font-medium text-ink">How closely you followed your plan</h3>
        <span className="text-xs text-muted">Last 5 sessions</span>
      </div>
      {sessions.length === 0 ? (
        <EmptyChart />
      ) : (
        <ul className="mt-6 grid h-[200px] grid-cols-5 items-end gap-3 sm:gap-6">
          {sessions.map((s, i) => {
            const latest = i === sessions.length - 1;
            const h = s.adherence == null ? 6 : Math.max(8, s.adherence);
            return (
              <li
                key={s.day}
                className="flex h-full flex-col items-center justify-end gap-2"
                aria-label={`${shortDay(s.day)}: ${s.adherence == null ? "no decided trades" : `${s.adherence}% followed`}, ${s.trades} trade${s.trades === 1 ? "" : "s"} reviewed`}
              >
                <span className={`text-xs ${latest ? "font-medium text-accent" : "text-muted"}`}>
                  {s.adherence == null ? "–" : `${s.adherence}%`}
                </span>
                <div className="flex w-full max-w-[64px] flex-1 items-end">
                  <div
                    className={`w-full rounded-md ${latest ? "bg-accent" : "bg-accent/20"}`}
                    style={{ height: `${h}%` }}
                  />
                </div>
                <span className={`text-xs ${latest ? "font-medium text-ink" : "text-muted"}`}>{shortDay(s.day)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Month view: a calendar with each trading day's adherence. */
function MonthCalendar({ days, today }: { days: DayStat[]; today: string }) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const first = `${today.slice(0, 8)}01`;
  const lead = (utcDate(first).getUTCDay() + 6) % 7; // Monday-first
  const d = utcDate(first);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDays(first, i)),
  ];
  while (cells.length % 7) cells.push(null);

  return (
    <section className="card p-5" aria-labelledby="cal-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="cal-title" className="text-sm font-medium text-ink">How closely you followed your plan</h3>
        <span className="text-xs text-muted">{fmtUtc(first, { month: "long", year: "numeric" })}</span>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-1.5 text-center text-[11px] text-muted" aria-hidden>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <ol className="mt-1.5 grid grid-cols-7 gap-1.5">
        {cells.map((day, i) => {
          if (!day) return <li key={`pad-${i}`} aria-hidden />;
          const s = byDay.get(day);
          const future = day > today;
          const isToday = day === today;
          const shade = s?.adherence != null ? 12 + Math.round(s.adherence * 0.55) : 0;
          const label = s
            ? `${fmtUtc(day, { weekday: "long", day: "numeric", month: "long" })}: ${
                s.adherence == null ? "no decided trades" : `${s.adherence}% followed`
              }, ${s.trades} trade${s.trades === 1 ? "" : "s"}${s.broke ? `, ${s.broke} override${s.broke === 1 ? "" : "s"}` : ""}`
            : `${fmtUtc(day, { weekday: "long", day: "numeric", month: "long" })}: no trades`;
          return (
            <li
              key={day}
              aria-label={label}
              className={`relative flex aspect-square min-h-[38px] flex-col justify-between rounded-md border p-1.5 text-left sm:min-h-[52px] ${
                isToday ? "border-accent" : "border-line"
              } ${future ? "opacity-40" : ""}`}
              style={shade ? { background: `color-mix(in srgb, var(--color-accent) ${shade}%, transparent)` } : undefined}
            >
              <span className={`text-[11px] ${s ? "text-ink" : "text-muted"}`}>{utcDate(day).getUTCDate()}</span>
              {s && (
                <span className="flex items-center justify-between gap-0.5 text-[11px] font-medium text-ink sm:text-xs">
                  {s.adherence == null ? "–" : `${s.adherence}%`}
                  {s.broke > 0 && <IconAlertCircle className="h-3 w-3 shrink-0 text-maybe" />}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          Less
          {[20, 40, 67].map((p) => (
            <span
              key={p}
              className="h-3 w-3 rounded-sm border border-line"
              style={{ background: `color-mix(in srgb, var(--color-accent) ${p}%, transparent)` }}
            />
          ))}
          More of your plan followed
        </span>
        <span className="flex items-center gap-1.5">
          <IconAlertCircle className="h-3 w-3 text-maybe" />
          Override used
        </span>
      </div>
    </section>
  );
}

function EmptyChart() {
  return (
    <div className="mt-6 grid h-[200px] place-items-center rounded-lg border border-dashed border-line px-6 text-center text-xs text-muted">
      <p>
        No trades checked yet. Open the{" "}
        <Link href="/app/workspace" className="text-accent underline">
          workspace
        </Link>{" "}
        to run your first pre-trade check.
      </p>
    </div>
  );
}

/** The one thing to do next: build a checklist, add examples, or check a trade. */
function NextStep({ rules }: { rules: DashboardData["rules"] }) {
  const step =
    rules.total === 0
      ? {
          title: "Build your checklist",
          text: "Describe your trading plan in your own words. Edge turns it into a checklist you approve.",
          href: "/checklist",
          cta: "Start a checklist",
        }
      : rules.needExamples > 0
        ? {
            title: "Add chart examples",
            text: `${rules.needExamples === 1 ? "One of your rules still needs" : `${numberWord(rules.needExamples)} of your rules still need`} examples. Edge learns what each rule looks like from the charts you show it.`,
            href: "/app/evidence",
            cta: "Add examples",
          }
        : {
            title: "Check your next trade",
            text: "Every rule is ready. Open the workspace and Edge checks the chart against your plan before you press Buy or Sell.",
            href: "/app/workspace",
            cta: "Open workspace",
          };
  const pctReady = rules.total ? Math.round((rules.ready / rules.total) * 100) : 0;

  return (
    <section className="card flex flex-col border-accent/30 bg-none bg-accent/[0.06] p-5" aria-labelledby="next-title">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted">Next step</span>
      <h3 id="next-title" className="mt-3 text-lg font-medium text-ink">{step.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{step.text}</p>
      {rules.total > 0 && (
        <div className="mt-5">
          <div className="text-xs text-ink">
            {rules.ready} of {rules.total} rules ready
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={rules.total}
            aria-valuenow={rules.ready}
            aria-label="Rules ready to check"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${pctReady}%` }} />
          </div>
        </div>
      )}
      <div className="mt-auto pt-5">
        <Link
          href={step.href}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-bg transition hover:brightness-110"
        >
          {step.cta}
          <IconArrowRight />
        </Link>
      </div>
    </section>
  );
}

function numberWord(n: number) {
  return ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][n] ?? String(n);
}

function RecentTrades({ trades, today, tz }: { trades: RecentTrade[]; today: string; tz: string }) {
  return (
    <section className="card p-0" aria-labelledby="recent-title">
      <div className="flex items-center justify-between px-5 py-4">
        <h3 id="recent-title" className="text-sm font-medium text-ink">Recent trades</h3>
        <Link href="/app/journal" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
          View journal
          <IconChevronRight />
        </Link>
      </div>
      {trades.length === 0 ? (
        <p className="border-t border-line px-5 py-6 text-xs text-muted">No trades checked yet.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {trades.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">
                  {t.instrument}
                  <span className="sr-only">, {t.side}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted">{tradeTime(t.decidedAt, today, tz)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                {t.rulesTotal > 0 && (
                  <span className="hidden text-xs text-muted sm:inline">
                    {t.rulesMet} of {t.rulesTotal} rules met
                  </span>
                )}
                <StatusPill status={t.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Never colour alone: every status has an icon and text (WCAG 2.2 AA). */
function StatusPill({ status }: { status: RecentTrade["status"] }) {
  const s = {
    followed: { text: "Followed plan", icon: <IconCheckCircle />, cls: "border-accent/40 bg-accent/10 text-accent" },
    broke: { text: "Broke a rule", icon: <IconAlertCircle />, cls: "border-maybe/40 bg-maybe/10 text-maybe" },
    pending: { text: "Needs evidence", icon: <IconClock />, cls: "border-line bg-panel text-muted" },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${s.cls}`}>
      {s.icon}
      {s.text}
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading your dashboard">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-[150px] animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="card h-[280px] animate-pulse" />
        <div className="card h-[280px] animate-pulse" />
      </div>
      <div className="card h-[200px] animate-pulse" />
    </div>
  );
}
