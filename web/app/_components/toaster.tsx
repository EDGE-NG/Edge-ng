"use client";

import { useEffect } from "react";
import { Toaster as SonnerToaster, toast } from "sonner";

export function Toaster() {
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
      theme="dark"
      richColors
      closeButton
      toastOptions={{
        className: "!bg-[#0c1511] !border-[#1e2f25] !text-[#e6f5eb] font-sans shadow-xl",
      }}
    />
  );
}

export { toast };
