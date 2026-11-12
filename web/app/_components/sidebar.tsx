"use client";

/**
 * Edge's side navigation (PR-CH-6), shared by every signed-in page.
 * Phones: slides over the page (menu button / X). Desktop: sits beside the
 * page and collapses with X; the menu button brings it back. Desktop
 * remembers the choice between visits.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import EdgeMark from "./edge-mark";
import { IconBook, IconCandles, IconChecklist, IconGauge, IconGear, IconImages, IconLogout, IconMenu, IconX } from "./icons";

export type Section = "checklist" | "evidence" | "workspace" | "journal" | "dashboard" | "settings";

const NAV: Array<{ key: Section; href: string; label: string; Icon: (p: { className?: string }) => React.ReactElement }> = [
  { key: "checklist", href: "/checklist", label: "Checklist", Icon: IconChecklist },
  { key: "evidence", href: "/app/evidence", label: "Evidence library", Icon: IconImages },
  { key: "workspace", href: "/app/workspace", label: "Trade workspace", Icon: IconCandles },
  { key: "journal", href: "/app/journal", label: "Journal", Icon: IconBook },
  { key: "dashboard", href: "/app", label: "Dashboard", Icon: IconGauge },
];

const DESKTOP = "(min-width: 768px)";
const STORE_KEY = "edge-sidebar";

/**
 * Open/closed state. `null` = default, decided by CSS (open on desktop,
 * closed on phones), so nothing flashes on load.
 */
export function useSidebar() {
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let closed = false;
    try {
      closed = window.matchMedia(DESKTOP).matches && localStorage.getItem(STORE_KEY) === "closed";
    } catch {
      /* storage blocked: keep the default */
    }
    if (!closed) return;
    // read once after mount (never during prerender); deferred so the effect stays side-effect only
    const id = requestAnimationFrame(() => setOpen(false));
    return () => cancelAnimationFrame(id);
  }, []);

  const toggle = useCallback((next: boolean) => {
    setOpen(next);
    try {
      if (window.matchMedia(DESKTOP).matches) localStorage.setItem(STORE_KEY, next ? "open" : "closed");
    } catch {
      /* not remembered: fine */
    }
  }, []);

  /** After picking something on a phone, get the overlay out of the way. */
  const closeIfMobile = useCallback(() => {
    if (!window.matchMedia(DESKTOP).matches) setOpen(null);
  }, []);

  return { open, toggle, closeIfMobile };
}

/** The ☰ button for the page header; hidden while the sidebar is showing. */
export function MenuButton({ open, onOpen }: { open: boolean | null; onOpen: () => void }) {
  if (open === true) return null;
  return (
    <button
      type="button"
      className={`icon-btn shrink-0 border-transparent ${open === null ? "md:hidden" : ""}`}
      onClick={onOpen}
      aria-label="Open menu"
      title="Open menu"
    >
      <IconMenu />
    </button>
  );
}

interface Props {
  active: Section;
  user: { name: string | null; email: string } | null;
  open: boolean | null;
  onClose: () => void;
  /** On the Checklist page, "Checklist" resets the page instead of navigating. */
  onChecklist?: () => void;
  onSignOut: () => void;
}

export default function Sidebar(p: Props) {
  const initial = (p.user?.name || p.user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      {/* phone scrim */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity md:hidden ${
          p.open === true ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={p.onClose}
        aria-hidden="true"
      />
      {/* phones: slides over the page; desktop: sits beside it and collapses
          (negative margin) so the content takes the full width when closed */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] shrink-0 flex-col border-r border-line bg-surface transition-[transform,margin] duration-200 md:relative md:z-auto md:translate-x-0 ${
          p.open === true
            ? "translate-x-0 md:ml-0"
            : p.open === false
              ? "-translate-x-full md:-ml-[260px]"
              : "-translate-x-full md:ml-0" /* default: closed on phones, open on desktop */
        }`}
        aria-label="Edge navigation"
        inert={p.open === false || undefined}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <Link href="/" className="inline-flex items-center gap-2.5 text-[1.15rem] font-semibold tracking-[-0.04em]">
            <EdgeMark className="h-8 w-10" />
            Edge
          </Link>
          <button type="button" className="icon-btn border-transparent" onClick={p.onClose} aria-label="Close menu" title="Close menu">
            <IconX />
          </button>
        </div>

        <nav className="mt-2 flex-1 space-y-0.5 px-3" aria-label="Sections">
          {NAV.map(({ key, href, label, Icon }) => {
            const current = p.active === key ? "page" : undefined;
            return key === "checklist" && p.onChecklist ? (
              <button key={key} type="button" className="side-link" aria-current={current} onClick={p.onChecklist}>
                <Icon /> {label}
              </button>
            ) : (
              <Link key={key} href={href} className="side-link" aria-current={current}>
                <Icon /> {label}
              </Link>
            );
          })}
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
            <Link
              href="/app/settings"
              className={`icon-btn h-8 w-8 border-transparent ${p.active === "settings" ? "text-ink" : ""}`}
              aria-label="Settings"
              aria-current={p.active === "settings" ? "page" : undefined}
              title="Settings"
            >
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
