"use client";

/**
 * Visual Library — maps chart screenshots to individual checklist rules
 * (PRD 4.3): rule → screenshot(s) → explanation → AI interpretation →
 * trader confirmation. This page is the index; each rule opens a detail view.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

interface Ref {
  id: string;
  polarity: string;
  approval_status: string;
  image: string;
  confirmed_interpretation: string | null;
}

interface Item {
  id: string;
  category: string;
  text: string;
  hard_gate: number;
  refs: Ref[];
  replaced_count: number;
}

interface EdgeSection {
  id: string;
  name: string;
  version_number: number;
  items: Item[];
}

export default function VisualLibraryPage() {
  const [edges, setEdges] = useState<EdgeSection[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/visual")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setEdges(d.edges);
      })
      .catch(() => setError("Could not load the Visual Library"));
  }, []);

  if (error) return <p className="text-fail">{error}</p>;
  if (!edges) return <p className="text-muted">Loading…</p>;

  const totalRefs = edges.reduce(
    (n, e) => n + e.items.reduce((m, i) => m + i.refs.length, 0),
    0
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl tracking-tight">Visual Library</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Chart examples attached to each rule, so the AI learns how you interpret your own
          checklist. Add a positive or negative example with an explanation, review what the AI
          understood, then confirm or correct it.
        </p>
      </div>

      {edges.length === 0 ? (
        <div className="card border-maybe/40">
          <span className="tag tag-maybe">No approved checklist yet</span>
          <p className="mt-3 text-sm text-muted">
            The Visual Library attaches examples to approved rules.{" "}
            <Link href="/app/edge/new" className="text-ink underline">
              Build your edge first →
            </Link>
          </p>
        </div>
      ) : totalRefs === 0 ? (
        <div className="card border-maybe/40">
          <span className="tag tag-maybe">No examples yet</span>
          <p className="mt-3 text-sm text-muted">
            Open any rule below and attach your first chart example — the AI will state how it reads
            the image against your rule, and you confirm or correct it.
          </p>
        </div>
      ) : null}

      {edges.map((edge) => (
        <section key={edge.id} className="card">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-medium">{edge.name}</h2>
            <span className="tag tag-pass">v{edge.version_number} approved</span>
            <span className="text-xs text-muted">
              {edge.items.reduce((n, i) => n + i.refs.length, 0)} example
              {edge.items.reduce((n, i) => n + i.refs.length, 0) === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="mt-4 divide-y divide-line">
            {edge.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/app/visual/${item.id}`}
                  className="flex items-center gap-3 py-3 transition-colors hover:opacity-80"
                >
                  <span className="tag tag-neutral shrink-0">{item.category}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{item.text}</span>
                  {item.hard_gate === 1 && (
                    <span className="tag tag-fail shrink-0">hard gate</span>
                  )}
                  <span className="flex shrink-0 items-center gap-1.5">
                    {item.refs.slice(0, 3).map((r) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={r.id}
                        src={r.image}
                        alt={r.polarity}
                        className={`h-9 w-14 rounded border object-cover ${
                          r.approval_status === "approved"
                            ? "border-[rgba(80,220,160,.5)]"
                            : "border-[rgba(255,200,80,.5)]"
                        }`}
                      />
                    ))}
                    {item.replaced_count > 0 && (
                      <span className="text-[10px] text-muted">+{item.replaced_count} old</span>
                    )}
                    {item.refs.length === 0 && (
                      <span className="text-xs text-muted">no examples</span>
                    )}
                    {item.refs.length > 0 && (
                      <span className="text-xs text-muted">{item.refs.length}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
