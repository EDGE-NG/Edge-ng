"use client";

import { useEffect, useState } from "react";
import { Toaster as SonnerToaster, toast } from "sonner";

export function Toaster() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    function updateTheme() {
      const t = document.documentElement.getAttribute("data-theme");
      setTheme(t === "light" ? "light" : "dark");
    }
    updateTheme();

    const observer = new MutationObserver(() => updateTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    window.addEventListener("edge:theme-changed", updateTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("edge:theme-changed", updateTheme);
    };
  }, []);

  // one-off notices passed in the URL by a server redirect, e.g. after Google
  // sign-in cancels a scheduled account deletion (/auth/callback)
  useEffect(() => {
    const url = new URL(window.location.href);
    const notice = url.searchParams.get("notice");
    if (notice === "deletion_cancelled") {
      toast.success("Welcome back. Your account deletion was cancelled.");
    }
    if (notice) {
      url.searchParams.delete("notice");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);

  useEffect(() => {
    function handleOnline() {
      toast.success("Connection restored. You are back online.", {
        id: "network-status",
        duration: 3500,
      });
    }

    function handleOffline() {
      toast.error("You are offline. Please check your internet connection.", {
        id: "network-status",
        duration: 8000,
      });
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      handleOffline();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <SonnerToaster
      position="top-right"
      theme={theme}
      richColors
      closeButton
      toastOptions={{
        style: {
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          color: "var(--color-ink)",
          fontFamily: "var(--font-sans)",
        },
      }}
    />
  );
}

export { toast };
