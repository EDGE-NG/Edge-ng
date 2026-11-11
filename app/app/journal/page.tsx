"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Entry {
  id: string;
  summary: string | null;
  compliance_json: string | null;
  execution_quality: string | null;
  strengths: string | null;
  deviations: string | null;
  lessons: string | null;
  created_at: string;
  trade_id: string | null;
  instrument: string | null;
  direction: string | null;
  pnl: number | null;
  review_id: string | null;
  overall: string | null;
}

interface Trade {
  id: string;
  instrument: string;
  direction: string;
  entry_price: number | null;
  exit_price: number | null;
  pnl: number | null;
  created_at: string;
  review_overall: string | null;
  journal_count: number;
}

interface ReviewOption {
  id: string;
  instrument: string;
  direction: string;
  overall: string | null;
}

export default function JournalPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [reviews, setReviews] = useState<ReviewOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // record-trade form
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [tradeReviewId, setTradeReviewId] = useState("");
  const [instrument, setInstrument] = useState("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [pnl, setPnl] = useState("");
  const [notes, setNotes] = useState("");
  const [savingTrade, setSavingTrade] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/journal").then((r) => r.json()),
      fetch("/api/trades").then((r) => r.json()),
      fetch("/api/reviews/list").then((r) => r.json()).catch(() => ({ reviews: [] })),
    ])
      .then(([j, t, rv]) => {
        setEntries(j.entries ?? []);
        setTrades(t.trades ?? []);
        setReviews(rv.reviews ?? []);
      })
      .catch(() => setError("Could not load journal"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function recordTrade() {
    setSavingTrade(true);
    setError("");
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: tradeReviewId || null,
          instrument,
          direction,
          entryPrice,
          exitPrice,
          pnl,
          notes,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not record trade");
      setShowTradeForm(false);
      setTradeReviewId("");
      setInstrument("");
      setEntryPrice("");
      setExitPrice("");
      setPnl("");
      setNotes("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record trade");
    } finally {
      setSavingTrade(false);
    }
  }

  async function generateJournal(tradeId?: string, reviewId?: string) {
    const key = tradeId ?? reviewId ?? "";
    setGenerating(key);
    setError("");
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId, reviewId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Journal generation failed");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Journal generation failed");
    } finally {
      setGenerating(null);
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-tight">Journal</h1>
          <p className="mt-1 text-muted">
            Execution quality, separate from profit and loss.
          </p>
        </div>
        <button className="btn btn-main" onClick={() => setShowTradeForm((v) => !v)}>
          {showTradeForm ? "Cancel" : "+ Record a trade"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}

      {showTradeForm && (
        <div className="card space-y-4">
          <h2 className="text-lg font-medium">Record trade</h2>
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
            <label className="block">
              <span className="text-sm font-medium">Linked review (optional)</span>
              <select
                className="input mt-2"
                value={tradeReviewId}
                onChange={(e) => setTradeReviewId(e.target.value)}
              >
                <option value="">None</option>
                {reviews.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.instrument} · {r.direction} ({r.overall ?? "draft"})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">P&amp;L (optional)</span>
              <input
                className="input mt-2"
                placeholder="e.g. -40.5"
                value={pnl}
                onChange={(e) => setPnl(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Entry</span>
              <input
                className="input mt-2"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Exit</span>
              <input
                className="input mt-2"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">Notes</span>
            <textarea
              className="input mt-2"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <button
            className="btn btn-main"
            onClick={recordTrade}
            disabled={savingTrade || !instrument.trim()}
          >
            {savingTrade ? "Saving…" : "Record trade"}
          </button>
        </div>
      )}

      {/* journal entries */}
      {entries.length === 0 ? (
        <div className="card">
          <h2 className="text-lg font-medium">No journal entries yet</h2>
          <p className="mt-1 text-sm text-muted">
            Record a trade (ideally linked to a review) and generate a journal. The AI assesses how
            closely you followed your process — separate from whether the trade won.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((e) => {
            const compliance = e.compliance_json ? JSON.parse(e.compliance_json) : null;
            return (
              <article key={e.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-medium">
                    {e.instrument ?? "Trade"} {e.direction ? `· ${e.direction}` : ""}
                    {e.pnl != null && (
                      <span className={`ml-2 ${e.pnl >= 0 ? "text-pass" : "text-fail"}`}>
                        P&L {e.pnl}
                      </span>
                    )}
                  </h2>
                  <span className="text-xs text-muted">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>

                {compliance && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="tag tag-pass">{compliance.pass} pass</span>
                    <span className="tag tag-fail">{compliance.fail} fail</span>
                    <span className="tag tag-maybe">{compliance.inconclusive} inconclusive</span>
                    {compliance.overridden && <span className="tag tag-neutral">override</span>}
                  </div>
                )}

                {e.summary && <p className="mt-3 text-sm">{e.summary}</p>}
                {e.execution_quality && (
                  <div className="mt-3">
                    <h3 className="text-xs font-medium text-muted">Execution quality</h3>
                    <p className="mt-1 text-sm text-muted">{e.execution_quality}</p>
                  </div>
                )}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {e.strengths && (
                    <div>
                      <h3 className="text-xs font-medium text-pass">Strengths</h3>
                      <p className="mt-1 whitespace-pre-line text-sm text-muted">{e.strengths}</p>
                    </div>
                  )}
                  {e.deviations && (
                    <div>
                      <h3 className="text-xs font-medium text-fail">Deviations</h3>
                      <p className="mt-1 whitespace-pre-line text-sm text-muted">{e.deviations}</p>
                    </div>
                  )}
                </div>
                {e.lessons && (
                  <div className="mt-3">
                    <h3 className="text-xs font-medium text-maybe">Lessons</h3>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted">{e.lessons}</p>
                  </div>
                )}
                {e.review_id && (
                  <Link
                    href={`/app/review/${e.review_id}`}
                    className="mt-3 inline-block text-xs text-accent hover:underline"
                  >
                    View source review →
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* trades awaiting journal */}
      {trades.filter((t) => t.journal_count === 0).length > 0 && (
        <section>
          <h2 className="text-lg font-medium">Trades without a journal</h2>
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {trades
              .filter((t) => t.journal_count === 0)
              .map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm">
                    {t.instrument} · {t.direction}
                    {t.pnl != null && (
                      <span className={`ml-2 ${t.pnl >= 0 ? "text-pass" : "text-fail"}`}>
                        P&L {t.pnl}
                      </span>
                    )}
                    <span className="ml-2 text-xs text-muted">
                      {t.review_overall ? `review: ${t.review_overall}` : "no review"}
                    </span>
                  </span>
                  <button
                    className="btn min-h-9 px-4 text-sm"
                    onClick={() => generateJournal(t.id)}
                    disabled={generating === t.id}
                  >
                    {generating === t.id ? "Generating…" : "Generate journal"}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
