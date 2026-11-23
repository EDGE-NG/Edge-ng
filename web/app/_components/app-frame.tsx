"use client";

/** Signed-in page frame: the shared sidebar plus a page header. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar, { MenuButton, useSidebar, type Section } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { handleSessionExpired, signOut } from "@/lib/client-auth";

export default function AppFrame({
  active,
  title,
  actions,
  children,
}: {
  active: Section;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { open, toggle } = useSidebar();
  const [user, setUser] = useState<{ name: string | null; email: string; avatarUrl?: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        if (res.ok) {
          const d = await res.json();
          if (alive && d.user) {
            setUser(d.user);
            try {
              localStorage.setItem("edge-user-profile", JSON.stringify(d.user));
              if (d.user.avatarUrl) localStorage.setItem("edge-user-avatar", d.user.avatarUrl);
            } catch {}
          }
        }
      } catch (err) {
        console.error("Failed to load user profile in AppFrame:", err);
      }
    })();

    function handleProfileUpdate(e: Event) {
      const custom = e as CustomEvent<{ displayName?: string; avatarUrl?: string | null }>;
      if (!custom.detail) return;
      setUser((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          name: custom.detail.displayName !== undefined ? custom.detail.displayName : prev.name,
          avatarUrl: custom.detail.avatarUrl !== undefined ? custom.detail.avatarUrl : prev.avatarUrl,
        };
      });
    }

    window.addEventListener("edge:profile-updated", handleProfileUpdate);

    return () => {
      alive = false;
      window.removeEventListener("edge:profile-updated", handleProfileUpdate);
    };
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar active={active} user={user} open={open} onClose={() => toggle(false)} onSignOut={() => void signOut(router)} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
          <MenuButton open={open} onOpen={() => toggle(true)} />
          <h1 className="truncate text-[1.05rem] font-medium tracking-[-0.02em]">{title}</h1>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle />
            {actions}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
