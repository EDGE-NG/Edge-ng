/** Small marks used by the workspace: rule status dots and a few line icons. */
import type { Status } from "./types";

type P = { className?: string };
const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

export const Tick = ({ className = "h-[11px] w-[11px]" }: P) => (
  <svg {...base} strokeWidth={2.6} className={className}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const Cross = ({ className = "h-[11px] w-[11px]" }: P) => (
  <svg {...base} strokeWidth={2.6} className={className}>
    <path d="M7 7l10 10M17 7L7 17" />
  </svg>
);
export const Lock = ({ className = "h-[11px] w-[11px]" }: P) => (
  <svg {...base} className={className}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const Pencil = ({ className = "h-3.5 w-3.5" }: P) => (
  <svg {...base} className={className}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);
export const Refresh = ({ className = "h-[15px] w-[15px]" }: P) => (
  <svg {...base} className={className}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </svg>
);
export const Info = ({ className = "h-3.5 w-3.5" }: P) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.01" />
  </svg>
);
export const Chevron = ({ className = "h-3.5 w-3.5" }: P) => (
  <svg {...base} className={className}>
    <path d="M9.5 6l6 6-6 6" />
  </svg>
);
export const ArrowUpRight = ({ className = "h-3.5 w-3.5" }: P) => (
  <svg {...base} className={className}>
    <path d="M7 17L17 7M9 7h8v8" />
  </svg>
);
export const ArrowDownRight = ({ className = "h-3.5 w-3.5" }: P) => (
  <svg {...base} className={className}>
    <path d="M7 7l10 10M17 9v8H9" />
  </svg>
);

export type DotState = Status | "checking" | "ask";

/**
 * A rule's status mark. Never colour alone: the shape differs per state
 * (tick, cross, "?", dashed ring, spinner) and the row always carries text too.
 */
export function StatusDot({ state }: { state: DotState }) {
  const box = "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full";
  if (state === "pass") return <span className={`${box} bg-accent text-bg`} aria-hidden><Tick /></span>;
  if (state === "fail") return <span className={`${box} bg-fail text-bg`} aria-hidden><Cross /></span>;
  if (state === "inconclusive") return <span className={`${box} bg-accent text-[11px] font-bold text-bg`} aria-hidden>?</span>;
  if (state === "checking")
    return <span className={`${box} animate-spin border-2 border-accent/20 border-t-accent motion-reduce:animate-none`} aria-hidden />;
  if (state === "ask") return <span className={`${box} border-2 border-maybe`} aria-hidden />;
  return <span className={`${box} border-[1.5px] border-dashed border-muted/70`} aria-hidden />;
}

export const STATUS_TEXT: Record<DotState, string> = {
  pass: "Passes",
  fail: "Fails",
  inconclusive: "Unclear",
  unchecked: "Not checked yet",
  checking: "Checking…",
  ask: "Your answer",
};

export const STATUS_TONE: Record<DotState, string> = {
  pass: "text-accent",
  fail: "text-fail",
  inconclusive: "text-maybe",
  unchecked: "text-muted",
  checking: "text-accent",
  ask: "text-maybe",
};
