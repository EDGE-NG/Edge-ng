"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/app", label: "Dashboard", exact: true },
  { href: "/app/edge", label: "My Edge" },
  { href: "/app/visual", label: "Visual Library" },
  { href: "/app/review", label: "Trade Review" },
  { href: "/app/journal", label: "Journal" },
  { href: "/app/settings", label: "Settings" },
];

function NavLinks({
  variant,
  pathname,
}: {
  variant: "desktop" | "mobile";
  pathname: string;
}) {
  return (
    <ul className={variant === "desktop" ? "flex gap-7" : "flex overflow-x-auto"}>
      {NAV.map((n) => {
        const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
        return (
          <li key={n.href} className={variant === "mobile" ? "shrink-0" : undefined}>
            <Link
              href={n.href}
              className={
                variant === "desktop"
                  ? active
                    ? "text-ink text-[0.95rem] font-medium"
                    : "text-muted text-[0.95rem] hover:text-ink transition-colors"
                  : `block px-4 py-3 text-sm ${active ? "text-accent" : "text-muted"}`
              }
              aria-current={active ? "page" : undefined}
            >
              {n.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Reads the URL (usePathname) behind a Suspense boundary so prerendering a
 * dynamic route (whose URL data is only known at request time) can stream the
 * nav in instead of blocking the static shell. */
function Nav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();
  return <NavLinks variant={variant} pathname={pathname} />;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="sticky top-0 z-30 border-b border-line backdrop-blur-md"
        style={{
          background: "var(--color-header)",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/" aria-label="Edge home" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/edge-logo.svg" alt="Edge" className="logo-light h-7 w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/edge-logo-dark.svg" alt="Edge" className="logo-dark h-7 w-auto" />
          </Link>
          <nav aria-label="App" className="hidden md:block">
            <Suspense fallback={<NavLinks variant="desktop" pathname="" />}>
              <Nav variant="desktop" />
            </Suspense>
          </nav>
          <Link href="/" className="btn btn-sm shrink-0">
            ← Home
          </Link>
        </div>
        {/* compact nav for small screens */}
        <nav aria-label="App (mobile)" className="md:hidden border-t border-line">
          <Suspense fallback={<NavLinks variant="mobile" pathname="" />}>
            <Nav variant="mobile" />
          </Suspense>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">{children}</main>
      <footer className="border-t border-line px-5 py-6 text-center text-xs text-muted">
        © 2026 Edge · Decision support only, not financial advice. No signals. You make every trade.
      </footer>
    </div>
  );
}
