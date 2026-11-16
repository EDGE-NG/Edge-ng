"use client";

import { toast } from "../app/_components/toaster";

let isRedirecting = false;

/**
 * Handles session expiration across all client-side views.
 * When an authenticated API endpoint returns HTTP 401:
 * 1. Shows a professional, user-friendly notice (never raw API strings).
 * 2. Redirects to /login preserving the current URL in `?from=...`.
 * 3. Prevents duplicate toasts or multiple redirect timers.
 */
export function handleSessionExpired(message = "Your session has expired. Redirecting to sign in...") {
  if (typeof window === "undefined" || isRedirecting) return;
  isRedirecting = true;
  toast.error(message, { duration: 3000 });
  setTimeout(() => {
    try {
      const current = window.location.pathname + window.location.search;
      const target =
        current && current !== "/" && !current.startsWith("/login") && !current.startsWith("/signup")
          ? `/login?from=${encodeURIComponent(current)}`
          : "/login";
      window.location.href = target;
    } catch {
      window.location.href = "/login";
    }
  }, 1200);
}
