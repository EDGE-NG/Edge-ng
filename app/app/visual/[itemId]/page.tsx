"use client";

/**
 * One checklist rule's Visual Library (PRD 4.3):
 * attach examples → AI interprets → trader confirms or corrects →
 * replace / re-run / delete, with replacement history preserved.
 */
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";

interface Ref {
  id: string;
  polarity: string;
  explanation: string | null;
  ai_interpretation: string | null;
  confirmed_interpretation: string | null;
  confirmed_at: string | null;
  approval_status: string;
  replaced_at: string | null;
  created_at: string;
  image: string;
}

interface ItemInfo {
  id: string;
  category: string;
  text: string;
  hard_gate: number;
  notes: string | null;
  version_number: number;
  edge_id: string;
  edge_name: string;
}

interface Data {
  item: ItemInfo;
  refs: Ref[];
  history: Ref[];
}

export default function VisualItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  // add-example form
  const [file, setFile] = useState<File | null>(null);
  const [polarity, setPolarity] = useState<"positive" | "negative">("positive");
  const [explanation, setExplanation] = useState("");

  // correct form
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [correctText, setCorrectText] = useState("");

  // replace form
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);

  const load = useCallback(() => {
    fetch(`/api/visual?itemId=${itemId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Could not load this rule"));
  }, [itemId]);

  useEffect(load, [load]);

  if (error && !data) return <p className="text-fail">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const { item, refs, history } = data;

  async function addExample(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a chart screenshot first");
    setBusy("add");
    setError("");
    setNote("");
    try {
      const fd = new FormData();
      fd.set("itemId", itemId);
      fd.set("polarity", polarity);
      fd.set("explanation", explanation);
      fd.set("file", file);
      const res = await fetch("/api/visual", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed");
      setFile(null);
      setExplanation("");
      setNote(
        d.ai_error
          ? "Example saved, but the AI interpretation failed — you can retry it below."
          : "Example saved. Review the AI's interpretation below and confirm or correct it."
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy("");
    }
  }

  async function patch(refId: string, body: Record<string, unknown>, label: string) {
    setBusy(`${refId}:${label}`);
    setError("");
    setNote("");
    try {
      const res = await fetch(`/api/visual/${refId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Update failed");
      setCorrecting(null);
      setCorrectText("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy("");
    }
  }

  async function replaceExample(refId: string) {
    if (!replaceFile) return setError("Choose the replacement screenshot first");
    setBusy(`${refId}:replace`);
    setError("");
    setNote("");
    try {
      const fd = new FormData();
      fd.set("file", replaceFile);
      const res = await fetch(`/api/visual/${refId}/replace`, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Replace failed");
      setReplacing(null);
      setReplaceFile(null);
      setNote("Reference replaced — the previous version is kept in history below.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replace failed");
    } finally {
      setBusy("");
    }
  }

  async function remove(refId: string) {
    if (!confirm("Delete this example?")) return;
    setBusy(`${refId}:delete`);
    try {
      const res = await fetch(`/api/visual/${refId}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Delete failed");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/visual" className="text-sm text-muted hover:text-ink">
          ← Visual Library
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="tag tag-neutral">{item.category}</span>
          {item.hard_gate === 1 && <span className="tag tag-fail">hard gate</span>}
          <span className="text-xs text-muted">
            {item.edge_name} · checklist v{item.version_number}
          </span>
        </div>
        <h1 className="mt-2 text-2xl tracking-tight">{item.text}</h1>
        {item.notes && <p className="mt-1 text-sm text-muted">{item.notes}</p>}
      </div>

      {error && <p className="text-fail">{error}</p>}
      {note && <p className="text-sm text-pass">{note}</p>}

      {/* attach a new example */}
      <form onSubmit={addExample} className="card space-y-4">
        <div>
          <h2 className="text-lg font-medium">Attach a chart example</h2>
          <p className="text-sm text-muted">
            Show a chart where this rule is satisfied (positive) or violated (negative), and say why.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["positive", "negative"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPolarity(p)}
              className={`btn min-h-9 px-4 text-sm ${
                polarity === p
                  ? p === "positive"
                    ? "btn-main"
                    : "btn-danger"
                  : ""
              }`}
            >
              {p === "positive" ? "✓ Positive example" : "✗ Negative example"}
            </button>
          ))}
        </div>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-transparent file:px-4 file:py-2 file:text-sm file:text-ink"
        />
        <textarea
          className="input min-h-24"
          placeholder="Why is this example valid or invalid under the rule? (required)"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
        />
        <button className="btn btn-main" disabled={busy === "add"} type="submit">
          {busy === "add" ? "Analyzing with AI…" : "Upload & ask the AI"}
        </button>
      </form>

      {/* active references */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">
          Examples ({refs.length})
          {history.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted">
              + {history.length} replaced in history
            </span>
          )}
        </h2>
        {refs.length === 0 && (
          <p className="text-sm text-muted">No examples attached to this rule yet.</p>
        )}
        {refs.map((r) => {
          const pending = r.approval_status === "pending";
          const approved = r.approval_status === "approved";
          const corrected =
            approved &&
            r.confirmed_interpretation &&
            r.ai_interpretation &&
            r.confirmed_interpretation !== r.ai_interpretation;
          return (
            <article key={r.id} className="card">
              <div className="flex flex-wrap items-start gap-4">
                <a href={r.image} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.image}
                    alt={`Example for rule`}
                    className="h-40 w-64 rounded-xl border border-line object-cover"
                  />
                </a>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`tag ${r.polarity === "positive" ? "tag-pass" : "tag-fail"}`}>
                      {r.polarity === "positive" ? "✓ positive" : "✗ negative"}
                    </span>
                    {pending && <span className="tag tag-maybe">awaiting your confirmation</span>}
                    {approved && <span className="tag tag-pass">confirmed</span>}
                    <span className="text-xs text-muted">
                      added {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {r.explanation && (
                    <p className="text-sm text-muted">
                      <span className="text-ink">Your explanation:</span> {r.explanation}
                    </p>
                  )}

                  {!r.ai_interpretation && pending && (
                    <p className="text-sm text-fail">
                      AI interpretation failed.{" "}
                      <button
                        className="underline"
                        disabled={busy === `${r.id}:reinterpret`}
                        onClick={() => patch(r.id, { action: "reinterpret" }, "reinterpret")}
                      >
                        {busy === `${r.id}:reinterpret` ? "Retrying…" : "Retry"}
                      </button>
                    </p>
                  )}

                  {r.ai_interpretation && (
                    <div className="rounded-xl border border-line p-3">
                      <p className="text-xs uppercase tracking-wide text-muted">
                        {approved && corrected ? "AI read (you corrected it)" : "AI interpretation"}
                      </p>
                      <p className="mt-1 text-sm">{r.ai_interpretation}</p>
                    </div>
                  )}

                  {approved && (
                    <div className="rounded-xl border border-[rgba(80,220,160,.35)] p-3">
                      <p className="text-xs uppercase tracking-wide text-pass">
                        {corrected ? "Your correction (this is what the AI uses)" : "You confirmed"}
                        {r.confirmed_at && (
                          <span className="ml-2 normal-case text-muted">
                            {new Date(r.confirmed_at).toLocaleDateString()}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-sm">{r.confirmed_interpretation}</p>
                    </div>
                  )}

                  {/* actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {pending && r.ai_interpretation && (
                      <>
                        <button
                          className="btn btn-main min-h-9 px-4 text-sm"
                          disabled={busy !== ""}
                          onClick={() => patch(r.id, { action: "confirm" }, "confirm")}
                        >
                          {busy === `${r.id}:confirm` ? "Confirming…" : "Confirm interpretation"}
                        </button>
                        <button
                          className="btn min-h-9 px-4 text-sm"
                          disabled={busy !== ""}
                          onClick={() => {
                            setCorrecting(r.id);
                            setCorrectText("");
                          }}
                        >
                          Correct it
                        </button>
                        <button
                          className="btn min-h-9 px-4 text-sm"
                          disabled={busy !== ""}
                          onClick={() => patch(r.id, { action: "reinterpret" }, "reinterpret")}
                        >
                          {busy === `${r.id}:reinterpret` ? "Re-reading…" : "Re-run AI"}
                        </button>
                      </>
                    )}
                    {correcting === r.id && (
                      <div className="w-full space-y-2">
                        <textarea
                          className="input min-h-20"
                          placeholder="Rewrite the interpretation in your own words — your wording is what the AI uses during reviews."
                          value={correctText}
                          onChange={(e) => setCorrectText(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            className="btn btn-main min-h-9 px-4 text-sm"
                            disabled={busy !== "" || !correctText.trim()}
                            onClick={() =>
                              patch(
                                r.id,
                                { action: "correct", interpretation: correctText },
                                "correct"
                              )
                            }
                          >
                            {busy === `${r.id}:correct` ? "Saving…" : "Save correction"}
                          </button>
                          <button className="btn min-h-9 px-4 text-sm" onClick={() => setCorrecting(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    <button
                      className="btn min-h-9 px-4 text-sm"
                      disabled={busy !== ""}
                      onClick={() => setReplacing(replacing === r.id ? null : r.id)}
                    >
                      Replace image
                    </button>
                    <button
                      className="btn btn-danger min-h-9 px-4 text-sm"
                      disabled={busy !== ""}
                      onClick={() => remove(r.id)}
                    >
                      {busy === `${r.id}:delete` ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                  {replacing === r.id && (
                    <div className="space-y-2 rounded-xl border border-line p-3">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
                        className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-transparent file:px-4 file:py-2 file:text-sm file:text-ink"
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn btn-main min-h-9 px-4 text-sm"
                          disabled={busy !== "" || !replaceFile}
                          onClick={() => replaceExample(r.id)}
                        >
                          {busy === `${r.id}:replace` ? "Replacing & re-reading…" : "Replace"}
                        </button>
                        <button className="btn min-h-9 px-4 text-sm" onClick={() => setReplacing(null)}>
                          Cancel
                        </button>
                      </div>
                      <p className="text-xs text-muted">
                        The current version stays in history with its confirmation status.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {/* replacement history */}
      {history.length > 0 && (
        <section>
          <h2 className="text-lg font-medium">History</h2>
          <ul className="mt-3 space-y-2">
            {history.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 opacity-70"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.image} alt="" className="h-10 w-16 rounded border border-line object-cover" />
                <span className={`tag ${r.polarity === "positive" ? "tag-pass" : "tag-fail"}`}>
                  {r.polarity}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">
                  {r.explanation ?? r.confirmed_interpretation ?? r.ai_interpretation}
                </span>
                <span className="tag tag-neutral shrink-0">replaced</span>
                {r.replaced_at && (
                  <span className="shrink-0 text-xs text-muted">
                    {new Date(r.replaced_at).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
