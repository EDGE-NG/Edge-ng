"use client";

/**
 * Evidence library (PRD 4.3, F4): show Edge what each rule looks like on a
 * chart. 1 to 6 images per rule, each marked valid or invalid, read by Edge
 * and confirmed by the trader before it is used at the gate.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AppFrame from "../../_components/app-frame";
import { IconCheck, IconImages, IconMic, IconPlus, IconRetry, IconTrash, IconX } from "../../_components/icons";
import { useVoiceNote } from "../../_components/use-voice-note";

/* ------------------------------------------------------------- types ----- */

interface Reading {
  is_chart: boolean;
  readable: boolean;
  sensitive_info: boolean;
  low_confidence: boolean;
  label_mismatch: boolean;
  timeframe: string | null;
  instrument: string | null;
  market_condition: string | null;
  reading: string;
  why: string;
  features: string[];
  problem: string | null;
}
interface Img {
  id: string;
  item_key: string;
  polarity: "valid" | "invalid";
  status: string;
  width: number | null;
  height: number | null;
  trader_note: string | null;
  interpretation_text: string | null;
  reading: Reading | null;
  confirmed: boolean;
  corrected: boolean;
}
interface Coverage {
  timeframes: string[];
  instruments: string[];
  conditions: string[];
  valid: number;
  invalid: number;
}
interface Rule {
  id: string;
  item_key: string;
  category: string;
  text: string;
  hard_gate: boolean;
  assessability: "chart" | "context_needed" | "manual";
  required_timeframe: string | null;
  needsImages: boolean;
  images: Img[];
  coverage: Coverage;
  ready: boolean;
}
interface Checklist {
  edgeId: string;
  name: string;
  versionNumber: number;
  chatId: string | null;
  rules: Rule[];
}

const MAX = 6;
const CATEGORY_LABEL: Record<string, string> = {
  entry: "Entry",
  context: "Context",
  confirmation: "Confirmation",
  invalidation: "Invalidation",
  risk: "Risk",
  note: "Notes",
};

type Dialog = { mode: "new"; rule: Rule } | { mode: "detail"; rule: Rule; image: Img } | null;

/* -------------------------------------------------------------- page ----- */

async function fetchLibrary(): Promise<{ lists?: Checklist[]; error?: string }> {
  try {
    const res = await fetch("/api/evidence");
    if (res.status === 401) return {}; // AppFrame handles sign-in
    const d = await res.json();
    if (!res.ok) return { error: d.error || "Couldn't load your evidence." };
    return { lists: d.checklists as Checklist[] };
  } catch {
    return { error: "Couldn't load your evidence. Check your connection." };
  }
}

