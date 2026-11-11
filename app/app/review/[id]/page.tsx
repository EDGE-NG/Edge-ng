"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";

interface Item {
  id: string;
  category: string;
  text: string;
  hard_gate: number;
}

interface Result {
  item_id: string;
  verdict: string;
  evidence: string | null;
  explanation: string | null;
}

interface Evidence {
  id: string;
  kind: string;
  timeframe: string | null;
  provenance: string | null;
  created_at: string;
  size: number;
}

interface ReviewData {
  review: {
    id: string;
    instrument: string;
    direction: string;
    status: string;
    overall: string | null;
    summary: string | null;
    missing_evidence: string | null;
    override_reason: string | null;
    overridden_at: string | null;
    context_json: string;
    version_number: number;
    edge_name: string;
    completed_at: string | null;
  };
  items: Item[];
  results: Result[];
  evidence: Evidence[];
  trade: { id: string; pnl: number | null } | null;
}

const verdictTag = (v: string) => {
  if (v === "pass") return <span className="tag tag-pass">✓ Pass</span>;
  if (v === "fail") return <span className="tag tag-fail">✕ Fail</span>;
  return <span className="tag tag-maybe">? Inconclusive</span>;
};

export default function ReviewWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");

  // evidence form state
  const [note, setNote] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSaving, setOverrideSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch(`/api/reviews/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Could not load review"));
  }, [id]);

  useEffect(load, [load]);

  async function addNote() {
    if (!note.trim()) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("kind", "note");
      fd.set("text", note);
      if (timeframe) fd.set("timeframe", timeframe);
      const res = await fetch(`/api/reviews/${id}/evidence`, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed");
      setNote("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function addImage() {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("kind", "image");
      fd.set("file", file);
      if (timeframe) fd.set("timeframe", timeframe);
      fd.set("provenance", "user_capture");
      const res = await fetch(`/api/reviews/${id}/evidence`, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function runReview() {
    setRunning(true);
    setError("");
    try {
      const res = await fetch(`/api/reviews/${id}/run`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Review failed");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setRunning(false);
    }
  }

  async function recordOverride() {
    setOverrideSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/reviews/${id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: overrideReason }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not record override");
      setOverrideOpen(false);
      setOverrideReason("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record override");
    } finally {
      setOverrideSaving(false);
    }
  }

  if (error && !data) return <p className="text-fail">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const { review, items, results, evidence } = data;
  const completed = review.status === "completed";
  const resultFor = (itemId: string) => results.find((r) => r.item_id === itemId);
  const context = JSON.parse(review.context_json || "{}");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/app/review" className="text-sm text-muted hover:text-ink">
            ← Reviews
          </Link>
          <h1 className="mt-1 text-3xl tracking-tight">
            {review.instrument} · {review.direction}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {review.edge_name} · checklist v{review.version_number}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {completed && verdictTag(review.overall ?? "inconclusive")}
          {review.overridden_at && <span className="tag tag-maybe">override recorded</span>}
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}

      {/* context */}
      <div className="card">
        <h2 className="text-sm font-medium text-muted">Requested context</h2>
        <p className="mt-2 text-sm">
          {[
            context.higherTimeframe && `Higher: ${context.higherTimeframe}`,
            context.setupTimeframe && `Setup: ${context.setupTimeframe}`,
            context.executionTimeframe && `Execution: ${context.executionTimeframe}`,
          ]
            .filter(Boolean)
            .join("  ·  ") || "No timeframes specified"}
        </p>
      </div>

      {/* evidence capture — the PRD's capture fallback path */}
      {!completed && (
        <div className="card space-y-4">
          <div>
            <h2 className="text-lg font-medium">Show Edge the evidence</h2>
            <p className="mt-1 text-sm text-muted">
              Navigate your chart to the setup, then add a capture or a text note. Ask for another
              view anytime — Inconclusive is a valid answer.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line p-4">
              <h3 className="text-sm font-medium">Chart capture</h3>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-track file:px-4 file:py-2 file:text-ink"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button className="btn mt-3 w-full" onClick={addImage} disabled={!file || uploading}>
                {uploading ? "Uploading…" : "Attach capture"}
              </button>
            </div>

            <div className="rounded-xl border border-line p-4">
              <h3 className="text-sm font-medium">Text note</h3>
              <input
                className="input mt-2"
                placeholder="Timeframe (e.g. 15m)"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                aria-label="Timeframe for note"
              />
              <textarea
                className="input mt-2"
                rows={3}
                placeholder="What you see: trend, level, candle…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Evidence note"
              />
              <button
                className="btn mt-3 w-full"
                onClick={addNote}
                disabled={!note.trim() || uploading}
              >
                {uploading ? "Adding…" : "Add note"}
              </button>
            </div>
          </div>

          {evidence.length > 0 && (
            <ul className="space-y-2">
              {evidence.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm"
                >
                  <span>
                    {ev.kind === "image" ? "🖼" : "📝"}{" "}
                    {ev.kind === "image" ? "Chart capture" : "Text note"}
                    {ev.timeframe ? ` · ${ev.timeframe}` : ""}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(ev.created_at).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* results */}
      {completed && (
        <>
          <div className="card border-accent/30">
            <h2 className="text-sm font-medium text-muted">Assessment</h2>
            <p className="mt-2 leading-relaxed">{review.summary}</p>
            {review.missing_evidence && (
              <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-sm text-maybe">
                Missing: {review.missing_evidence}
              </p>
            )}
          </div>

          <div className="space-y-3">
            {items.map((item) => {
              const r = resultFor(item.id);
              return (
                <div key={item.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tag tag-neutral">{item.category}</span>
                        {item.hard_gate === 1 && <span className="tag tag-fail">hard gate</span>}
                        <span className="text-sm">{item.text}</span>
                      </div>
                      {r?.evidence && (
                        <p className="mt-2 text-sm text-muted">
                          <span className="text-ink">Saw: </span>
                          {r.evidence}
                        </p>
                      )}
                      {r?.explanation && (
                        <p className="mt-1 text-sm text-muted">{r.explanation}</p>
                      )}
                    </div>
                    {r && verdictTag(r.verdict)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* actions */}
          <div className="flex flex-wrap gap-3">
            <button className="btn" onClick={() => window.location.reload()}>
              Run another review
            </button>
            {!review.overridden_at && (
              <button
                className="btn border-maybe/50 text-maybe"
                onClick={() => setOverrideOpen((v) => !v)}
              >
                Override & record
              </button>
            )}
            <Link href="/app/journal" className="btn btn-main ml-auto">
              Go to journal
            </Link>
          </div>

          {review.overridden_at && (
            <div className="card border-maybe/40">
              <h3 className="text-sm font-medium text-maybe">Override recorded</h3>
              <p className="mt-1 text-sm text-muted">
                {review.override_reason || "No reason given."} ·{" "}
                {new Date(review.overridden_at).toLocaleString()}
              </p>
              <p className="mt-2 text-xs text-muted">
                Recorded for your journal — not a judgment. Overrides are data.
              </p>
            </div>
          )}

          {overrideOpen && (
            <div className="card space-y-3">
              <label className="block">
                <span className="text-sm font-medium">Why are you proceeding? (optional)</span>
                <textarea
                  className="input mt-2"
                  rows={2}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. level confluence on higher timeframe not visible in capture"
                />
              </label>
              <div className="flex gap-2">
                <button className="btn btn-main" onClick={recordOverride} disabled={overrideSaving}>
                  {overrideSaving ? "Recording…" : "Record override"}
                </button>
                <button className="btn" onClick={() => setOverrideOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* pre-run state */}
      {!completed && (
        <button
          className="btn btn-main"
          onClick={runReview}
          disabled={running || evidence.length === 0}
          title={evidence.length === 0 ? "Add evidence first" : undefined}
        >
          {running ? "Reviewing…" : "Run review"}
        </button>
      )}
    </div>
  );
}
