"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const CATEGORIES = [
  { value: "entry", label: "Entry condition" },
  { value: "context", label: "Context filter" },
  { value: "confirmation", label: "Confirmation" },
  { value: "invalidation", label: "Invalidation" },
  { value: "risk", label: "Risk rule" },
  { value: "note", label: "Note" },
];

/** The exact onboarding hint shown above the chat box for new users. */
const HINT = "Type in your edge, or speak your edge, and I'll make it into a checklist.";
const MAX_IMAGES = 5;

interface EdgeRow {
  id: string;
  name: string;
  active_version: number | null;
  approved_items: number;
  versions: number;
  updated_at: string;
}

interface SavedItem {
  id: string;
  category: string;
  text: string;
  hard_gate: number;
  position: number;
  notes: string | null;
}

type Line = {
  id?: string;
  category: string;
  text: string;
  hard_gate: boolean;
  notes?: string | null;
  approved: boolean;
};

type PendingImage = { file: File; caption: string; url: string };

type Stage = "chat" | "review" | "images" | "list";

type Busy = "draft" | "revise" | "approve" | null;

/** Minimal Web Speech API typings (Chrome/Safari prefix differs). */
type SpeechEvent = {
  resultIndex: number;
  results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } };
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechCtor = new () => SpeechRecognitionLike;

