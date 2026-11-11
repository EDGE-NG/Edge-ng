"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CATEGORIES = [
  { value: "entry", label: "Entry condition" },
  { value: "context", label: "Context filter" },
  { value: "confirmation", label: "Confirmation" },
  { value: "invalidation", label: "Invalidation" },
  { value: "risk", label: "Risk rule" },
  { value: "note", label: "Note" },
];

interface Item {
  id?: string;
  category: string;
  text: string;
  hard_gate: boolean;
  notes?: string | null;
}

export default function NewEdgePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);

  const [busy, setBusy] = useState<"draft" | "approve" | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<"describe" | "edit">("describe");

  async function generateDraft() {
    setBusy("draft");
    setError("");
    try {
      const res = await fetch("/api/edges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft failed");
      setEdgeId(data.edgeId);
      setVersionId(data.versionId);
      setName(data.name);
      setQuestions(data.clarifying_questions ?? []);
      setItems(
        (data.items ?? []).map((i: Record<string, unknown>) => ({
          id: i.id as string,
          category: i.category as string,
          text: i.text as string,
          hard_gate: Boolean(i.hard_gate),
          notes: (i.notes as string | null) ?? null,
        }))
      );
      setStage("edit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  async function saveItems() {
    if (!edgeId || !versionId) return;
    const res = await fetch(`/api/edges/${edgeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
  }

  async function approve() {
    if (!edgeId || !versionId) return;
    setBusy("approve");
    setError("");
    try {
      await saveItems();
      const res = await fetch(`/api/edges/${edgeId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approve failed");
      router.push(`/app/edge/${edgeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
    }
  }

  function updateItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl tracking-tight">Edge Builder</h1>
        <p className="mt-1 text-muted">
          Describe your edge in your own words. The AI drafts a checklist — you edit and approve it.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}

      {stage === "describe" && (
        <div className="card space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Name this edge</span>
            <input
              className="input mt-2"
              placeholder="e.g. London open continuation"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Describe your strategy</span>
            <textarea
              className="input mt-2 min-h-48"
              placeholder={
                "Example: I trade 15m pullbacks on EUR/USD in the London session. " +
                "I need the 1H trend to be up, price to pull back to the 20 EMA without " +
                "closing below it, and a bullish engulfing candle as confirmation. " +
                "I risk 1% per trade and never enter 10 minutes before news."
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted">
            Vague terms get flagged as questions instead of being silently turned into rules.
          </p>
          <button
            className="btn btn-main"
            onClick={generateDraft}
            disabled={busy === "draft" || description.trim().length < 20}
          >
            {busy === "draft" ? "Drafting checklist…" : "Draft my checklist"}
          </button>
        </div>
      )}

      {stage === "edit" && (
        <>
          {questions.length > 0 && (
            <div className="card border-maybe/40">
              <h2 className="text-sm font-medium text-maybe">
                Questions about your description — answer them by editing rules below
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {questions.map((q) => (
                  <li key={q}>• {q}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="card space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Checklist draft</h2>
              <span className="tag tag-maybe">Not approved yet</span>
            </div>

            {items.map((item, i) => (
              <div key={i} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input w-auto"
                    value={item.category}
                    onChange={(e) => updateItem(i, { category: e.target.value })}
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
                      onChange={(e) => updateItem(i, { hard_gate: e.target.checked })}
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
                  onChange={(e) => updateItem(i, { text: e.target.value })}
                  aria-label="Rule text"
                />
              </div>
            ))}

            <button
              className="btn"
              onClick={() =>
                setItems((p) => [...p, { category: "entry", text: "", hard_gate: false }])
              }
            >
              + Add rule
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="btn btn-main"
              onClick={approve}
              disabled={busy === "approve" || items.length === 0}
            >
              {busy === "approve" ? "Approving…" : `Approve & activate${name ? ` “${name}”` : ""}`}
            </button>
            <button className="btn" onClick={() => setStage("describe")}>
              ← Rewrite description
            </button>
          </div>
          <p className="text-xs text-muted">
            Approval creates an immutable version. Historical reviews keep the rules that were
            active at their time.
          </p>
        </>
      )}
    </div>
  );
}
