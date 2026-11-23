"use client";

import { toast } from "../app/_components/toaster";

let isRedirecting = false;

/** The signed-in trader's cached name and photo (shown by the sidebar before /api/auth/me answers). */
function clearCachedProfile() {
  try {
    localStorage.removeItem("edge-user-profile");
    localStorage.removeItem("edge-user-avatar");
  } catch {
    /* ignore storage blocked */
  }
}

/**
 * Sign the trader out everywhere in the app (sidebar, Settings): end the
 * Supabase session, clear the cached profile so the next person on this
 * device never sees it, then go to the home page. Returns false, and leaves
 * the trader signed in, if the server couldn't be reached.
 * Pass the page's `useRouter()`.
 */
export async function signOut(router: { push: (href: string) => void; refresh: () => void }): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error("Sign out failed", err);
    toast.error("Couldn't sign you out. Check your connection and try again.");
    return false;
  }
  clearCachedProfile();
  router.push("/");
  router.refresh();
  return true;
}

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
  clearCachedProfile();
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
