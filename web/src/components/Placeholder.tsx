type PlaceholderProps = {
  title: string;
  /** What this screen does, in the PRD's words. */
  summary: string;
  /** PRD sections, requirement IDs and flows this screen covers. */
  prd: string[];
  /** Who builds it (see AGENTS.md section 5). */
  owners: string;
  children?: React.ReactNode;
};

/**
 * Temporary stand-in for a screen that has not been built yet.
 * Replace the whole page when you build the real screen.
 */
export function Placeholder({ title, summary, prd, owners, children }: PlaceholderProps) {
  return (
    <section className="max-w-3xl">
      <p className="text-sm text-accent">Not built yet</p>
      <h1 className="mt-1 text-3xl font-medium tracking-tight">{title}</h1>
      <p className="mt-3 text-muted">{summary}</p>
      <dl className="mt-8 grid gap-4 rounded-2xl border border-line p-5 text-sm">
        <div>
          <dt className="text-muted">PRD references</dt>
          <dd className="mt-1">{prd.join(" · ")}</dd>
        </div>
        <div>
          <dt className="text-muted">Built by</dt>
          <dd className="mt-1">{owners}</dd>
        </div>
      </dl>
      {children}
    </section>
  );
}
