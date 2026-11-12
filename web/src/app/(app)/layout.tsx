import Link from "next/link";

// PR-CH-6: side navigation to chats, evidence library, trade workspace, journal and dashboard.
const NAV = [
  { href: "/chat", label: "Chat" },
  { href: "/checklist", label: "Checklist" },
  { href: "/evidence", label: "Evidence library" },
  { href: "/workspace", label: "Trade workspace" },
  { href: "/journal", label: "Journal" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-line p-4 md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          Edge
        </Link>
        <nav aria-label="App" className="mt-6">
          <ul className="flex gap-4 overflow-x-auto md:flex-col md:gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block whitespace-nowrap rounded-lg px-3 py-2 text-muted hover:bg-white/5 hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="flex-1 p-6 md:p-10">{children}</main>
    </div>
  );
}
