"use client";

/**
 * Side navigation (PR-CH-6): Checklist (this page), then the rest of Edge.
 * Creating a new checklist lives on the Checklist page itself (top right).
 */
import Link from "next/link";
import EdgeMark from "../_components/edge-mark";
import { IconBook, IconCandles, IconChecklist, IconGauge, IconGear, IconImages, IconLogout, IconX } from "./icons";

interface Props {
  user: { name: string | null; email: string } | null;
  open: boolean;
  onClose: () => void;
  onChecklist: () => void;
  onSignOut: () => void;
}

const NAV = [
  { href: "/app/visual", label: "Evidence library", Icon: IconImages },
  { href: "/app/review", label: "Trade workspace", Icon: IconCandles },
  { href: "/app/journal", label: "Journal", Icon: IconBook },
  { href: "/app", label: "Dashboard", Icon: IconGauge },
];

export default function Sidebar(p: Props) {
  const initial = (p.user?.name || p.user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      {/* mobile scrim */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity md:hidden ${
          p.open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={p.onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-line bg-surface transition-transform md:static md:z-auto md:translate-x-0 ${
          p.open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Edge navigation"
      >
        <div className="flex h-16 items-center justify-between px-4">
          <Link href="/" className="inline-flex items-center gap-2.5 text-[1.15rem] font-semibold tracking-[-0.04em]">
            <EdgeMark className="h-8 w-10" />
            Edge
          </Link>
          <button type="button" className="icon-btn border-transparent md:hidden" onClick={p.onClose} aria-label="Close menu">
            <IconX />
          </button>
        </div>

        <nav className="mt-2 flex-1 space-y-0.5 px-3" aria-label="Sections">
          <button type="button" className="side-link" aria-current="page" onClick={p.onChecklist}>
            <IconChecklist /> Checklist
          </button>
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className="side-link">
              <Icon /> {label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-[#04110a]"
              style={{ background: "linear-gradient(135deg,#e6ff5a,#5ef088)" }}
              aria-hidden="true"
            >
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{p.user?.name || "Trader"}</p>
              <p className="truncate text-xs text-muted">{p.user?.email}</p>
            </div>
            <Link href="/app/settings" className="icon-btn h-8 w-8 border-transparent" aria-label="Settings">
              <IconGear />
            </Link>
            <button type="button" className="icon-btn h-8 w-8 border-transparent" onClick={p.onSignOut} aria-label="Sign out" title="Sign out">
              <IconLogout />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
