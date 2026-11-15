"use client";

import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "./icons";

export type Theme = "light" | "dark" | "system";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const t = localStorage.getItem("edge-theme");
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    // ignore
  }
  return "dark";
}

export function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("edge-theme", theme);
  } catch {
    // ignore
  }

  let resolved = theme;
  if (theme === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", resolved);
  window.dispatchEvent(new CustomEvent("edge:theme-changed", { detail: theme }));
}

function subscribeTheme(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("edge:theme-changed", callback);
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", callback);
  return () => {
    window.removeEventListener("edge:theme-changed", callback);
    mq.removeEventListener("change", callback);
  };
}

function getThemeSnapshot(): Theme {
  return getStoredTheme();
}

function getServerSnapshot(): Theme {
  return "dark";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const currentTheme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerSnapshot);

  const isLight =
    currentTheme === "light" ||
    (currentTheme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: light)").matches);

  function toggle() {
    const next: Theme = isLight ? "dark" : "light";
    applyTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`icon-btn h-8 w-8 rounded-full border border-line text-muted transition hover:border-accent/50 hover:text-ink ${className}`}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
    >
      {isLight ? <IconMoon className="h-4 w-4" /> : <IconSun className="h-4 w-4 text-accent" />}
    </button>
  );
}
