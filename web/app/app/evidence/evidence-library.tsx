"use client";

/**
 * Evidence library (PRD 4.3, F4; Figma 58 to 75): show Edge what each rule
 * looks like on a chart. 1 to 6 examples per rule, each marked good or bad,
 * read by Edge and confirmed by the trader before it is used at the gate.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppFrame from "../../_components/app-frame";
import Dropdown from "../../_components/dropdown";
import {
  IconAlertCircle,
  IconArrowRight,
  IconCheck,
  IconCheckCircle,
  IconImages,
  IconMic,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
  IconXCircle,
} from "../../_components/icons";
import { toast } from "../../_components/toaster";
import { useVoiceNote } from "../../_components/use-voice-note";
import { handleSessionExpired } from "@/lib/client-auth";

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
  trader_note: string | null;
  interpretation_text: string | null;
  reading: Reading | null;
  confirmed: boolean;
  corrected: boolean;
  created_at: string;
}
interface Rule {
  id: string;
  item_key: string;
  category: string;
  text: string;
  hard_gate: boolean;
  needsImages: boolean;
  images: Img[];
}
interface Checklist {
  edgeId: string;
  name: string;
  versionNumber: number;
  rules: Rule[];
}
/** One example with the rule and checklist it belongs to. */
interface Example extends Img {
  edgeId: string;
  listName: string;
  rule: Rule;
}
/** A chart rule, addressed across checklists as "<edgeId>|<item_key>". */
interface RuleRef {
  key: string;
  edgeId: string;
  listName: string;
  rule: Rule;
  count: number;
}

const MAX = 6;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

type Polarity = "all" | "valid" | "invalid";
type Modal =
  | { kind: "add"; ruleKey?: string }
  | { kind: "detail"; id: string }
  | { kind: "delete"; ids: string[] }
  | null;

const ruleKeyOf = (edgeId: string, itemKey: string) => `${edgeId}|${itemKey}`;

function shortDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function metaLine(x: Img, prefix = ""): string {
  return [x.reading?.instrument, x.reading?.timeframe, prefix + shortDate(x.created_at)].filter(Boolean).join(" · ");
}

async function fetchLibrary(): Promise<{ lists?: Checklist[]; error?: string }> {
  try {
    const res = await fetch("/api/evidence");
    if (res.status === 401) {
      handleSessionExpired();
      return {};
    }
    const d = await res.json();
    if (!res.ok) return { error: d.error || "We could not load your examples. Try again." };
    return { lists: d.checklists as Checklist[] };
  } catch {
    return { error: "We could not load your examples. Check your connection and try again." };
  }
}

/* -------------------------------------------------------------- page ----- */

