"use client";

/**
 * Edge's side navigation (PR-CH-6), shared by every signed-in page.
 * Phones: slides over the page (menu button / X). Desktop: sits beside the
 * page without the X button; users can collapse it to an icon-only mode
 * (remembered in localStorage) to save screen space while keeping all links accessible.
 */
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import EdgeMark from "./edge-mark";
import {
  IconBook,
  IconCandles,
  IconChecklist,
  IconGauge,
  IconGear,
  IconImages,
  IconLogout,
  IconMenu,
  IconSidebarCollapse,
  IconSidebarExpand,
  IconX,
} from "./icons";

export type Section = "dashboard" | "workspace" | "journal" | "checklist" | "evidence" | "settings";

interface NavItem {
  key: Section;
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.ReactElement;
}

const PRIMARY_NAV: NavItem[] = [
  { key: "dashboard", href: "/app", label: "Dashboard", Icon: IconGauge },
  { key: "workspace", href: "/app/workspace", label: "Trade workspace", Icon: IconCandles },
  { key: "journal", href: "/app/journal", label: "Journal", Icon: IconBook },
];

const EDGE_NAV: NavItem[] = [
  { key: "checklist", href: "/checklist", label: "Checklist", Icon: IconChecklist },
  { key: "evidence", href: "/app/evidence", label: "Evidence library", Icon: IconImages },
];

const PREFERENCES_NAV: NavItem[] = [
  { key: "settings", href: "/app/settings", label: "Settings", Icon: IconGear },
];

const COLLAPSED_KEY = "edge-sidebar-collapsed";
const AVATAR_KEY = "edge-user-avatar";
const PROFILE_KEY = "edge-user-profile";

function subscribeCollapsed(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener("edge:sidebar-collapsed-change", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("edge:sidebar-collapsed-change", cb);
  };
}

function getCollapsedSnapshot() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function getCollapsedServerSnapshot() {
  return false;
}

/**
 * Open/closed state for mobile drawer.
 */
export function useSidebar() {
  const [open, setOpen] = useState<boolean | null>(null);

  const toggle = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  /** After picking something on a phone, if needed */
  const closeIfMobile = useCallback(() => {
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches) {
      setOpen(null);
    }
  }, []);

  return { open, toggle, closeIfMobile };
}