export default function EvidenceLibrary() {
  const [lists, setLists] = useState<Checklist[] | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchLibrary>>) => {
    if (r.error) return setError(r.error);
    if (!r.lists) return;
    setLists(r.lists);
    setEdgeId((cur) => cur ?? r.lists![0]?.edgeId ?? null);
  }, []);

  const load = useCallback(async () => {
    const r = await fetchLibrary();
    apply(r);
    return r.lists;
  }, [apply]);

  useEffect(() => {
    let alive = true;
    fetchLibrary().then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply]);

  /** Reload and keep an open dialog pointed at fresh data. */
  const refresh = useCallback(
    async (focusImageId?: string) => {
      const fresh = await load();
      if (!fresh) return;
      setDialog((d) => {
        if (!d) return d;
        const list = fresh.find((c) => c.edgeId === edgeId);
        const rule = list?.rules.find((r) => r.item_key === d.rule.item_key);
        if (!rule) return null;
        const id = focusImageId ?? (d.mode === "detail" ? d.image.id : undefined);
        const image = id ? rule.images.find((i) => i.id === id) : undefined;
        return image ? { mode: "detail", rule, image } : d.mode === "new" ? { mode: "new", rule } : null;
      });
    },
    [load, edgeId]
  );

  const list = lists?.find((c) => c.edgeId === edgeId) ?? null;
  const chartRules = list?.rules.filter((r) => r.needsImages) ?? [];
  const ready = chartRules.filter((r) => r.ready).length;
  const toCheck = chartRules.reduce((n, r) => n + r.images.filter((i) => !i.confirmed).length, 0);

  return (
    <AppFrame
      active="evidence"
      title="Evidence library"
      actions={
        lists && lists.length > 1 ? (
          <select
            className="input h-10 w-auto max-w-[240px] py-0 text-sm"
            value={edgeId ?? ""}
            onChange={(e) => setEdgeId(e.target.value)}
            aria-label="Checklist"
          >
            {lists.map((c) => (
              <option key={c.edgeId} value={c.edgeId}>
                {c.name} · v{c.versionNumber}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      <div className="mx-auto w-full max-w-[980px] px-4 py-8 sm:px-6">
        {error && <p role="alert" className="mb-4 text-sm text-fail">{error}</p>}
        {!lists ? (
          <p className="text-sm text-muted">Loading your evidence…</p>
        ) : !list ? (
          <section className="card p-8 text-center fade-up">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-line text-accent">
              <IconImages className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-2xl font-light tracking-[-0.03em]">Approve a checklist first</h2>
            <p className="mx-auto mt-2 max-w-[30em] text-ink/75">
              Chart examples attach to the rules of an approved checklist. Build and approve yours, then come back to
              show Edge what each rule looks like.
            </p>
            <Link href="/checklist" className="btn btn-main btn-sm mt-6">
              Go to your checklist
            </Link>
          </section>
        ) : (
          <>
            <section className="card mb-8 fade-up">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted">
                    {list.name} · v{list.versionNumber}
                  </p>
                  <h2 className="mt-1 text-[1.7rem] leading-tight font-light tracking-[-0.04em]">
                    {chartRules.length === 0
                      ? "No chart rules in this checklist"
                      : `${ready} of ${chartRules.length} chart rule${chartRules.length === 1 ? "" : "s"} ready`}
                  </h2>
                </div>
                {toCheck > 0 && (
                  <span className="tag tag-maybe">
                    {toCheck} image{toCheck === 1 ? "" : "s"} need{toCheck === 1 ? "s" : ""} your check
                  </span>
                )}
              </div>
              {chartRules.length > 0 && (
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-track" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#2fbf68,#dcff3c)] transition-[width] duration-700"
                    style={{ width: `${(ready / chartRules.length) * 100}%` }}
                  />
                </div>
              )}
              <p className="mt-4 text-sm text-ink/75">
                A rule is checked at the gate only once it has at least one image you&apos;ve confirmed. Add 1 to {MAX}{" "}
                per rule, mixing valid and invalid examples. Rules you confirm yourself don&apos;t need images.
              </p>
            </section>

            <div className="space-y-5">
              {list.rules.map((r, i) => (
                <RuleBlock
                  key={r.item_key}
                  n={i + 1}
                  rule={r}
                  onAdd={() => setDialog({ mode: "new", rule: r })}
                  onOpen={(image) => setDialog({ mode: "detail", rule: r, image })}
                />
              ))}
            </div>

            {ready === chartRules.length && chartRules.length > 0 && (
              <section className="card mt-8 flex flex-wrap items-center justify-between gap-4">
                <p className="text-ink/85">Every chart rule has confirmed evidence. Your checklist is ready for the trade workspace.</p>
                <Link href="/app/workspace" className="btn btn-main btn-sm">
                  Open trade workspace
                </Link>
              </section>
            )}
          </>
        )}
      </div>

      {dialog && list && (
        <EvidenceDialog
          key={dialog.mode === "detail" ? dialog.image.id : `new-${dialog.rule.item_key}`}
          edgeId={list.edgeId}
          dialog={dialog}
          onClose={() => setDialog(null)}
          onChanged={refresh}
        />
      )}
    </AppFrame>
  );
}

/* ----------------------------------------------------------- one rule ---- */

function RuleBlock({
  n,
  rule,
  onAdd,
  onOpen,
}: {
  n: number;
  rule: Rule;
  onAdd: () => void;
  onOpen: (img: Img) => void;
}) {
  const left = MAX - rule.images.length;
  const cov = rule.coverage;
  const hints: string[] = [];
  if (rule.needsImages && cov.valid + cov.invalid > 0) {
    if (cov.timeframes.length < 2) hints.push("a different timeframe");
    if (cov.conditions.length < 2) hints.push("another market condition");
    if (cov.invalid === 0) hints.push("an invalid example");
    if (cov.valid === 0) hints.push("a valid example");
  }

  return (
    <section className="card" aria-labelledby={`rule-${rule.item_key}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-xs tabular-nums text-muted">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.16em] text-accent">
            {CATEGORY_LABEL[rule.category] ?? rule.category}
          </p>
          <h3 id={`rule-${rule.item_key}`} className="mt-0.5 text-[1.05rem] font-medium leading-snug">
            {rule.text}
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`tag ${rule.hard_gate ? "tag-pass" : "tag-neutral"}`}>{rule.hard_gate ? "Hard gate" : "Soft"}</span>
            {rule.required_timeframe && <span className="tag tag-neutral">{rule.required_timeframe}</span>}
          </div>
        </div>
        {rule.needsImages ? (
          rule.ready ? (
            <span className="tag tag-pass">
              <IconCheck className="h-3.5 w-3.5" /> Ready
            </span>
          ) : (
            <span className="tag tag-maybe">Needs a confirmed image</span>
          )
        ) : (
          <span className="tag tag-neutral">You confirm at the gate</span>
        )}
      </div>

      {!rule.needsImages ? (
        <p className="mt-4 text-sm text-ink/70">
          {rule.assessability === "context_needed"
            ? "This rule needs information a chart can't show (news, calendar, sessions). Edge will ask you to confirm it before each trade."
            : "Only you can confirm this rule. Edge will ask you to tick it before each trade. No images needed."}
        </p>
      ) : (
        <>
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Chart examples">
            {rule.images.map((img) => (
              <li key={img.id}>
                <button
                  type="button"
                  onClick={() => onOpen(img)}
                  className="group relative block aspect-[4/3] w-full overflow-hidden rounded-xl border border-line bg-panel text-left"
                  aria-label={`${img.polarity === "valid" ? "Valid" : "Invalid"} example${img.confirmed ? ", confirmed" : ", needs your check"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/evidence/${img.id}/file`}
                    alt=""
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                  />
                  <span
                    className={`absolute top-1.5 left-1.5 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${
                      img.polarity === "valid" ? "bg-[#0e2a1b] text-pass" : "bg-[#2c0f15] text-fail"
                    }`}
                  >
                    {img.polarity === "valid" ? "✓ Valid" : "✕ Invalid"}
                  </span>
                  <span
                    className={`absolute inset-x-0 bottom-0 px-2 py-1 text-[0.68rem] font-medium ${
                      img.confirmed ? "bg-black/60 text-ink/85" : "bg-[#2c250c]/90 text-maybe"
                    }`}
                  >
                    {img.confirmed ? "Confirmed" : "Check Edge's reading"}
                  </span>
                </button>
              </li>
            ))}
            {left > 0 && (
              <li>
                <button
                  type="button"
                  onClick={onAdd}
                  className="grid aspect-[4/3] w-full place-items-center rounded-xl border border-dashed border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] text-sm text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
                >
                  <span className="flex flex-col items-center gap-1">
                    <IconPlus className="h-5 w-5 text-accent" />
                    Add example
                    <span className="text-xs text-muted">{left} of {MAX} left</span>
                  </span>
                </button>
              </li>
            )}
            {Array.from({ length: Math.max(0, left - 1) }).map((_, i) => (
              <li key={`empty-${i}`} aria-hidden="true" className="hidden aspect-[4/3] rounded-xl border border-dashed border-line lg:block" />
            ))}
          </ul>

          {(cov.valid + cov.invalid > 0 || hints.length > 0) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {cov.valid + cov.invalid > 0 && (
                <span className="text-ink/75">
                  Covers{" "}
                  {[...cov.timeframes, ...cov.instruments, ...cov.conditions].join(" · ") || "confirmed examples"}
                </span>
              )}
              {hints.length > 0 && (
                <span className="text-maybe">Add {hints.join(", ")} so Edge isn&apos;t fooled by one look.</span>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ dialog ----- */

function EvidenceDialog({
  edgeId,
  dialog,
  onClose,
  onChanged,
}: {
  edgeId: string;
  dialog: NonNullable<Dialog>;
  onClose: () => void;
  onChanged: (focusImageId?: string) => Promise<void>;
}) {
  const { rule } = dialog;
  const image = dialog.mode === "detail" ? dialog.image : null;
  const panel = useRef<HTMLDivElement>(null);

  // new-image form
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [polarity, setPolarity] = useState<"valid" | "invalid" | null>(image?.polarity ?? null);
  const [note, setNote] = useState(image?.trader_note ?? "");
  // detail
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [busy, setBusy] = useState<"" | "upload" | "confirm" | "reread" | "remove" | "save">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const voice = useVoiceNote((t, low) => {
    setNote((p) => (p.trim() ? p.trimEnd() + " " : "") + t);
    setNotice(low ? "Some words were hard to hear. Check the note." : "");
  });

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function pick(f: File | null | undefined) {
    setError("");
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      setError("Use a PNG, JPEG or WebP chart screenshot.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("That image is over 10 MB. Export a smaller screenshot.");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  // paste a screenshot straight from the clipboard
  useEffect(() => {
    if (dialog.mode !== "new") return;
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (f) pick(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [dialog.mode]);

  async function upload(replaceId?: string, replacement?: File) {
    const f = replacement ?? file;
    const pol = polarity;
    if (!f || !pol) return;
    setBusy("upload");
    setError("");
    try {
      const fd = new FormData();
      fd.append("edgeId", edgeId);
      fd.append("itemKey", rule.item_key);
      fd.append("polarity", pol);
      if (note.trim()) fd.append("note", note.trim());
      if (replaceId) fd.append("replaceId", replaceId);
      fd.append("file", f);
      const res = await fetch("/api/evidence", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Upload failed.");
      await onChanged(d.image.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function patch(body: Record<string, unknown>, kind: "confirm" | "reread" | "save") {
    if (!image) return;
    setBusy(kind);
    setError("");
    try {
      const res = await fetch(`/api/evidence/${image.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't save that.");
      setCorrecting(false);
      await onChanged(image.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (!image) return;
    setBusy("remove");
    try {
      await fetch(`/api/evidence/${image.id}`, { method: "DELETE" });
      await onChanged();
      onClose();
    } finally {
      setBusy("");
    }
  }

  const r = image?.reading;
  const noteChanged = image && (note.trim() || null) !== (image.trader_note ?? null);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ev-title"
        className="glass-panel theme-dark max-h-[92dvh] w-full max-w-[980px] overflow-y-auto rounded-b-none p-5 outline-none sm:rounded-[20px] sm:p-7"
        style={{ background: "linear-gradient(180deg,#0b1512,#060c0a)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-muted">
              {dialog.mode === "new" ? "Add a chart example" : image?.confirmed ? "Confirmed example" : "Check Edge's reading"}
            </p>
            <h2 id="ev-title" className="mt-1 text-xl font-medium leading-snug">{rule.text}</h2>
          </div>
          <button type="button" className="icon-btn shrink-0" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>

        <div className="mt-5 grid gap-6 md:grid-cols-[1.25fr_1fr]">
          {/* image side */}
          <div>
            {dialog.mode === "new" ? (
              <label
                className={`flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed text-center ${
                  preview ? "border-line" : "border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)]"
                }`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pick(e.dataTransfer.files?.[0]);
                }}
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="Chart to upload" className="h-full w-full object-contain" />
                ) : (
                  <span className="px-6">
                    <IconImages className="mx-auto h-8 w-8 text-accent" />
                    <span className="mt-3 block font-medium text-ink">Drop a chart screenshot, paste it, or click to choose</span>
                    <span className="mt-1 block text-sm text-ink/65">PNG, JPEG or WebP · up to 10 MB · at least 400×250</span>
                  </span>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
              </label>
            ) : (
              image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/evidence/${image.id}/file`}
                  alt={`${image.polarity} example chart`}
                  className="w-full rounded-2xl border border-line bg-black object-contain"
                />
              )
            )}
            {dialog.mode === "new" && (
              <p className="mt-3 text-sm text-maybe">
                Crop out account numbers, balances and your name before uploading.
              </p>
            )}
          </div>

          {/* details side */}
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">This chart is a</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["valid", "invalid"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={polarity === p}
                    disabled={busy !== ""}
                    onClick={() => {
                      setPolarity(p);
                      if (image && p !== image.polarity) void patch({ polarity: p }, "reread");
                    }}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                      polarity === p
                        ? p === "valid"
                          ? "border-pass bg-pass-bg text-pass"
                          : "border-fail bg-err-bg text-fail"
                        : "border-line text-ink/80 hover:border-[color-mix(in_srgb,var(--color-ink)_30%,transparent)]"
                    }`}
                  >
                    {p === "valid" ? "✓ Valid example" : "✕ Invalid example"}
                    <span className="mt-0.5 block text-xs font-normal opacity-80">
                      {p === "valid" ? "the rule is met" : "the rule is broken"}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="ev-note" className="mb-2 block text-sm font-medium">
                Why? <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="ev-note"
                className="input min-h-[78px] resize-y"
                placeholder="e.g. Price tags the 20 EMA and closes back above it"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {voice.state === "recording" ? (
                  <>
                    <span className="rec-dot" aria-hidden="true" />
                    <span className="font-mono text-sm tabular-nums">{Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, "0")}</span>
                    <button type="button" className="btn btn-sm" onClick={voice.cancel}>Discard</button>
                    <button type="button" className="btn btn-main btn-sm" onClick={voice.stop}>Done</button>
                  </>
                ) : (
                  <button type="button" className="speak-btn" onClick={voice.start} disabled={!voice.supported || voice.state !== "idle"}>
                    <IconMic /> {voice.state === "transcribing" ? "Transcribing…" : "Speak a note"}
                  </button>
                )}
                {image && noteChanged && (
                  <button type="button" className="btn btn-sm" disabled={busy !== ""} onClick={() => patch({ note }, "save")}>
                    {busy === "save" ? "Saving…" : "Save note"}
                  </button>
                )}
              </div>
              {(voice.error || notice) && <p className="mt-2 text-sm text-maybe">{voice.error || notice}</p>}
            </div>

            {dialog.mode === "new" ? (
              <button
                type="button"
                className="btn btn-main w-full"
                disabled={!file || !polarity || busy !== ""}
                onClick={() => upload()}
              >
                {busy === "upload" ? "Edge is reading your chart…" : "Add and let Edge read it"}
              </button>
            ) : (
              image && (
                <section className="rounded-2xl border border-line p-4" aria-label="Edge's reading">
                  <p className="text-xs uppercase tracking-[0.16em] text-accent">
                    {image.corrected ? "Your reading" : "How Edge reads it"}
                  </p>
                  {correcting ? (
                    <textarea
                      className="input mt-2 min-h-[110px]"
                      value={correction}
                      maxLength={1000}
                      onChange={(e) => setCorrection(e.target.value)}
                      aria-label="Correct Edge's reading"
                    />
                  ) : (
                    <p className="mt-2 text-[0.95rem] leading-relaxed text-ink">{image.interpretation_text}</p>
                  )}
                  {r && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {[r.timeframe, r.instrument, r.market_condition].filter(Boolean).map((x) => (
                        <span key={x} className="tag tag-neutral">{x}</span>
                      ))}
                    </div>
                  )}
                  {r?.sensitive_info && (
                    <p className="mt-3 rounded-xl bg-err-bg px-3 py-2 text-sm text-fail">
                      Account details may be visible in this image. Replace it with a cropped screenshot.
                    </p>
                  )}
                  {r && (r.low_confidence || !r.readable) && (
                    <p className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-sm text-maybe">
                      Edge isn&apos;t sure about this one{r.problem ? `: ${r.problem}` : "."} A clearer image helps.
                    </p>
                  )}
                  {r?.label_mismatch && (
                    <p className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-sm text-maybe">
                      This looks like it might not match your label{r.problem ? `: ${r.problem}` : "."} You decide; check the label.
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {correcting ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-main btn-sm"
                          disabled={busy !== "" || !correction.trim()}
                          onClick={() => patch({ action: "confirm", text: correction }, "confirm")}
                        >
                          {busy === "confirm" ? "Saving…" : "Save and confirm"}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setCorrecting(false)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        {!image.confirmed && (
                          <button
                            type="button"
                            className="btn btn-main btn-sm"
                            disabled={busy !== ""}
                            onClick={() => patch({ action: "confirm" }, "confirm")}
                          >
                            {busy === "confirm" ? "Confirming…" : "That's right"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy !== ""}
                          onClick={() => {
                            setCorrection(image.interpretation_text ?? "");
                            setCorrecting(true);
                          }}
                        >
                          {image.confirmed ? "Edit reading" : "Correct it"}
                        </button>
                        <button type="button" className="btn btn-sm" disabled={busy !== ""} onClick={() => patch({ action: "reread" }, "reread")}>
                          <IconRetry /> {busy === "reread" ? "Reading…" : "Read again"}
                        </button>
                      </>
                    )}
                  </div>
                  {image.confirmed && !correcting && (
                    <p className="mt-3 flex items-center gap-1.5 text-sm text-pass">
                      <IconCheck className="h-4 w-4" /> Confirmed. Edge uses this example at the gate.
                    </p>
                  )}
                </section>
              )
            )}

            {image && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <label className={`btn btn-sm cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
                  Replace image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(image.id, f);
                    }}
                  />
                </label>
                {confirmRemove ? (
                  <>
                    <span className="text-sm text-fail">Stop using this image?</span>
                    <button type="button" className="btn btn-danger btn-sm" disabled={busy !== ""} onClick={remove}>
                      {busy === "remove" ? "Removing…" : "Remove"}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setConfirmRemove(false)}>Keep</button>
                  </>
                ) : (
                  <button type="button" className="btn btn-sm ml-auto" onClick={() => setConfirmRemove(true)}>
                    <IconTrash /> Don&apos;t use this image
                  </button>
                )}
              </div>
            )}

            {busy === "upload" && image && <p className="text-sm text-muted">Edge is reading the new image…</p>}
            {error && <p role="alert" className="text-sm text-fail">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