export default function EvidenceLibrary() {
  const [lists, setLists] = useState<Checklist[] | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);

  const [query, setQuery] = useState("");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [polarity, setPolarity] = useState<Polarity>("all");
  const [needsOnly, setNeedsOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchLibrary>>) => {
    if (r.error) return setError(r.error);
    if (!r.lists) return;
    setError("");
    setLists(r.lists);
  }, []);

  const reload = useCallback(async () => apply(await fetchLibrary()), [apply]);

  useEffect(() => {
    let alive = true;
    fetchLibrary().then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply]);

  const examples: Example[] = useMemo(
    () =>
      (lists ?? [])
        .flatMap((l) =>
          l.rules.flatMap((rule) => rule.images.map((img) => ({ ...img, edgeId: l.edgeId, listName: l.name, rule })))
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [lists]
  );

  const chartRules: RuleRef[] = useMemo(
    () =>
      (lists ?? []).flatMap((l) =>
        l.rules
          .filter((r) => r.needsImages)
          .map((rule) => ({
            key: ruleKeyOf(l.edgeId, rule.item_key),
            edgeId: l.edgeId,
            listName: l.name,
            rule,
            count: rule.images.length,
          }))
      ),
    [lists]
  );

  const toConfirm = examples.filter((e) => !e.confirmed);
  const emptyRules = chartRules.filter((r) => r.count === 0).length;

  const shown = examples.filter((e) => {
    if (ruleFilter !== "all" && ruleKeyOf(e.edgeId, e.item_key) !== ruleFilter) return false;
    if (polarity !== "all" && e.polarity !== polarity) return false;
    if (needsOnly && e.confirmed) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [e.rule.text, e.trader_note, e.interpretation_text, e.reading?.instrument, e.listName]
      .filter(Boolean)
      .some((t) => t!.toLowerCase().includes(q));
  });

  const filtered = query.trim() !== "" || ruleFilter !== "all" || polarity !== "all" || needsOnly;
  const clearFilters = () => {
    setQuery("");
    setRuleFilter("all");
    setPolarity("all");
    setNeedsOnly(false);
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Drop selections that no longer exist after a reload.
  const live = new Set(examples.map((e) => e.id));
  const picked = [...selected].filter((id) => live.has(id));

  const detail = modal?.kind === "detail" ? examples.find((e) => e.id === modal.id) ?? null : null;
  const canAdd = chartRules.length > 0;

  return (
    <AppFrame
      active="evidence"
      title="Evidence library"
      actions={
        canAdd ? (
          <button type="button" className="btn btn-main btn-sm" onClick={() => setModal({ kind: "add" })}>
            <IconPlus className="h-4 w-4" /> Add example
          </button>
        ) : undefined
      }
    >
      <div className="mx-auto w-full max-w-[1120px] px-4 pt-7 pb-28 sm:px-6">
        <p className="text-ink/70">Charts that show Edge what each of your rules looks like.</p>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-err-bg px-4 py-3 text-sm text-fail">
            {error}{" "}
            <button type="button" className="underline" onClick={() => void reload()}>
              Try again
            </button>
          </p>
        )}

        {lists && examples.length === 0 ? (
          <EmptyState canAdd={canAdd} onAdd={() => setModal({ kind: "add" })} />
        ) : (
          <>
            {lists && toConfirm.length > 0 ? (
              <Banner
                text={`${toConfirm.length} example${toConfirm.length === 1 ? " needs" : "s need"} you to confirm what Edge read. Open each one and check it.`}
                action="Review first one"
                onAction={() => setModal({ kind: "detail", id: toConfirm[toConfirm.length - 1].id })}
              />
            ) : lists && emptyRules > 0 ? (
              <Banner
                text={`${emptyRules} rule${emptyRules === 1 ? " has" : "s have"} no examples yet. Edge reads a rule better with 1 to 6 examples.`}
                action="Add example"
                onAction={() => setModal({ kind: "add" })}
              />
            ) : null}

            <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_220px_auto_auto]">
              <label className="relative block">
                <span className="sr-only">Search by rule or note</span>
                <IconSearch className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  className="input pl-10"
                  placeholder="Search by rule or note"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <RuleFilter value={ruleFilter} onChange={setRuleFilter} rules={chartRules} total={examples.length} />
              <div role="group" aria-label="Good or bad examples" className="flex rounded-xl border border-line bg-surface p-1">
                {(
                  [
                    ["all", "All"],
                    ["valid", "Good"],
                    ["invalid", "Bad"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={polarity === v}
                    onClick={() => setPolarity(v)}
                    className={`rounded-lg px-3.5 py-1.5 text-sm transition-colors ${
                      polarity === v ? "bg-pass-bg text-accent ring-1 ring-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]" : "text-ink/75 hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-pressed={needsOnly}
                onClick={() => setNeedsOnly((v) => !v)}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition-colors ${
                  needsOnly ? "border-maybe bg-warn-bg text-maybe" : "border-line bg-surface text-ink/80 hover:text-ink"
                }`}
              >
                <IconAlertCircle className="h-4 w-4" /> Needs reading confirmed
                <span className="tabular-nums text-muted">{toConfirm.length}</span>
              </button>
            </div>

            {!lists ? (
              <SkeletonGrid />
            ) : shown.length === 0 && filtered ? (
              <section className="mt-6 card py-14 text-center">
                <h2 className="text-lg font-medium">No examples match</h2>
                <p className="mt-1 text-sm text-ink/70">Try removing a filter or searching for something else.</p>
                <button type="button" className="btn btn-sm mt-5" onClick={clearFilters}>
                  Clear filters
                </button>
              </section>
            ) : (
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Chart examples">
                {shown.map((e) => (
                  <ExampleCard
                    key={e.id}
                    ex={e}
                    selecting={picked.length > 0}
                    selected={selected.has(e.id)}
                    onToggle={() => toggle(e.id)}
                    onOpen={() => setModal({ kind: "detail", id: e.id })}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {picked.length > 0 && (
        <SelectionBar
          ids={picked}
          examples={examples}
          rules={chartRules}
          onClear={() => setSelected(new Set())}
          onDelete={() => setModal({ kind: "delete", ids: picked })}
          onMoved={async () => {
            setSelected(new Set());
            await reload();
          }}
        />
      )}

      {modal?.kind === "add" && (
        <AddDialog
          rules={chartRules}
          initialRule={modal.ruleKey ?? (ruleFilter !== "all" ? ruleFilter : undefined)}
          onClose={() => setModal(null)}
          onManage={(key) => {
            clearFilters();
            setRuleFilter(key);
            setModal(null);
          }}
          onAdded={async (id) => {
            setModal(null);
            await reload();
            toast.success("Example added. Check what Edge read.", {
              action: { label: "View", onClick: () => setModal({ kind: "detail", id }) },
            });
          }}
        />
      )}

      {detail && (
        <DetailDialog
          key={detail.id}
          ex={detail}
          onClose={() => setModal(null)}
          onChanged={reload}
          onDelete={() => setModal({ kind: "delete", ids: [detail.id] })}
        />
      )}

      {modal?.kind === "delete" && (
        <DeleteDialog
          ids={modal.ids}
          examples={examples}
          onClose={() => setModal(null)}
          onDeleted={async () => {
            setModal(null);
            setSelected(new Set());
            await reload();
            toast.success(modal.ids.length === 1 ? "Example deleted." : `${modal.ids.length} examples deleted.`);
          }}
        />
      )}
    </AppFrame>
  );
}

/* ------------------------------------------------------- page pieces ----- */

function IconSearch({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}

function IconUpload({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}

function Banner({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-pass-bg px-4 py-3 text-sm">
      <IconAlertCircle className="h-[18px] w-[18px] shrink-0 text-maybe" />
      <p className="min-w-0 flex-1 text-ink/90">{text}</p>
      <button type="button" className="font-medium text-accent hover:underline" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

function PolarityTag({ polarity }: { polarity: "valid" | "invalid" }) {
  return polarity === "valid" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-pass)_40%,transparent)] bg-pass-bg px-2.5 py-1 text-xs font-medium text-pass">
      <IconCheckCircle /> Good example
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-fail)_40%,transparent)] bg-err-bg px-2.5 py-1 text-xs font-medium text-fail">
      <IconXCircle /> Bad example
    </span>
  );
}

function ReadingPill({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-pass)_40%,transparent)] px-2.5 py-1 text-xs font-medium text-pass">
      <IconCheckCircle /> Reading confirmed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-maybe)_45%,transparent)] px-2.5 py-1 text-xs font-medium text-maybe">
      <IconAlertCircle /> Confirm reading
    </span>
  );
}

