"use client";

/**
 * Placeholder for a section that will be rebuilt from scratch on the PRD.
 * Keeps the navigation working and says plainly what will live here.
 */
import Link from "next/link";
import AppFrame from "./app-frame";
import type { Section } from "./sidebar";

const COPY: Record<Exclude<Section, "checklist">, { title: string; lead: string; points: string[]; prd: string }> = {
  evidence: {
    title: "Evidence library",
    lead: "Show Edge what each rule looks like on a chart.",
    points: [
      "Add 1 to 6 chart images per rule, marked as a valid or an invalid example",
      "Edge explains how it reads each image; you confirm or correct it",
      "A coverage check nudges you toward different timeframes and market conditions",
    ],
    prd: "PRD 4.3",
  },
  workspace: {
    title: "Trade workspace",
    lead: "Check a setup against your checklist before you trade.",
    points: [
      "Pick the instrument and platform, then open the chart beside your live checklist",
      "Each rule shows Pass, Fail, Inconclusive or Not yet checked as you move through timeframes",
      "Press Buy or Sell: Edge approves, denies, or asks for the view it still needs",
    ],
    prd: "PRD 4.4 and 4.5",
  },
  journal: {
    title: "Journal",
    lead: "Every decision, recorded without judgment.",
    points: [
      "An entry for every gated decision: approved, denied and accepted, or overridden",
      "The evidence and rules behind each decision, kept as they were at the time",
      "Execution quality scored separately from profit or loss",
    ],
    prd: "PRD 4.6",
  },
  dashboard: {
    title: "Dashboard",
    lead: "What your discipline is worth, by day, week and month.",
    points: [
      "Plan adherence: trades that passed, denials you accepted, and overrides",
      "Performance: P&L, win rate, risk to reward, drawdown",
      "Do overridden trades do better or worse than approved ones?",
    ],
    prd: "PRD 4.7",
  },
  settings: {
    title: "Settings",
    lead: "Your account, notifications and data.",
    points: [
      "Profile, timezone and preferred markets",
      "Notification preferences and quiet hours",
      "Export your data or delete your account",
    ],
    prd: "PRD 4.8",
  },
};

export default function ComingNext({ section }: { section: Exclude<Section, "checklist"> }) {
  const c = COPY[section];
  return (
    <AppFrame active={section} title={c.title}>
      <div className="mx-auto w-full max-w-[720px] px-4 py-12 sm:px-6">
        <section className="card p-7 sm:p-8 fade-up">
          <span className="tag tag-maybe">Coming next</span>
          <h2 className="mt-4 text-[1.9rem] leading-tight font-light tracking-[-0.04em]">{c.lead}</h2>
          <ul className="mt-6 space-y-3">
            {c.points.map((pt) => (
              <li key={pt} className="flex gap-3 text-[0.97rem] text-ink/85">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {pt}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <span className="text-xs text-muted">{c.prd}</span>
            <Link href="/checklist" className="btn btn-main btn-sm">
              Go to your checklist
            </Link>
          </div>
        </section>
      </div>
    </AppFrame>
  );
}