export default function EdgeListPage() {
  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>("chat");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  // Ref guard: `busy` state lags a beat behind the click, so rapid re-clicks
  // (or Enter held down) could fire a second AI request before re-render.
  const busyRef = useRef<Busy>(null);

  // --- chat stage (describe / speak the edge) ---
  const [description, setDescription] = useState("");
  const [listening, setListening] = useState(false);
  const [srSupported, setSrSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // --- review stage (approve each line, revise with AI) ---
  const [edgeId, setEdgeId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [edgeName, setEdgeName] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [feedback, setFeedback] = useState("");

  // --- images stage (up to 5 images per checklist line) ---
  const [pending, setPending] = useState<Record<string, PendingImage[]>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [imgWarn, setImgWarn] = useState("");

  // --- create menu (dropdown, top-right) ---
  const [menuOpen, setMenuOpen] = useState(false);
  const [subMenu, setSubMenu] = useState<null | "edge" | "checklist">(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/edges/list");
      const d = await r.json();
      const list: EdgeRow[] = d.edges ?? [];
      setEdges(list);
      return list;
    } catch {
      return [] as EdgeRow[];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().then((list) => setStage(list.length > 0 ? "list" : "chat"));
  }, [load]);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    setSrSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      recRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setSubMenu(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  // ---------- chat stage ----------

  function toggleVoice() {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    const base = description.trim() ? description.trim() + " " : "";
    let finalText = "";
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setDescription((base + finalText + interim).replace(/\s+/g, " "));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function generateDraft() {
    if (busyRef.current) return;
    busyRef.current = "draft";
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
      setEdgeName(data.name || "My edge");
      setQuestions(data.clarifying_questions ?? []);
      setLines(
        (data.items ?? []).map((i: Record<string, unknown>) => ({
          id: i.id as string,
          category: i.category as string,
          text: i.text as string,
          hard_gate: Boolean(i.hard_gate),
          notes: (i.notes as string | null) ?? null,
          approved: false,
        }))
      );
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  // ---------- review stage ----------

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const allApproved = lines.length > 0 && lines.every((l) => l.approved && l.text.trim());
  const approvedCount = lines.filter((l) => l.approved).length;

  async function revise() {
    if (!edgeId || !versionId || busyRef.current) return;
    busyRef.current = "revise";
    setBusy("revise");
    setError("");
    try {
      const res = await fetch(`/api/edges/${edgeId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, feedback }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Revision failed");
      setLines(
        (data.items ?? []).map((i: Record<string, unknown>) => ({
          id: i.id as string,
          category: i.category as string,
          text: i.text as string,
          hard_gate: Boolean(i.hard_gate),
          notes: (i.notes as string | null) ?? null,
          approved: false,
        }))
      );
      setQuestions(data.clarifying_questions ?? []);
      setFeedback("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  async function approveChecklist() {
    if (!edgeId || !versionId || !allApproved || busyRef.current) return;
    busyRef.current = "approve";
    setBusy("approve");
    setError("");
    try {
      const items = lines.map(({ approved: _approved, ...rest }) => rest);
      const saveRes = await fetch(`/api/edges/${edgeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, items }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || "Save failed");

      const res = await fetch(`/api/edges/${edgeId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approve failed");

      // PATCH rewrites items (fresh ids) — resolve the rows that just became
      // active so the image stage attaches to them.
      let saved: SavedItem[] = saveData.items ?? [];
      if (saved.length === 0) {
        const detail = await fetch(`/api/edges/${edgeId}`).then((r) => r.json());
        const activeVersion = (detail.versions ?? []).find(
          (v: { id: string }) => v.id === data.activeVersionId
        );
        saved = (activeVersion?.items ?? []) as SavedItem[];
      }
      setLines((prev) =>
        prev.map((l, idx) => (saved[idx] ? { ...l, id: saved[idx].id, approved: true } : l))
      );
      const idMap: Record<string, number> = {};
      saved.forEach((s) => (idMap[s.id] = 0));
      setCounts(idMap);
      setPending({});
      setImgWarn("");
      setStage("images");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  async function abandonToChat() {
    setError("");
    // a draft created in this session would linger as an empty edge — remove it
    if (edgeId) {
      try {
        await fetch(`/api/edges/${edgeId}`, { method: "DELETE" });
      } catch {
        /* best effort */
      }
    }
    setEdgeId("");
    setVersionId("");
    setEdgeName("");
    setQuestions([]);
    setLines([]);
    setFeedback("");
    setStage("chat");
  }

  // ---------- images stage ----------

  function addFiles(itemId: string, lineText: string, e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const cur = pending[itemId] ?? [];
    const room = MAX_IMAGES - (counts[itemId] ?? 0) - cur.length;
    const take = files.slice(0, Math.max(0, room));
    if (take.length < files.length) {
      setImgWarn(`Each checklist line can keep up to ${MAX_IMAGES} images.`);
    }
    if (!take.length) return;
    setPending({
      ...pending,
      [itemId]: [
        ...cur,
        ...take.map((f) => ({
          file: f,
          caption: `Chart example for: ${lineText}`,
          url: URL.createObjectURL(f),
        })),
      ],
    });
  }

  function removePending(itemId: string, idx: number) {
    const cur = pending[itemId] ?? [];
    URL.revokeObjectURL(cur[idx]?.url);
    setPending({ ...pending, [itemId]: cur.filter((_, i) => i !== idx) });
    setImgWarn("");
  }

  async function uploadFor(itemId: string) {
    const queue = pending[itemId] ?? [];
    if (!queue.length || uploading) return;
    const base = counts[itemId] ?? 0;
    setUploading(itemId);
    setError("");
    setImgWarn("");
    let i = 0;
    try {
      for (; i < queue.length; i++) {
        if (base + i >= MAX_IMAGES) break;
        const p = queue[i];
        const fd = new FormData();
        fd.set("itemId", itemId);
        fd.set("polarity", "positive");
        fd.set("explanation", p.caption.trim() || "Chart example for this rule");
        fd.set("file", p.file, p.file.name);
        const res = await fetch("/api/visual", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        if (data.ai_error) {
          setImgWarn("Saved — the AI interpretation failed for one image; confirm it later in the Visual Library.");
        }
      }
      setCounts((c) => ({ ...c, [itemId]: base + i }));
      setPending((p) => ({ ...p, [itemId]: queue.slice(i) }));
    } catch (err) {
      setCounts((c) => ({ ...c, [itemId]: base + i }));
      setPending((p) => ({ ...p, [itemId]: queue.slice(i) }));
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function finishImages() {
    for (const list of Object.values(pending)) {
      for (const p of list) URL.revokeObjectURL(p.url);
    }
    setPending({});
    setStage("list");
    await load();
  }

  // ---------- render ----------

  if (loading) return <p className="text-muted">Loading…</p>;

  if (stage === "chat") {
    return (
      <div className="mx-auto max-w-3xl pt-10 md:pt-24">
        <h1 className="sr-only">My Edge</h1>
        <p className="mb-4 text-center text-sm text-muted">{HINT}</p>

        {error && (
          <p className="mx-auto mb-4 max-w-2xl rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail">
            {error}
          </p>
        )}

        <div className="card p-4 shadow-lg">
          <label htmlFor="edge-input" className="sr-only">
            Describe your trading edge
          </label>
          <textarea
            id="edge-input"
            className="min-h-28 w-full resize-none border-0 bg-transparent text-base leading-relaxed outline-none placeholder:text-muted"
            placeholder={
              "What is your edge?\n\nExample: I trade 15m pullbacks on EUR/USD in the London session — 1H trend up, pullback to the 20 EMA, bullish engulfing candle, 1% risk."
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (description.trim().length >= 20 && !busy) generateDraft();
              }
            }}
          />
          <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
            {srSupported ? (
              <button
                type="button"
                className={`btn btn-sm ${listening ? "border-accent text-accent" : ""}`}
                onClick={toggleVoice}
                aria-pressed={listening}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Z" />
                  <path d="M19 11.5a7 7 0 0 1-14 0" />
                  <path d="M12 18.5V21" />
                </svg>
                {listening ? "Listening…" : "Speak"}
              </button>
            ) : null}
            <span className="text-xs text-muted">
              {listening ? "Just talk — we're listening." : "Type or speak, then draft your checklist."}
            </span>
            <button
              type="button"
              className="btn btn-main ml-auto"
              onClick={generateDraft}
              disabled={busy === "draft" || description.trim().length < 20}
            >
              {busy === "draft" ? "Drafting checklist…" : "Draft my checklist"}
            </button>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-muted">
          The AI only extracts rules you actually state — vague terms come back as questions instead
          of silent guesses.
        </p>
      </div>
    );
  }

  if (stage === "review") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">Step 1 of 2 · Checklist</p>
          <h1 className="mt-1 text-3xl tracking-tight">Review your checklist</h1>
          <p className="mt-1 text-muted">
            Approve each line you agree with. Edit or remove what you don&apos;t — or ask the AI to
            revise it — until every line is yours.
          </p>
        </div>

        {error && (
          <p className="rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail">
            {error}
          </p>
        )}

        {questions.length > 0 && (
          <div className="card border-maybe/40">
            <h2 className="text-sm font-medium text-maybe">
              Questions about your description — answer them by editing the lines below
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {questions.map((q) => (
                <li key={q}>• {q}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">{edgeName}</h2>
              <p className="text-sm text-muted">
                {approvedCount} of {lines.length} lines approved
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => setLines((p) => p.map((l) => ({ ...l, approved: true })))}
              >
                Approve all
              </button>
              <span className={`tag ${allApproved ? "tag-pass" : "tag-maybe"}`}>
                {allApproved ? "ready" : "not approved yet"}
              </span>
            </div>
          </div>

          {lines.map((line, i) => (
            <div
              key={i}
              className={`rounded-xl border p-4 ${line.approved ? "border-pass/40" : "border-line"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input w-auto"
                  value={line.category}
                  onChange={(e) => updateLine(i, { category: e.target.value, approved: false })}
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
                    checked={line.hard_gate}
                    onChange={(e) => updateLine(i, { hard_gate: e.target.checked, approved: false })}
                  />
                  Hard gate
                </label>
                <button
                  type="button"
                  className="btn btn-sm btn-danger ml-auto"
                  onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${line.approved ? "border-pass/50 text-pass" : ""}`}
                  onClick={() => updateLine(i, { approved: !line.approved })}
                  aria-pressed={line.approved}
                >
                  {line.approved ? "✓ Approved" : "Approve"}
                </button>
              </div>
              <textarea
                className="input mt-2"
                rows={2}
                value={line.text}
                onChange={(e) => updateLine(i, { text: e.target.value, approved: false })}
                aria-label="Rule text"
              />
            </div>
          ))}

          <button
            type="button"
            className="btn"
            onClick={() =>
              setLines((p) => [
                ...p,
                { category: "entry", text: "", hard_gate: false, approved: false },
              ])
            }
          >
            + Add line
          </button>
        </div>

        <div className="card space-y-3">
          <h2 className="text-lg font-medium">Not there yet?</h2>
          <p className="text-sm text-muted">
            Tell the AI what to change — it rewrites the checklist and you review it again. Repeat
            until every line is one you&apos;d trade on.
          </p>
          <textarea
            className="input"
            rows={2}
            placeholder="e.g. Drop the news rule, add a max of 2 trades a day, make the EMA pullback a hard gate…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            aria-label="Feedback for the AI"
          />
          <button
            type="button"
            className="btn"
            onClick={revise}
            disabled={busy === "revise" || feedback.trim().length < 5}
          >
            {busy === "revise" ? "Revising…" : "Revise with AI"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-main"
            onClick={approveChecklist}
            disabled={busy === "approve" || !allApproved}
          >
            {busy === "approve" ? "Approving…" : "Approve & continue"}
          </button>
          <button type="button" className="btn" onClick={abandonToChat} disabled={busy !== null}>
            ← Rewrite description
          </button>
        </div>
        {!allApproved && (
          <p className="text-xs text-muted">
            Approve every line to continue — edit, remove, or revise the ones you don&apos;t agree
            with yet.
          </p>
        )}
      </div>
    );
  }

  if (stage === "images") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">Step 2 of 2 · Image evidence</p>
          <h1 className="mt-1 text-3xl tracking-tight">Now add images for your checklist</h1>
          <p className="mt-1 text-muted">
            Add up to {MAX_IMAGES} images for each line — charts that show the step in action. You
            can skip this and add them later from the Visual Library.
          </p>
        </div>

        {error && (
          <p className="rounded-xl border border-fail/40 bg-err-bg px-4 py-3 text-sm text-fail">
            {error}
          </p>
        )}
        {imgWarn && (
          <p className="rounded-xl border border-maybe/40 bg-warn-bg px-4 py-3 text-sm text-maybe">
            {imgWarn}
          </p>
        )}

        {lines.map((line) => {
          const itemId = line.id ?? "";
          const cur = pending[itemId] ?? [];
          const count = counts[itemId] ?? 0;
          return (
            <div key={itemId} className="card space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="tag tag-neutral mt-0.5 shrink-0">{line.category}</span>
                  <p className="min-w-0 text-sm">{line.text}</p>
                </div>
                <span className={`tag shrink-0 ${count > 0 ? "tag-pass" : "tag-maybe"}`}>
                  {count} / {MAX_IMAGES} images
                </span>
              </div>

              {cur.map((p, idx) => (
                <div key={idx} className="flex items-center gap-3 rounded-xl border border-line p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-12 w-16 rounded-lg object-cover" />
                  <input
                    className="input min-w-0 flex-1"
                    value={p.caption}
                    onChange={(e) =>
                      setPending({
                        ...pending,
                        [itemId]: cur.map((x, i) =>
                          i === idx ? { ...x, caption: e.target.value } : x
                        ),
                      })
                    }
                    aria-label="Image explanation"
                    placeholder="What does this chart show?"
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => removePending(itemId, idx)}
                    aria-label="Remove image"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-main"
                    onClick={() => uploadFor(itemId)}
                    disabled={uploading === itemId}
                  >
                    Attach
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-line file:bg-transparent file:px-4 file:py-2 file:text-sm file:text-ink"
                  onChange={(e) => addFiles(itemId, line.text, e)}
                  disabled={uploading !== null || count + cur.length >= MAX_IMAGES}
                  aria-label={`Add images for: ${line.text}`}
                />
                {uploading === itemId && <span className="text-xs text-muted">Uploading…</span>}
                {cur.length > 0 && uploading !== itemId && (
                  <span className="text-xs text-muted">{cur.length} ready to attach</span>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-main"
            onClick={finishImages}
            disabled={uploading !== null}
          >
            Done — show my checklist
          </button>
          <button
            type="button"
            className="btn"
            onClick={finishImages}
            disabled={uploading !== null}
          >
            Skip for now
          </button>
        </div>
        <p className="text-xs text-muted">
          Each image gets an AI interpretation you can confirm or correct later in the Visual
          Library.
        </p>
      </div>
    );
  }

  // ---------- list stage ----------

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-tight">My Edge</h1>
          <p className="mt-1 text-muted">
            Your strategy as an approved checklist. Nothing becomes a rule until you approve it.
          </p>
        </div>

        {edges.length > 0 && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className="btn btn-main"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              Create New Edge
              <span aria-hidden="true" className="text-xs">
                ▾
              </span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-2 w-80 rounded-2xl border border-line bg-panel p-2 shadow-2xl"
              >
                <Link
                  href="/app/edge/new"
                  role="menuitem"
                  className="block rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line"
                  onClick={() => setMenuOpen(false)}
                >
                  Create New Edge
                </Link>

                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line"
                  aria-expanded={subMenu === "edge"}
                  onClick={() => setSubMenu((s) => (s === "edge" ? null : "edge"))}
                >
                  Update the Edge you have already created ▸
                </button>
                {subMenu === "edge" && (
                  <ul className="mt-1 space-y-1 border-t border-line pt-1">
                    {edges.map((e) => (
                      <li key={e.id}>
                        <Link
                          href={`/app/edge/${e.id}/settings`}
                          role="menuitem"
                          className="block truncate rounded-xl py-2 pl-6 pr-3 text-sm text-muted hover:bg-line hover:text-ink"
                          onClick={() => setMenuOpen(false)}
                        >
                          {e.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line"
                  aria-expanded={subMenu === "checklist"}
                  onClick={() => setSubMenu((s) => (s === "checklist" ? null : "checklist"))}
                >
                  Update the checklist you have ▸
                </button>
                {subMenu === "checklist" && (
                  <ul className="mt-1 space-y-1 border-t border-line pt-1">
                    {edges.map((e) => (
                      <li key={e.id}>
                        <Link
                          href={`/app/edge/${e.id}/edit`}
                          role="menuitem"
                          className="block truncate rounded-xl py-2 pl-6 pr-3 text-sm text-muted hover:bg-line hover:text-ink"
                          onClick={() => setMenuOpen(false)}
                        >
                          {e.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {edges.map((e) => (
          <Link key={e.id} href={`/app/edge/${e.id}`} className="card block hover:border-accent/40">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">{e.name}</h2>
              {e.active_version ? (
                <span className="tag tag-pass">v{e.active_version} approved</span>
              ) : (
                <span className="tag tag-maybe">draft</span>
              )}
            </div>
            <p className="mt-2 text-sm text-muted">
              {e.approved_items} rules · {e.versions} version{e.versions === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-xs text-muted">
              Updated {new Date(e.updated_at).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
