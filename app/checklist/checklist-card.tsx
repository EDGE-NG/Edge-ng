"use client";

/**
 * The checklist Edge drafts in the chat (PRD 4.2, F2).
 * Live card (latest draft): edit wording, flip hard gate / soft, delete,
 * answer questions, approve. Earlier drafts render as read-only snapshots.
 */
import Link from "next/link";
import { useState } from "react";
import { IconCheck, IconLock, IconPencil, IconTrash } from "./icons";
import { ASSESS_LABEL, CATEGORY_LABEL, CATEGORY_ORDER, type Draft, type Rule } from "./types";

interface LiveProps {
  mode: "live";
  draft: Draft;
  questions: string[];
  busy: boolean;
  onSave: (items: Rule[]) => Promise<void>;
  onApprove: () => Promise<void>;
  onAnswer: (q: string) => void;
  onJudgmentCall: (q: string) => void;
}
interface SnapshotProps {
  mode: "snapshot";
  rules: Rule[];
  versionNumber: number;
}

export default function ChecklistCard(props: LiveProps | SnapshotProps) {
  if (props.mode === "snapshot") return <Snapshot {...props} />;
  return <Live {...props} />;
}

/* ------------------------------------------------------------------ live -- */

function Live({ draft, questions, busy, onSave, onApprove, onAnswer, onJudgmentCall }: LiveProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);
  const items = draft.items;
  const hard = items.filter((r) => r.hard_gate).length;
  const approved = !draft.dirty && draft.approvedVersionNumber != null;

  const save = (next: Rule[]) => onSave(next);
  const toggleHard = (id: string) =>
    save(items.map((r) => (r.id === id ? { ...r, hard_gate: !r.hard_gate } : r)));
  const remove = (id: string) => save(items.filter((r) => r.id !== id));
  const commitEdit = (id: string) => {
    const t = editText.trim();
    setEditing(null);
    if (t && t !== items.find((r) => r.id === id)?.text) {
      void save(items.map((r) => (r.id === id ? { ...r, text: t } : r)));
    }
  };

  async function approve() {
    if (questions.length > 0 && !confirmApprove) {
      setConfirmApprove(true); // PR-CL-4: list open questions before approving
      return;
    }
    setConfirmApprove(false);
    await onApprove();
  }

  return (
    <section className="card mt-3 overflow-hidden p-0" aria-label={`Checklist: ${draft.edgeName}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="truncate text-[1.05rem] font-medium">{draft.edgeName}</h3>
          <p className="text-xs text-muted">
            {items.length} rule{items.length === 1 ? "" : "s"} · {hard} hard gate{hard === 1 ? "" : "s"}
          </p>
        </div>
        {approved ? (
          <span className="tag tag-pass">
            <IconCheck className="h-3.5 w-3.5" /> Approved · v{draft.approvedVersionNumber}
          </span>
        ) : (
          <span className="tag tag-maybe">
            Draft · v{draft.versionNumber}
            {draft.approvedVersionNumber != null && ` (changes since v${draft.approvedVersionNumber})`}
          </span>
        )}
      </header>

      <Groups
        rules={items}
        render={(r, n) => (
          <div className="rule-row group flex gap-3 px-5 py-3" key={r.id}>
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-[0.72rem] tabular-nums text-muted">
              {n}
            </span>
            <div className="min-w-0 flex-1">
              {editing === r.id ? (
                <input
                  className="input py-1.5"
                  autoFocus
                  value={editText}
                  maxLength={240}
                  aria-label={`Edit rule ${n}`}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => commitEdit(r.id!)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit(r.id!);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <p className="text-[0.95rem] leading-snug text-ink">{r.text}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggleHard(r.id!)}
                  className={`tag cursor-pointer ${r.hard_gate ? "tag-pass" : "tag-neutral"} hover:opacity-80 disabled:cursor-wait`}
                  aria-pressed={r.hard_gate}
                  title={r.hard_gate ? "Hard gate: must pass. Click to make it a soft preference." : "Soft preference: shown, never blocks. Click to make it a hard gate."}
                >
                  {r.hard_gate && <IconLock />}
                  {r.hard_gate ? "Hard gate" : "Soft"}
                </button>
                <span className="tag tag-neutral">{ASSESS_LABEL[r.assessability]}</span>
                {r.required_timeframe && <span className="tag tag-neutral">{r.required_timeframe}</span>}
              </div>
              {r.source_span && (
                <p className="mt-2 text-[0.8rem] leading-snug text-muted">
                  <span className="mr-1 text-[0.7rem] uppercase tracking-wider">Your words</span>“{r.source_span}”
                </p>
              )}
            </div>
            {/* edits always land in the open draft; after approval that is the next version */}
            <div className="rule-actions flex shrink-0 items-start gap-1">
                <button
                  type="button"
                  className="icon-btn h-8 w-8 border-transparent"
                  aria-label={`Edit rule ${n}`}
                  disabled={busy}
                  onClick={() => {
                    setEditing(r.id!);
                    setEditText(r.text);
                  }}
                >
                  <IconPencil />
                </button>
                <button
                  type="button"
                  className="icon-btn h-8 w-8 border-transparent hover:!text-fail"
                  aria-label={`Delete rule ${n}`}
                  disabled={busy}
                  onClick={() => remove(r.id!)}
                >
                  <IconTrash />
                </button>
              </div>
          </div>
        )}
      />

      {questions.length > 0 && (
        <div className="border-t border-line bg-warn-bg/60 px-5 py-4">
          <p className="text-sm font-medium text-maybe">
            {questions.length === 1 ? "One thing to pin down" : `${questions.length} things to pin down`}
          </p>
          <ul className="mt-2 space-y-2.5">
            {questions.map((q) => (
              <li key={q} className="text-sm">
                <p className="text-ink">{q}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <button type="button" className="chip-btn py-1.5 text-xs" onClick={() => onAnswer(q)}>
                    Answer
                  </button>
                  <button
                    type="button"
                    className="chip-btn py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => onJudgmentCall(q)}
                    title="Keep the rule; you'll confirm it yourself at the gate"
                  >
                    It&apos;s a judgment call
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="border-t border-line px-5 py-4">
        {approved ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              This is your active checklist. Edits from here create v{draft.versionNumber}.
            </p>
            <Link href="/app/visual" className="btn btn-main btn-sm">
              Add chart examples
            </Link>
          </div>
        ) : confirmApprove ? (
          <div className="space-y-3" role="alertdialog" aria-label="Open questions">
            <p className="text-sm text-ink">
              You still have {questions.length} open question{questions.length === 1 ? "" : "s"}. Rules
              with vague wording are harder to check. Approve anyway?
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-main btn-sm" disabled={busy} onClick={approve}>
                Approve anyway
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmApprove(false)}>
                Keep editing
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[30em] text-xs text-muted">
              Nothing is a rule until you approve it. Approving locks v{draft.versionNumber}; later edits
              create a new version.
            </p>
            <button
              type="button"
              className="btn btn-main btn-sm"
              disabled={busy || items.length === 0}
              onClick={approve}
            >
              {busy ? "Saving…" : "Approve checklist"}
            </button>
          </div>
        )}
      </footer>
    </section>
  );
}

/* -------------------------------------------------------------- snapshot -- */

function Snapshot({ rules, versionNumber }: SnapshotProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-2xl border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm text-muted hover:text-ink"
        aria-expanded={open}
      >
        <span>
          Earlier draft · v{versionNumber} · {rules.length} rule{rules.length === 1 ? "" : "s"}
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-line pb-2">
          <Groups
            rules={rules}
            render={(r, n) => (
              <div key={n} className="flex gap-3 px-4 py-2 text-sm">
                <span className="w-5 shrink-0 text-right tabular-nums text-muted">{n}.</span>
                <span className="flex-1 text-ink/85">{r.text}</span>
                <span className={`tag ${r.hard_gate ? "tag-pass" : "tag-neutral"}`}>
                  {r.hard_gate ? "Hard" : "Soft"}
                </span>
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- groups -- */

/** Rules grouped by category; numbers follow the stored order (the AI's numbering). */
function Groups({ rules, render }: { rules: Rule[]; render: (r: Rule, n: number) => React.ReactNode }) {
  const numbered = rules.map((r, i) => ({ r, n: i + 1 }));
  return (
    <div className="divide-y divide-line">
      {CATEGORY_ORDER.map((cat) => {
        const group = numbered.filter((x) => x.r.category === cat);
        if (!group.length) return null;
        return (
          <div key={cat} className="py-1">
            <p className="px-5 pt-3 pb-0.5 text-[0.7rem] font-medium uppercase tracking-[0.16em] text-accent">
              {CATEGORY_LABEL[cat]}
            </p>
            {group.map(({ r, n }) => render(r, n))}
          </div>
        );
      })}
    </div>
  );
}
