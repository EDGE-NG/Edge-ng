"use client";

/** Signed-in page frame: the shared sidebar plus a page header. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar, { MenuButton, useSidebar, type Section } from "./sidebar";

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
  const [user, setUser] = useState<{ name: string | null; email: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/auth/me");
      if (res.status === 401) {
        // stale cookie: clear it so /login doesn't bounce back here
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        router.replace("/login");
        return;
      }
      const d = await res.json();
      if (alive) setUser(d.user);
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar active={active} user={user} open={open} onClose={() => toggle(false)} onSignOut={signOut} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
          <MenuButton open={open} onOpen={() => toggle(true)} />
          <h1 className="truncate text-[1.05rem] font-medium tracking-[-0.02em]">{title}</h1>
          {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
