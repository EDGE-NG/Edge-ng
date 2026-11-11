"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Edge settings: update the edge itself (name + description) and delete it
 * when it is no longer usable. Checklist rules live in the checklist editor.
 */
export default function EdgeSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetch(`/api/edges/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setName(d.edge.name ?? "");
        setDescription(d.edge.description ?? "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`/api/edges/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
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

  async function deleteEdge() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/edges/${id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Delete failed");
      router.push("/app/edge");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/app/edge/${id}`} className="text-sm text-muted hover:text-ink">
          ← Back to edge
        </Link>
        <h1 className="mt-1 text-3xl tracking-tight">Edge settings</h1>
        <p className="mt-1 text-muted">Update this edge, or delete it when it no longer fits.</p>
      </div>

      {error && (
        <p className="rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}

      <div className="card space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input
            className="input mt-2"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            placeholder="e.g. London open continuation"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Description</span>
          <textarea
            className="input mt-2 min-h-32"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaved(false);
            }}
            placeholder="How you described this edge — the source the checklist was drafted from."
          />
        </label>
        <div className="flex items-center gap-3">
          <button className="btn btn-main" onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          {saved && <span className="text-sm text-pass">Saved</span>}
        </div>
      </div>

      <div className="card border-fail/40">
        <h2 className="text-lg font-medium text-fail">Delete this edge</h2>
        <p className="mt-1 text-sm text-muted">
          Removes the edge with every checklist version, image evidence and review history tied to
          it. Trades and journal entries stay. This cannot be undone.
        </p>
        <button
          className="btn btn-danger mt-4"
          onClick={deleteEdge}
          disabled={busy}
          aria-pressed={confirmDelete}
        >
          {busy ? "Deleting…" : confirmDelete ? "Click again to delete permanently" : "Delete edge"}
        </button>
      </div>
    </div>
  );
}
