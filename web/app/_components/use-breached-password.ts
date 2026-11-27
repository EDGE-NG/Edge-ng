"use client";

import { useEffect, useState } from "react";

export const BREACHED_PASSWORD_WARNING =
  "This password appears in a known data breach. Choose a different one.";

/**
 * Debounced client hook that checks whether a new password (length >= 8)
 * appears in a known data breach via /api/auth/password-breach (Task M4, Figma 1b).
 */
export function useBreachedPassword(password: string, enabled: boolean): boolean {
  const [breachedPassword, setBreachedPassword] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || password.length < 8) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/auth/password-breach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { breached?: boolean };
        if (!controller.signal.aborted) {
          setBreachedPassword(data.breached ? password : null);
        }
      } catch {
        /* ignore aborted or network errors */
      }
    }, 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [password, enabled]);

  return enabled && password.length >= 8 && breachedPassword === password;
}
