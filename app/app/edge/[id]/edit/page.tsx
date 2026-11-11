"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

const CATEGORIES = [
  { value: "entry", label: "Entry condition" },
  { value: "context", label: "Context filter" },
  { value: "confirmation", label: "Confirmation" },
  { value: "invalidation", label: "Invalidation" },
  { value: "risk", label: "Risk rule" },
  { value: "note", label: "Note" },
];

interface EditableItem {
  category: string;
  text: string;
  hard_gate: boolean;
  notes?: string | null;
}

export default function EditDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ versionId?: string }>;
}) {
  const { id } = use(params);
  const { versionId } = use(searchParams);

  const [items, setItems] = useState<EditableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolvedVersionId, setResolvedVersionId] = useState<string>("");

  useEffect(() => {
    fetch(`/api/edges/${id}`)
      .then((r) => r.json())
      .then(async (d) => {
        if (d.error) throw new Error(d.error);
        let versions: Array<{
          id: string;
          status: string;
          items: Array<Record<string, unknown>>;
        }> = d.versions ?? [];

        // No versionId in the URL (e.g. "Update the checklist" menu): open the
        // open draft, or spawn a fresh copy of the approved checklist first.
        let vid = versionId ?? "";
        if (!vid) {
          const draft = versions.find((v) => v.status === "draft");
          if (draft) {
            vid = draft.id;
          } else {
            const spawn = await fetch(`/api/edges/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ spawnDraft: true }),
            });
            const sd = await spawn.json();
            if (!spawn.ok) throw new Error(sd.error || "Could not open a draft");
            vid = sd.versionId;
            const fresh = await fetch(`/api/edges/${id}`).then((r) => r.json());
            versions = fresh.versions ?? [];
          }
        }

        const version = versions.find((v) => v.id === vid);
        if (!version) throw new Error("Version not found");
        if (version.status === "approved") throw new Error("Approved versions are immutable");
        setResolvedVersionId(vid);
        setItems(
          version.items.map((i) => ({
            category: i.category as string,
            text: i.text as string,
            hard_gate: Boolean(i.hard_gate),
            notes: i.notes as string | null,
          }))
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, versionId]);

  async function save() {
    if (!resolvedVersionId) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`/api/edges/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: resolvedVersionId, items }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/app/edge/${id}`} className="text-sm text-muted hover:text-ink">
          ← Back to edge
        </Link>
        <h1 className="mt-1 text-3xl tracking-tight">Edit draft checklist</h1>
        <p className="mt-1 text-muted">Changes apply only to this draft until you approve it.</p>
      </div>

      {error && (
        <p className="rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}

      {items.map((item, i) => (
        <div key={i} className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input w-auto"
              value={item.category}
              onChange={(e) =>
                setItems((p) =>
                  p.map((it, idx) => (idx === i ? { ...it, category: e.target.value } : it))
                )
              }
              aria-label="Rule category"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={item.hard_gate}
                onChange={(e) =>
                  setItems((p) =>
                    p.map((it, idx) => (idx === i ? { ...it, hard_gate: e.target.checked } : it))
                  )
                }
              />
              Hard gate
            </label>
            <button
              className="btn btn-danger ml-auto min-h-8 px-3 text-xs"
              onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          </div>
          <textarea
            className="input mt-2"
            rows={2}
            value={item.text}
            onChange={(e) =>
              setItems((p) => p.map((it, idx) => (idx === i ? { ...it, text: e.target.value } : it)))
            }
            aria-label="Rule text"
          />
        </div>
      ))}

      <button
        className="btn"
        onClick={() => setItems((p) => [...p, { category: "entry", text: "", hard_gate: false }])}
      >
        + Add rule
      </button>

      <div className="flex items-center gap-3">
        <button className="btn btn-main" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save draft"}
        </button>
        {saved && <span className="text-sm text-pass">Saved</span>}
        <Link href={`/app/edge/${id}`} className="btn ml-auto">
          Done
        </Link>
      </div>
    </div>
  );
}
