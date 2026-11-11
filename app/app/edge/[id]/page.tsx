"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";

interface Item {
  id: string;
  category: string;
  text: string;
  hard_gate: number;
  position: number;
  notes: string | null;
}

interface Version {
  id: string;
  version_number: number;
  status: string;
  created_at: string;
  approved_at: string | null;
  items: Item[];
}

interface EdgeDetail {
  edge: { id: string; name: string; description: string; active_version_id: string | null };
  versions: Version[];
}

export default function EdgeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<EdgeDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Refresh handler for after approve/discard — the initial load below keeps
  // the fetch inline in the effect so prerender validation can prove it is
  // effect-scoped (a useCallback reference cannot be proven and is flagged).
  const reload = useCallback(() => {
    fetch(`/api/edges/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Could not load edge"));
  }, [id]);

  useEffect(() => {
    fetch(`/api/edges/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Could not load edge"));
  }, [id]);

  if (error) return <p className="text-fail">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const active = data.versions.find((v) => v.id === data.edge.active_version_id) ?? null;
  const draft = data.versions.find((v) => v.status === "draft") ?? null;

  async function approveDraft() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/edges/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: draft.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Approve failed");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (!draft || discardBusy) return;
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setDiscardBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/edges/${id}?versionId=${draft.id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Discard failed");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discard failed");
    } finally {
      setDiscardBusy(false);
      setConfirmDiscard(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/app/edge" className="text-sm text-muted hover:text-ink">
            ← My Edge
          </Link>
          <h1 className="mt-1 text-3xl tracking-tight">{data.edge.name}</h1>
          <p className="mt-1 max-w-2xl whitespace-pre-line text-sm text-muted">
            {data.edge.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/app/edge/${id}/settings`} className="btn">
            Edge settings
          </Link>
          <Link href={`/app/review?edgeId=${id}`} className="btn btn-main">
            Review a setup
          </Link>
        </div>
      </div>

      {/* active approved version */}
      <section>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium">Active checklist</h2>
          {active ? (
            <span className="tag tag-pass">v{active.version_number} approved</span>
          ) : (
            <span className="tag tag-maybe">No approved version yet</span>
          )}
        </div>
        {active ? (
          <div className="mt-3 space-y-2">
            {active.items.map((it) => (
              <div key={it.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
                <span className="tag tag-neutral mt-0.5 shrink-0">{it.category}</span>
                <div className="min-w-0">
                  <p className="text-sm">{it.text}</p>
                  {it.notes && <p className="mt-1 text-xs text-muted">{it.notes}</p>}
                </div>
                {it.hard_gate === 1 && (
                  <span className="tag tag-fail mt-0.5 ml-auto shrink-0">hard gate</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Approve the draft below to activate this checklist for reviews.
          </p>
        )}
      </section>

      {/* draft awaiting approval */}
      {draft && (
        <section className="card border-maybe/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Draft v{draft.version_number}</h2>
              <p className="text-sm text-muted">{draft.items.length} rules — edits allowed here</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/app/edge/${id}/edit?versionId=${draft.id}`}
                className="btn min-h-9 px-4 text-sm"
              >
                Edit rules
              </Link>
              <button
                className="btn btn-danger min-h-9 px-4 text-sm"
                onClick={discardDraft}
                disabled={discardBusy}
                aria-pressed={confirmDiscard}
              >
                {discardBusy
                  ? "Discarding…"
                  : confirmDiscard
                    ? "Click again to discard"
                    : "Discard draft"}
              </button>
              <button
                className="btn btn-main min-h-9 px-4 text-sm"
                onClick={approveDraft}
                disabled={busy}
              >
                {busy ? "Approving…" : "Approve draft"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* version history */}
      <section>
        <h2 className="text-lg font-medium">Version history</h2>
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {data.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm">
                v{v.version_number} · {v.items.length} rules
              </span>
              <span className="flex items-center gap-3 text-xs text-muted">
                {v.approved_at && (
                  <span>approved {new Date(v.approved_at).toLocaleDateString()}</span>
                )}
                {v.status === "approved" ? (
                  <span className="tag tag-pass">immutable</span>
                ) : (
                  <span className="tag tag-maybe">draft</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Approved versions never change, so past reviews always show the rules that applied then.
        </p>
      </section>
    </div>
  );
}