function EmptyState({ canAdd, onAdd }: { canAdd: boolean; onAdd: () => void }) {
  return (
    <section className="card mt-6 px-6 py-14 text-center fade-up">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-line text-accent">
        <IconImages className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-2xl font-light tracking-[-0.03em]">Show Edge what your rules look like</h2>
      <p className="mx-auto mt-2 max-w-[32em] text-ink/75">
        {canAdd
          ? "Add 1 to 6 chart screenshots for each rule. Mark each one as a good or a bad example. Edge learns what you mean from them."
          : "Examples attach to the rules of an approved checklist. Approve your checklist first, then add 1 to 6 chart screenshots for each rule."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {canAdd && (
          <button type="button" className="btn btn-main btn-sm" onClick={onAdd}>
            <IconPlus className="h-4 w-4" /> Add example
          </button>
        )}
        <Link href="/checklist" className="btn btn-sm">
          Go to checklist
        </Link>
      </div>
    </section>
  );
}

function SkeletonGrid() {
  return (
    <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading your examples" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="aspect-[16/9] animate-pulse bg-track" />
          <div className="space-y-2.5 p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-track" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-track" />
            <div className="h-6 w-28 animate-pulse rounded-full bg-track" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RuleFilter({
  value,
  onChange,
  rules,
  total,
}: {
  value: string;
  onChange: (v: string) => void;
  rules: RuleRef[];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const current = rules.find((r) => r.key === value);
  const groups = [...new Set(rules.map((r) => r.edgeId))].map((id) => rules.filter((r) => r.edgeId === id));
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`input flex items-center justify-between gap-2 text-left ${open ? "border-accent" : ""}`}
      >
        <span className="truncate">{current ? current.rule.text : "All rules"}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Rule"
          className="absolute top-full right-0 z-30 mt-2 max-h-[420px] w-[min(400px,90vw)] overflow-y-auto rounded-2xl border border-line bg-panel p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]"
        >
          <FilterOption selected={value === "all"} label="All rules" right={`${total} example${total === 1 ? "" : "s"}`} onPick={() => pick("all")} />
          {groups.map((g) => (
            <div key={g[0].edgeId}>
              <p className="px-3 pt-3 pb-1 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted">{g[0].listName}</p>
              {g.map((r) => (
                <FilterOption
                  key={r.key}
                  selected={value === r.key}
                  label={r.rule.text}
                  right={r.count === 0 ? "None yet" : `${r.count} of ${MAX}`}
                  warn={r.count === 0}
                  onPick={() => pick(r.key)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterOption({
  selected,
  label,
  right,
  warn,
  onPick,
}: {
  selected: boolean;
  label: string;
  right: string;
  warn?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-track ${selected ? "bg-track" : ""}`}
    >
      <span className="min-w-0 flex-1">{label}</span>
      <span className={`shrink-0 text-xs tabular-nums ${warn ? "text-maybe" : "text-muted"}`}>{right}</span>
      {selected && <IconCheck className="h-4 w-4 shrink-0 text-accent" />}
    </button>
  );
}

function ExampleCard({
  ex,
  selecting,
  selected,
  onToggle,
  onOpen,
}: {
  ex: Example;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <li
      className={`group relative overflow-hidden rounded-2xl border bg-surface transition-colors ${
        selected ? "border-accent ring-1 ring-accent" : "border-line hover:border-[color-mix(in_srgb,var(--color-ink)_25%,transparent)]"
      }`}
    >
      <button type="button" onClick={selecting ? onToggle : onOpen} className="block w-full text-left" aria-label={`${ex.polarity === "valid" ? "Good" : "Bad"} example: ${ex.rule.text}. ${ex.confirmed ? "Reading confirmed" : "Confirm reading"}`}>
        <div className="relative aspect-[16/9] overflow-hidden border-b border-line bg-panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/evidence/${ex.id}/file`} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          <span className="absolute top-3 left-3">
            <PolarityTag polarity={ex.polarity} />
          </span>
        </div>
        <div className="p-4">
          <h3 className="font-medium leading-snug">{ex.rule.text}</h3>
          <p className="mt-1 text-xs text-muted">{metaLine(ex)}</p>
          <div className="mt-3">
            <ReadingPill confirmed={ex.confirmed} />
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={selected ? "Unselect this example" : "Select this example"}
        className={`absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-full border transition-opacity ${
          selected
            ? "border-accent bg-accent text-[var(--color-btn-main-fg)] opacity-100"
            : `border-[color-mix(in_srgb,var(--color-ink)_40%,transparent)] bg-black/40 ${selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`
        }`}
      >
        {selected && <IconCheck className="h-4 w-4" />}
      </button>
    </li>
  );
}

function SelectionBar({
  ids,
  examples,
  rules,
  onClear,
  onDelete,
  onMoved,
}: {
  ids: string[];
  examples: Example[];
  rules: RuleRef[];
  onClear: () => void;
  onDelete: () => void;
  onMoved: () => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = examples.filter((e) => ids.includes(e.id));
  const edges = [...new Set(chosen.map((e) => e.edgeId))];
  const targets = edges.length === 1 ? rules.filter((r) => r.edgeId === edges[0]) : [];

  async function moveTo(r: RuleRef) {
    setMenu(false);
    setBusy(true);
    const moving = chosen.filter((e) => e.item_key !== r.rule.item_key);
    let done = 0;
    let failed = "";
    for (const e of moving) {
      try {
        const res = await fetch(`/api/evidence/${e.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemKey: r.rule.item_key }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          failed = d.error || "We could not move that example.";
          break;
        }
        done++;
      } catch {
        failed = "We could not move that example. Check your connection and try again.";
        break;
      }
    }
    setBusy(false);
    if (done > 0) toast.success(`${done} example${done === 1 ? "" : "s"} moved. Check what Edge read for the new rule.`);
    if (failed) toast.error(failed);
    await onMoved();
  }

  return (
    <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="relative flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel p-2 pl-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]">
        <span className="mr-1 text-sm font-medium tabular-nums">{ids.length} selected</span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || targets.length === 0}
          title={targets.length === 0 ? "Select examples from one checklist to move them" : undefined}
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
        >
          <IconArrowRight /> {busy ? "Moving…" : "Move to rule"}
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onDelete}>
          <IconTrash /> Delete
        </button>
        <button type="button" className="px-2 text-sm text-muted hover:text-ink" onClick={onClear}>
          Clear
        </button>
        {menu && (
          <div role="menu" className="absolute bottom-full left-0 mb-2 max-h-[320px] w-[min(380px,90vw)] overflow-y-auto rounded-2xl border border-line bg-panel p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
            <p className="px-3 pt-2 pb-1 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted">Move to</p>
            {targets.map((r) => {
              const incoming = chosen.filter((e) => e.item_key !== r.rule.item_key).length;
              const full = r.count + incoming > MAX;
              return (
                <button
                  key={r.key}
                  type="button"
                  role="menuitem"
                  disabled={full || incoming === 0}
                  onClick={() => void moveTo(r)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-track disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="min-w-0 flex-1">{r.rule.text}</span>
                  <span className={`shrink-0 text-xs tabular-nums ${full ? "text-fail" : "text-muted"}`}>
                    {full ? "Full" : `${r.count} of ${MAX}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ dialogs ---- */

function ModalShell({
  labelledBy,
  onClose,
  width = "max-w-[560px]",
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`relative max-h-[94dvh] w-full ${width} overflow-y-auto rounded-t-[20px] border border-line bg-[linear-gradient(180deg,var(--color-card-a),var(--color-card-b))] p-5 text-ink shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)] outline-none sm:rounded-[20px] sm:p-7`}
      >
        {children}
      </div>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="icon-btn shrink-0" onClick={onClose} aria-label="Close">
      <IconX />
    </button>
  );
}

type ZoneError = { title: string; body: string; code: string };

const ZONE_ERRORS: Record<string, Omit<ZoneError, "code">> = {
  too_large: { title: "This file is too large", body: "The limit is 10 MB. Try a smaller screenshot." },
  file_type: { title: "This file type is not supported", body: "Use a PNG or JPG screenshot of your chart." },
  too_small: { title: "This image is too small", body: "Use a screenshot at least 400 × 250 so the candles are readable." },
  unreadable: { title: "We could not read this chart", body: "Try a clearer screenshot with the price axis and time visible." },
  sensitive: { title: "We found what looks like an account number", body: "Hide it before Edge reads the chart, or choose another file." },
};

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

type Box = { x: number; y: number; w: number; h: number };

/** Paint the boxes black on a copy of the image, so the hidden part never leaves the browser. */
async function paintOver(src: string, boxes: Box[], name: string): Promise<File> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = "#000";
  for (const b of boxes) ctx.fillRect(b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!blob) throw new Error("Could not prepare the image.");
  return new File([blob], name.replace(/\.[a-z]+$/i, "") + "-hidden.png", { type: "image/png" });
}

function AddDialog({
  rules,
  initialRule,
  onClose,
  onManage,
  onAdded,
}: {
  rules: RuleRef[];
  initialRule?: string;
  onClose: () => void;
  onManage: (key: string) => void;
  onAdded: (id: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ruleKey, setRuleKey] = useState(initialRule && rules.some((r) => r.key === initialRule) ? initialRule : "");
  const [polarity, setPolarity] = useState<"valid" | "invalid" | null>(null);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [zone, setZone] = useState<ZoneError | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [hiding, setHiding] = useState(false);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const voice = useVoiceNote((t) => setNote((p) => (p.trim() ? p.trimEnd() + " " : "") + t));
  const target = rules.find((r) => r.key === ruleKey);
  const full = Boolean(target && target.count >= MAX);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = useCallback((f: File | null | undefined) => {
    setError("");
    setHiding(false);
    setBoxes([]);
    if (!f) return;
    if (!TYPES.includes(f.type)) {
      setFile(null);
      setPreview(null);
      return setZone({ code: "file_type", ...ZONE_ERRORS.file_type });
    }
    if (f.size > MAX_BYTES) {
      setFile(null);
      setPreview(null);
      return setZone({ code: "too_large", ...ZONE_ERRORS.too_large });
    }
    setZone(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (f) pick(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pick]);

  async function submit() {
    if (!file || !target || !polarity || full) return;
    let toSend = file;
    if (hiding) {
      if (boxes.length === 0 || !preview) return;
      try {
        toSend = await paintOver(preview, boxes, file.name);
      } catch {
        return setError("We could not hide that part of the image. Choose another file.");
      }
    }
    setReading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("edgeId", target.edgeId);
      fd.append("itemKey", target.rule.item_key);
      fd.append("polarity", polarity);
      if (note.trim()) fd.append("note", note.trim());
      if (hiding) fd.append("hidden", "1");
      fd.append("file", toSend);
      const res = await fetch("/api/evidence", { method: "POST", body: fd });
      if (res.status === 401) return handleSessionExpired();
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d.code && ZONE_ERRORS[d.code]) {
          setZone({ code: d.code, ...ZONE_ERRORS[d.code] });
          if (d.code !== "sensitive") {
            setFile(null);
            setPreview(null);
          }
          return;
        }
        throw new Error(d.error || "We could not add that example. Try again.");
      }
      await onAdded(d.image.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not add that example. Try again.");
    } finally {
      setReading(false);
    }
  }

  const sensitive = zone?.code === "sensitive";
  const ruleOptions = rules.map((r) => ({
    value: r.key,
    label: r.rule.text,
    sublabel: `${new Set(rules.map((x) => x.edgeId)).size > 1 ? r.listName + " · " : ""}${r.count} of ${MAX}`,
  }));

  return (
    <ModalShell labelledBy="add-title" onClose={reading ? () => {} : onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="add-title" className="text-xl font-medium">Add an example</h2>
          <p className="mt-1 text-sm text-ink/70">Show Edge one chart for a rule, and say if it is good or bad.</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      {/* drop zone / preview / errors */}
      <div className="mt-5">
        {file && preview && !(zone && !sensitive) ? (
          hiding ? (
            <HideBoxes src={preview} boxes={boxes} onChange={setBoxes} />
          ) : (
            <div className={`relative overflow-hidden rounded-2xl border ${sensitive ? "border-fail" : "border-line"} bg-panel`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Chart to add" className={`max-h-[220px] w-full object-contain ${reading ? "opacity-40" : ""}`} />
              <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface/90 px-2.5 py-1 text-xs text-ink/85 backdrop-blur-xs">
                <IconImages className="h-3.5 w-3.5" /> {file.name} · {formatBytes(file.size)}
              </span>
              {reading && (
                <span className="absolute inset-0 grid place-items-center">
                  <span className="flex items-center gap-2 rounded-full bg-surface/90 px-4 py-2 text-sm backdrop-blur-xs" role="status">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true" />
                    Edge is reading your chart
                  </span>
                </span>
              )}
              {!reading && !sensitive && (
                <button type="button" className="absolute top-3 right-3 btn btn-sm" onClick={() => input.current?.click()}>
                  Change
                </button>
              )}
            </div>
          )
        ) : (
          <div
            className={`flex flex-col items-center rounded-2xl border border-dashed px-6 py-7 text-center ${
              zone ? "border-fail bg-err-bg" : "border-[color-mix(in_srgb,var(--color-ink)_30%,transparent)]"
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0]);
            }}
          >
            <span className={`grid h-10 w-10 place-items-center rounded-xl border ${zone ? "border-fail text-fail" : "border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-pass-bg text-accent"}`}>
              {zone ? <IconImages className="h-5 w-5" /> : <IconUpload />}
            </span>
            <p className="mt-3 font-medium">{zone ? zone.title : "Drop a chart screenshot here"}</p>
            <p className="mt-1 text-sm text-ink/70">{zone ? zone.body : "or browse your files. PNG or JPG, up to 10 MB. You can also paste it."}</p>
            <button type="button" className="btn btn-sm mt-4" onClick={() => input.current?.click()}>
              {zone ? "Upload another" : "Browse files"}
            </button>
          </div>
        )}
        {sensitive && !hiding && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--color-fail)_40%,transparent)] bg-err-bg px-4 py-3 text-sm">
            <p className="min-w-0 flex-1">
              <span className="font-medium text-fail">{ZONE_ERRORS.sensitive.title}.</span>{" "}
              <span className="text-ink/80">{ZONE_ERRORS.sensitive.body} Nothing was saved.</span>
            </p>
            <button type="button" className="btn btn-sm" onClick={() => input.current?.click()}>
              Choose another file
            </button>
          </div>
        )}
        {hiding && <p className="mt-2 text-sm text-ink/75">Drag over the account number to cover it. Add as many boxes as you need.</p>}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {/* rule */}
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <span id="add-rule" className="text-sm font-medium">Rule</span>
          {target && (
            <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${full ? "bg-err-bg text-fail" : "bg-track text-muted"}`}>
              {target.count} of {MAX}
            </span>
          )}
        </div>
        <Dropdown value={ruleKey} onChange={setRuleKey} options={ruleOptions} placeholder="Choose a rule" ariaLabel="Rule" disabled={reading} />
        {full && target && (
          <div role="alert" className="mt-3 flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--color-fail)_40%,transparent)] bg-err-bg px-4 py-3 text-sm">
            <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-fail" />
            <p className="min-w-0 flex-1 text-ink/85">This rule already has 6 examples. Remove one to add another, or choose a different rule.</p>
            <button type="button" className="shrink-0 font-medium text-accent hover:underline" onClick={() => onManage(target.key)}>
              Manage
            </button>
          </div>
        )}
      </div>

      {/* good or bad */}
      <fieldset className="mt-5" disabled={reading}>
        <legend className="mb-2 text-sm font-medium">Does the chart follow the rule?</legend>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["valid", "Good example", "The chart follows the rule."],
              ["invalid", "Bad example", "The chart breaks the rule."],
            ] as const
          ).map(([p, title, sub]) => (
            <button
              key={p}
              type="button"
              aria-pressed={polarity === p}
              onClick={() => setPolarity(p)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                polarity === p
                  ? p === "valid"
                    ? "border-pass bg-pass-bg"
                    : "border-fail bg-err-bg"
                  : "border-line hover:border-[color-mix(in_srgb,var(--color-ink)_30%,transparent)]"
              }`}
            >
              <span className={`flex items-center gap-2 font-medium ${polarity === p ? (p === "valid" ? "text-pass" : "text-fail") : ""}`}>
                {p === "valid" ? <IconCheckCircle className="h-4 w-4" /> : <IconXCircle className="h-4 w-4" />} {title}
              </span>
              <span className="mt-0.5 block text-xs text-ink/65">{sub}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* optional note */}
      <div className="mt-4">
        {showNote ? (
          <>
            <label htmlFor="add-note" className="mb-2 block text-sm font-medium">
              Note for Edge <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="add-note"
              className="input min-h-[70px] resize-y"
              placeholder="e.g. Price tags the 20 EMA and closes back above it"
              value={note}
              maxLength={1000}
              disabled={reading}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {voice.state === "recording" ? (
                <>
                  <span className="rec-dot" aria-hidden="true" />
                  <span className="font-mono text-sm tabular-nums">
                    {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, "0")}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={voice.cancel}>Discard</button>
                  <button type="button" className="btn btn-main btn-sm" onClick={voice.stop}>Done</button>
                </>
              ) : (
                <button type="button" className="speak-btn" onClick={voice.start} disabled={!voice.supported || voice.state !== "idle" || reading}>
                  <IconMic /> {voice.state === "transcribing" ? "Transcribing…" : "Speak a note"}
                </button>
              )}
              {voice.error && <span className="text-sm text-maybe">{voice.error}</span>}
            </div>
          </>
        ) : (
          <button type="button" className="text-sm text-accent hover:underline" onClick={() => setShowNote(true)}>
            + Add a note for Edge (optional)
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-fail">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button type="button" className="btn" onClick={onClose} disabled={reading}>
          Cancel
        </button>
        {sensitive ? (
          <button
            type="button"
            className="btn btn-main"
            disabled={reading || (hiding && boxes.length === 0) || !target || !polarity || full}
            onClick={() => (hiding ? void submit() : setHiding(true))}
          >
            {reading ? "Reading chart…" : hiding ? "Add with this hidden" : "Hide it and continue"}
          </button>
        ) : (
          <button type="button" className="btn btn-main" disabled={!file || !target || !polarity || full || reading} onClick={() => void submit()}>
            {reading ? "Reading chart…" : "Add example"}
          </button>
        )}
      </div>
    </ModalShell>
  );
}

/** Let the trader drag boxes over private details on the image (Figma 74). */
function HideBoxes({ src, boxes, onChange }: { src: string; boxes: Box[]; onChange: (b: Box[]) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const at = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  return (
    <div>
      <div
        ref={area}
        className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-2xl border border-accent"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = at(e);
          setDraft({ ...start.current, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const p = at(e);
          const s = start.current;
          setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
        }}
        onPointerUp={() => {
          if (draft && draft.w > 0.01 && draft.h > 0.01) onChange([...boxes, draft]);
          start.current = null;
          setDraft(null);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Chart: drag over the private details to hide them" className="block w-full" draggable={false} />
        {[...boxes, ...(draft ? [draft] : [])].map((b, i) => (
          <span
            key={i}
            className="absolute bg-black"
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
          />
        ))}
      </div>
      {boxes.length > 0 && (
        <button type="button" className="mt-2 text-sm text-muted hover:text-ink" onClick={() => onChange(boxes.slice(0, -1))}>
          Undo last box
        </button>
      )}
    </div>
  );
}

function DetailDialog({
  ex,
  onClose,
  onChanged,
  onDelete,
}: {
  ex: Example;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDelete: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [text, setText] = useState(ex.interpretation_text ?? "");
  const [busy, setBusy] = useState<"" | "confirm" | "polarity" | "save">("");
  const [error, setError] = useState("");
  const r = ex.reading;

  async function patch(body: Record<string, unknown>, kind: "confirm" | "polarity" | "save") {
    setBusy(kind);
    setError("");
    try {
      const res = await fetch(`/api/evidence/${ex.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) return handleSessionExpired();
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "We could not save that. Try again.");
      setCorrecting(false);
      await onChanged();
      if (kind === "confirm" || kind === "save") toast.success(kind === "save" ? "Correction saved." : "Reading confirmed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not save that. Try again.");
    } finally {
      setBusy("");
    }
  }

  const rows: Array<{ label: string; value: string }> = ex.corrected
    ? [{ label: "Your reading", value: ex.interpretation_text ?? "" }]
    : [
        { label: "On the chart", value: r?.reading ?? ex.interpretation_text ?? "" },
        { label: "Result", value: `${ex.polarity === "valid" ? "Follows this rule" : "Breaks this rule"}${r?.why ? `. ${r.why}` : ""}` },
        ...(r?.market_condition ? [{ label: "Market", value: r.market_condition }] : []),
      ];
  const RowIcon = ex.confirmed ? IconCheckCircle : IconAlertCircle;

  return (
    <ModalShell labelledBy="detail-title" onClose={onClose} width="max-w-[980px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <PolarityTag polarity={ex.polarity} />
          <span className="text-sm text-muted">{metaLine(ex, "Added ")}</span>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <div className="mt-5 grid gap-6 md:grid-cols-[1.35fr_1fr]">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/evidence/${ex.id}/file`} alt={`${ex.polarity === "valid" ? "Good" : "Bad"} example chart for ${ex.rule.text}`} className="w-full rounded-2xl border border-line bg-surface object-contain" />
          <p className="mt-3 text-sm text-muted">This is what Edge read. Correct anything that looks wrong.</p>
        </div>

        <div className="flex flex-col">
          <h2 id="detail-title" className="text-xl font-medium leading-snug">{ex.rule.text}</h2>
          <div role="group" aria-label="Good or bad example" className="mt-4 inline-flex w-fit rounded-xl border border-line p-1">
            {(["valid", "invalid"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={ex.polarity === p}
                disabled={busy !== ""}
                onClick={() => p !== ex.polarity && void patch({ polarity: p }, "polarity")}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm transition-colors ${
                  ex.polarity === p
                    ? p === "valid"
                      ? "bg-pass-bg text-pass ring-1 ring-[color-mix(in_srgb,var(--color-pass)_45%,transparent)]"
                      : "bg-err-bg text-fail ring-1 ring-[color-mix(in_srgb,var(--color-fail)_45%,transparent)]"
                    : "text-ink/75 hover:text-ink"
                }`}
              >
                {p === "valid" ? <IconCheckCircle className="h-4 w-4" /> : <IconXCircle className="h-4 w-4" />}
                {p === "valid" ? "Good" : "Bad"}
              </button>
            ))}
          </div>
          {busy === "polarity" && <p className="mt-2 text-sm text-muted" role="status">Edge is reading the chart again…</p>}

          <p className="mt-6 text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted">What Edge read</p>
          {correcting ? (
            <div className="mt-3">
              <label htmlFor="correct-text" className="mb-2 block text-sm font-medium">Correct the reading</label>
              <textarea
                id="correct-text"
                className="input min-h-[120px] resize-y"
                value={text}
                maxLength={1000}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="mt-2 text-xs text-muted">Say what the chart really shows for this rule. Edge uses your words from now on.</p>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {rows.map((row) => (
                <li key={row.label} className="flex items-start gap-3 py-3">
                  <RowIcon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${ex.confirmed ? "text-pass" : "text-maybe"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted">{row.label}</p>
                    <p className="mt-0.5 text-[0.95rem] leading-relaxed">{row.value}</p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn h-8 w-8 shrink-0"
                    aria-label={`Correct: ${row.label}`}
                    disabled={busy !== ""}
                    onClick={() => {
                      setText(ex.interpretation_text ?? "");
                      setCorrecting(true);
                    }}
                  >
                    <IconPencil />
                  </button>
                </li>
              ))}
              {ex.trader_note && (
                <li className="py-3">
                  <p className="text-xs text-muted">Your note</p>
                  <p className="mt-0.5 text-sm text-ink/85">{ex.trader_note}</p>
                </li>
              )}
            </ul>
          )}

          {r?.sensitive_info && (
            <p className="mt-3 rounded-xl bg-err-bg px-3 py-2 text-sm text-fail">
              Account details may still be visible. Delete this example and add a cropped screenshot.
            </p>
          )}
          {r?.low_confidence && (
            <p className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-sm text-maybe">
              Edge is not sure about this one{r.problem ? `: ${r.problem}` : "."} A clearer screenshot helps.
            </p>
          )}
          {r?.label_mismatch && (
            <p className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-sm text-maybe">
              This chart may not match your label{r.problem ? `: ${r.problem}` : "."} You decide; check Good or Bad.
            </p>
          )}
          {ex.confirmed && !correcting && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-pass">
              <IconCheck className="h-4 w-4" /> Reading confirmed. Edge uses this example when it checks your trades.
            </p>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-fail">{error}</p>}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button type="button" className="btn btn-danger btn-sm" disabled={busy !== ""} onClick={onDelete}>
          <IconTrash /> Delete
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          {correcting ? (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setCorrecting(false)} disabled={busy !== ""}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-main btn-sm"
                disabled={busy !== "" || !text.trim()}
                onClick={() => void patch({ action: "confirm", text }, "save")}
              >
                {busy === "save" ? "Saving…" : "Save correction"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy !== ""}
                onClick={() => {
                  setText(ex.interpretation_text ?? "");
                  setCorrecting(true);
                }}
              >
                <IconPencil /> Correct reading
              </button>
              {!ex.confirmed && (
                <button type="button" className="btn btn-main btn-sm" disabled={busy !== ""} onClick={() => void patch({ action: "confirm" }, "confirm")}>
                  <IconCheck className="h-4 w-4" /> {busy === "confirm" ? "Confirming…" : "Confirm reading"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function DeleteDialog({
  ids,
  examples,
  onClose,
  onDeleted,
}: {
  ids: string[];
  examples: Example[];
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const one = ids.length === 1 ? examples.find((e) => e.id === ids[0]) : undefined;

  async function run() {
    setBusy(true);
    setError("");
    try {
      for (const id of ids) {
        const res = await fetch(`/api/evidence/${id}`, { method: "DELETE" });
        if (res.status === 401) return handleSessionExpired();
        if (!res.ok) throw new Error();
      }
      await onDeleted();
    } catch {
      setError("We could not delete that. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <ModalShell labelledBy="del-title" onClose={busy ? () => {} : onClose} width="max-w-[460px]">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-err-bg text-fail">
        <IconTrash className="h-5 w-5" />
      </span>
      <h2 id="del-title" className="mt-4 text-xl font-medium">
        {one ? "Delete this example?" : `Delete ${ids.length} examples?`}
      </h2>
      <p className="mt-2 text-sm text-ink/75">
        {one
          ? `Edge will stop using this chart to read “${one.rule.text}”. This cannot be undone.`
          : "Edge will stop using these charts to read your rules. This cannot be undone."}
      </p>
      {error && <p role="alert" className="mt-3 text-sm text-fail">{error}</p>}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Keep {one ? "it" : "them"}
        </button>
        <button type="button" className="btn btn-danger" onClick={() => void run()} disabled={busy}>
          {busy ? "Deleting…" : one ? "Delete example" : "Delete examples"}
        </button>
      </div>
    </ModalShell>
  );
}