/** The ☰ button for the page header; shown only on mobile when sidebar is closed. */
export function MenuButton({ open, onOpen }: { open: boolean | null; onOpen: () => void }) {
  if (open === true) return null;
  return (
    <button
      type="button"
      className="icon-btn shrink-0 border-transparent md:hidden"
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
  user: { name: string | null; email: string; avatarUrl?: string | null } | null;
  open: boolean | null;
  onClose: () => void;
  /** On the Checklist page, "Checklist" resets the page instead of navigating. */
  onChecklist?: () => void;
  onSignOut: () => void;
}

export default function Sidebar(p: Props) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, getCollapsedSnapshot, getCollapsedServerSnapshot);
  const [profileOverride, setProfileOverride] = useState<{ displayName?: string; avatarUrl?: string | null } | null>(null);

  useEffect(() => {
    function handleProfileUpdate(e: Event) {
      const custom = e as CustomEvent<{ displayName?: string; avatarUrl?: string | null }>;
      if (!custom.detail) return;
      setProfileOverride(custom.detail);
      try {
        if (custom.detail.avatarUrl) localStorage.setItem(AVATAR_KEY, custom.detail.avatarUrl);
        const existing = localStorage.getItem(PROFILE_KEY);
        const parsed = existing ? JSON.parse(existing) : {};
        if (custom.detail.displayName !== undefined) parsed.name = custom.detail.displayName;
        if (custom.detail.avatarUrl !== undefined) parsed.avatarUrl = custom.detail.avatarUrl;
        localStorage.setItem(PROFILE_KEY, JSON.stringify(parsed));
      } catch {
        /* storage blocked */
      }
    }
    window.addEventListener("edge:profile-updated", handleProfileUpdate);
    return () => window.removeEventListener("edge:profile-updated", handleProfileUpdate);
  }, []);

  useEffect(() => {
    if (p.user) {
      try {
        if (p.user.avatarUrl) localStorage.setItem(AVATAR_KEY, p.user.avatarUrl);
        localStorage.setItem(
          PROFILE_KEY,
          JSON.stringify({
            name: p.user.name,
            email: p.user.email,
            avatarUrl: p.user.avatarUrl,
          })
        );
      } catch {
        /* storage blocked */
      }
    }
  }, [p.user]);

  let cachedUser: { name?: string | null; email?: string; avatarUrl?: string | null } | null = null;
  let cachedAvatar: string | null = null;
  if (typeof window !== "undefined") {
    try {
      cachedAvatar = localStorage.getItem(AVATAR_KEY);
      const rawProfile = localStorage.getItem(PROFILE_KEY);
      if (rawProfile) cachedUser = JSON.parse(rawProfile);
    } catch {
      /* storage blocked */
    }
  }

  const toggleCollapsed = useCallback(() => {
    try {
      const current = localStorage.getItem(COLLAPSED_KEY) === "true";
      localStorage.setItem(COLLAPSED_KEY, (!current).toString());
      window.dispatchEvent(new Event("edge:sidebar-collapsed-change"));
    } catch {
      /* storage blocked */
    }
  }, []);

  const currentUser = {
    name:
      profileOverride?.displayName !== undefined
        ? profileOverride.displayName
        : (p.user?.name ?? cachedUser?.name ?? null),
    email: p.user?.email || cachedUser?.email || "",
    avatarUrl:
      profileOverride?.avatarUrl !== undefined
        ? profileOverride.avatarUrl
        : (p.user?.avatarUrl ?? cachedUser?.avatarUrl ?? cachedAvatar),
  };

  const initial = (currentUser.name || currentUser.email || "?").trim().charAt(0).toUpperCase();

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
      {/* phones: slides over the page; desktop: sits beside it and collapses to icon-only mode */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-line bg-surface transition-[width,transform] duration-200 ease-in-out md:relative md:z-auto md:translate-x-0 ${
          collapsed ? "w-[260px] md:w-[68px]" : "w-[260px]"
        } ${
          p.open === true ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
        aria-label="Edge navigation"
      >
        {/* Header */}
        <div
          className={`flex h-16 items-center px-4 transition-all ${
            collapsed ? "justify-between md:justify-center md:px-0" : "justify-between"
          }`}
        >
          {/* Expanded brand on the left */}
          <Link
            href="/app"
            className={`inline-flex items-center gap-2.5 text-[1.15rem] font-semibold tracking-[-0.04em] ${
              collapsed ? "md:hidden" : ""
            }`}
          >
            <EdgeMark className="h-8 w-10 shrink-0" />
            <span>Edge</span>
          </Link>

          {/* Desktop collapse button when expanded: cleanly pinned to top-right */}
          {!collapsed && (
            <button
              type="button"
              className="icon-btn border-transparent hidden md:inline-flex text-muted hover:text-ink hover:bg-white/[0.06] transition"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar (icons only)"
              title="Collapse sidebar (icons only)"
            >
              <IconSidebarCollapse className="h-4 w-4" />
            </button>
          )}

          {/* Collapsed state on desktop: Single centered brand mark that smoothly reveals Expand on hover */}
          {collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="group relative hidden md:flex h-10 w-10 items-center justify-center rounded-xl text-muted transition hover:bg-white/[0.06] hover:text-ink"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              {/* Resting state: Centered Edge logo mark */}
              <EdgeMark className="h-7 w-7 transition-all duration-150 group-hover:scale-90 group-hover:opacity-0" />
              {/* Hover state: Expand icon fades in cleanly in accent green */}
              <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-150 group-hover:opacity-100">
                <IconSidebarExpand className="h-5 w-5 text-accent" />
              </span>
            </button>
          )}

          {/* Mobile close button: only on small screens */}
          <button
            type="button"
            className="icon-btn border-transparent md:hidden text-muted hover:text-ink"
            onClick={p.onClose}
            aria-label="Close menu"
            title="Close menu"
          >
            <IconX />
          </button>
        </div>

        {/* Navigation links */}
        <nav className={`mt-2 flex-1 space-y-0.5 ${collapsed ? "px-3 md:px-2" : "px-3"}`} aria-label="Sections">
          {PRIMARY_NAV.map(({ key, href, label, Icon }) => {
            const current = p.active === key ? "page" : undefined;
            return (
              <Link
                key={key}
                href={href}
                className={`side-link ${collapsed ? "md:justify-center md:px-0 md:gap-0" : ""}`}
                aria-current={current}
                title={label}
                aria-label={label}
              >
                <Icon />
                <span className={collapsed ? "md:hidden" : ""}>{label}</span>
              </Link>
            );
          })}

          <div className="pt-3 pb-1">
            <div className="border-t border-line/60" />
            <span
              className={`mt-2.5 block px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted/60 ${
                collapsed ? "md:hidden" : ""
              }`}
            >
              Your Edge
            </span>
          </div>

          {EDGE_NAV.map(({ key, href, label, Icon }) => {
            const current = p.active === key ? "page" : undefined;
            return key === "checklist" && p.onChecklist ? (
              <button
                key={key}
                type="button"
                className={`side-link ${collapsed ? "md:justify-center md:px-0 md:gap-0" : ""}`}
                aria-current={current}
                onClick={p.onChecklist}
                title={label}
                aria-label={label}
              >
                <Icon />
                <span className={collapsed ? "md:hidden" : ""}>{label}</span>
              </button>
            ) : (
              <Link
                key={key}
                href={href}
                className={`side-link ${collapsed ? "md:justify-center md:px-0 md:gap-0" : ""}`}
                aria-current={current}
                title={label}
                aria-label={label}
              >
                <Icon />
                <span className={collapsed ? "md:hidden" : ""}>{label}</span>
              </Link>
            );
          })}

          <div className="pt-3 pb-1">
            <div className="border-t border-line/60" />
          </div>

          {PREFERENCES_NAV.map(({ key, href, label, Icon }) => {
            const current = p.active === key ? "page" : undefined;
            return (
              <Link
                key={key}
                href={href}
                className={`side-link ${collapsed ? "md:justify-center md:px-0 md:gap-0" : ""}`}
                aria-current={current}
                title={label}
                aria-label={label}
              >
                <Icon />
                <span className={collapsed ? "md:hidden" : ""}>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User profile card & sign out */}
        <div className={`border-t border-line ${collapsed ? "p-3 md:p-2" : "p-3"}`}>
          <div
            className={`flex items-center rounded-xl transition hover:bg-white/[0.04] ${
              collapsed ? "justify-between gap-1 p-1 md:flex-col md:gap-2 md:p-1" : "justify-between gap-1 p-1"
            }`}
          >
            <Link
              href="/app/settings"
              className={`flex min-w-0 items-center rounded-lg transition group ${
                collapsed ? "flex-1 gap-3 px-1.5 py-1 md:flex-initial md:justify-center md:p-1" : "flex-1 gap-3 px-1.5 py-1"
              }`}
              title={currentUser?.name ? `${currentUser.name} (Settings)` : "Trader profile & settings"}
              aria-label="Trader profile & settings"
            >
              {currentUser?.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.name || "Avatar"}
                  className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-accent/30 group-hover:ring-accent/70 transition"
                />
              ) : (
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-[#04110a] group-hover:brightness-110 transition"
                  style={{ background: "linear-gradient(135deg,#e6ff5a,#5ef088)" }}
                  aria-hidden="true"
                >
                  {initial}
                </span>
              )}
              <div className={`min-w-0 flex-1 ${collapsed ? "md:hidden" : ""}`}>
                <p className="truncate text-sm font-medium text-ink group-hover:text-accent transition-colors">
                  {currentUser?.name || "Trader"}
                </p>
                <p className="truncate text-xs text-muted">{currentUser?.email}</p>
              </div>
            </Link>
            <button
              type="button"
              className="icon-btn h-8 w-8 shrink-0 border-transparent text-muted hover:text-ink"
              onClick={p.onSignOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <IconLogout />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
