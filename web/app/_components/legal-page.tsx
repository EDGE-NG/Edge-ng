import Link from "next/link";
import EdgeMark from "./edge-mark";

/**
 * Shared layout for the legal pages (/privacy, /terms): the Edge header, a
 * readable column of text, and links between the pages.
 */
export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** "23 November 2026": when the text last changed. */
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="theme-dark min-h-screen bg-bg text-ink">
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5">
        <Link href="/" className="inline-flex items-center gap-2.5 text-xl font-semibold tracking-[-0.04em]">
          <EdgeMark className="h-9 w-11" />
          Edge
        </Link>
        <Link href="/" className="text-sm text-muted hover:text-ink">
          ← Back to home
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <h1 className="text-[2rem] leading-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated {updated}</p>
        <div className="legal mt-8 space-y-6 text-[0.97rem] leading-relaxed text-ink/90">{children}</div>
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        <nav className="flex justify-center gap-5">
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
        </nav>
        <p className="mt-3">Edge is decision support, not financial advice. Trading involves risk.</p>
      </footer>
    </div>
  );
}

/** A numbered section with a heading. */
export function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
