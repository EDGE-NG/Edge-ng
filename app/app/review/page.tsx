"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

interface EdgeRow {
  id: string;
  name: string;
  active_version: number | null;
  approved_items: number;
}

function NewReview() {
  const router = useRouter();
  const search = useSearchParams();
  const presetEdge = search.get("edgeId") ?? "";

  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [edgeId, setEdgeId] = useState(presetEdge);
  const [instrument, setInstrument] = useState("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [higherTf, setHigherTf] = useState("");
  const [setupTf, setSetupTf] = useState("");
  const [execTf, setExecTf] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/edges/list")
      .then((r) => r.json())
      .then((d) => {
        const all: EdgeRow[] = d.edges ?? [];
        setEdges(all);
        if (!presetEdge) {
          const approved = all.find((e) => e.active_version);
          if (approved) setEdgeId(approved.id);
        }
      })
      .catch(() => setError("Could not load edges"));
  }, [presetEdge]);

  const approved = edges.filter((e) => e.active_version);
  const selected = edges.find((e) => e.id === edgeId);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          edgeId,
          instrument: instrument.trim(),
          direction,
          context: { higherTimeframe: higherTf, setupTimeframe: setupTf, executionTimeframe: execTf },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not start review");
      router.push(`/app/review/${d.reviewId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl tracking-tight">New trade review</h1>
        <p className="mt-1 text-muted">
          Pick an approved checklist and the setup you are considering. You will then show Edge the
          evidence it asks for.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}

      {approved.length === 0 ? (
        <div className="card">
          <h2 className="text-lg font-medium">No approved checklist</h2>
          <p className="mt-1 text-sm text-muted">
            A review runs against an approved checklist version. Define and approve your edge first.
          </p>
          <Link href="/app/edge/new" className="btn btn-main mt-4">
            Define my edge
          </Link>
        </div>
      ) : (
        <>
          <div className="card space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Checklist</span>
              <select
                className="input mt-2"
                value={edgeId}
                onChange={(e) => setEdgeId(e.target.value)}
              >
                {approved.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — v{e.active_version}, {e.approved_items} rules
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">Instrument</span>
                <input
                  className="input mt-2"
                  placeholder="e.g. EUR/USD"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                />
              </label>
              <div>
                <span className="text-sm font-medium">Direction</span>
                <div className="mt-2 flex gap-2">
                  {(["long", "short"] as const).map((d) => (
                    <button
                      key={d}
                      className={`btn flex-1 ${direction === d ? "border-accent text-accent" : ""}`}
                      onClick={() => setDirection(d)}
                      aria-pressed={direction === d}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <span className="text-sm font-medium">Timeframes the AI will ask for</span>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <input
                  className="input"
                  placeholder="Higher (e.g. 4H)"
                  value={higherTf}
                  onChange={(e) => setHigherTf(e.target.value)}
                  aria-label="Higher timeframe"
                />
                <input
                  className="input"
                  placeholder="Setup (e.g. 15m)"
                  value={setupTf}
                  onChange={(e) => setSetupTf(e.target.value)}
                  aria-label="Setup timeframe"
                />
                <input
                  className="input"
                  placeholder="Execution (e.g. 1m)"
                  value={execTf}
                  onChange={(e) => setExecTf(e.target.value)}
                  aria-label="Execution timeframe"
                />
              </div>
            </div>
          </div>

          <button
            className="btn btn-main"
            onClick={start}
            disabled={busy || !edgeId || !instrument.trim()}
          >
            {busy ? "Starting…" : "Start review"}
          </button>
          {selected && !selected.active_version && (
            <p className="text-sm text-maybe">Selected edge has no approved version.</p>
          )}
        </>
      )}
    </div>
  );
}

export default function NewReviewPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <NewReview />
    </Suspense>
  );
}
