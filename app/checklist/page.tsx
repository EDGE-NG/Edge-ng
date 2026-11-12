"use client";

/**
 * Checklist: the first screen after sign-in (PRD 4.1, F2).
 *
 * - No checklist yet: the chat box is the page. Type or speak the plan; Edge
 *   drafts a checklist in the conversation; the trader edits and approves it.
 * - Has checklists: they are listed, with "Create new checklist" top right,
 *   which opens the chat box again.
 *
 * URLs: /checklist (list, or chat box if none), /checklist?new=1 (chat box),
 * /checklist?c=<chatId> (one checklist's conversation).
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import EdgeMark from "../_components/edge-mark";
import ChecklistCard from "./checklist-card";
import Composer, { type ComposerHandle } from "./composer";
import { IconCheck, IconMenu, IconMic, IconPlus, IconRetry } from "./icons";
import Sidebar from "./sidebar";
import { PURPOSE_LABEL, type ChatSummaryWithEdge, type ChatView, type Message, type Rule } from "./types";

const EXAMPLES = [
  {
    label: "London pullbacks on EURUSD",
    text:
      "I trade EURUSD in the London session only. I buy when the 4H trend is up and price pulls back to the 20 EMA, then I wait for a bullish engulfing candle on the 15m. My stop goes below the swing low, I never risk more than 1% and I need at least 1:2 risk to reward.",
  },
  {
    label: "Asian range breakouts",
    text:
      "I trade breakouts of the Asian range on GBPJPY. I enter when a 15m candle closes outside the range, never within 30 minutes of red-folder news. Stop goes on the other side of the range and I take max 2 trades a day.",
  },
  {
    label: "NAS100 daily swings",
    text:
      "Swing trades on NAS100 with the daily trend. I buy pullbacks to the 50 SMA when RSI is above 40 and skip Fridays. Risk 0.5% per trade, stop under the last higher low.",
  },
];

const THINKING = ["Reading your plan…", "Pulling out your rules…", "Checking each rule against your words…"];

/** `hour` is read in the browser after load (never during prerender). */
function greeting(name: string | null | undefined, hour: number | null) {
  const part =
    hour == null ? "Welcome" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = name?.trim().split(/\s+/)[0];
  return { part, first };
}

export default function ChecklistPage() {
  const router = useRouter();
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const [user, setUser] = useState<{ name: string | null; email: string } | null>(null);
  const [chats, setChats] = useState<ChatSummaryWithEdge[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [hour, setHour] = useState<number | null>(null);
  const [view, setView] = useState<ChatView | null>(null);
  const [pending, setPending] = useState<Message[]>([]);
  const [thinking, setThinking] = useState(false);
  const [thinkIdx, setThinkIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sideOpen, setSideOpen] = useState(false);

  const unauthorized = useCallback(async () => {
    // stale cookie: clear it so /login doesn't bounce back here
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }, [router]);

  const refreshChats = useCallback(async () => {
    const res = await fetch("/api/chats");
    if (res.status === 401) return unauthorized();
    const d = await res.json();
    setUser(d.user);
    setChats(d.chats ?? []);
  }, [unauthorized]);

  const openChat = useCallback(
    async (id: string) => {
      setError("");
      setSideOpen(false);
      const res = await fetch(`/api/chats/${id}`);
      if (res.status === 401) return unauthorized();
      if (!res.ok) {
        setActiveId(null);
        setView(null);
        window.history.replaceState(null, "", "/checklist");
        return;
      }
      setView(await res.json());
      setActiveId(id);
      setComposing(false);
      setPending([]);
      window.history.replaceState(null, "", `/checklist?c=${id}`);
    },
    [unauthorized]
  );

  useEffect(() => {
    (async () => {
      await refreshChats();
      setHour(new Date().getHours());
      const q = new URLSearchParams(window.location.search);
      const c = q.get("c");
      if (c) await openChat(c);
      else if (q.get("new")) setComposing(true);
      setLoading(false);
    })();
  }, [refreshChats, openChat]);

  useEffect(() => {
    if (!thinking) return;
    const t = setInterval(() => setThinkIdx((i) => Math.min(i + 1, THINKING.length - 1)), 1800);
    return () => clearInterval(t);
  }, [thinking]);

  const messages = [...(view?.messages ?? []), ...pending];
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, thinking]);

  function leaveChat() {
    setActiveId(null);
    setView(null);
    setPending([]);
    setError("");
    setSideOpen(false);
  }

  /** "Create new checklist": open the chat box. */
  function createNew() {
    leaveChat();
    setComposing(true);
    window.history.replaceState(null, "", "/checklist?new=1");
    requestAnimationFrame(() => composer.current?.focus());
  }

  /** Sidebar "Checklist": the list, or the chat box when there is none yet. */
  function goToChecklists() {
    leaveChat();
    setComposing(false);
    window.history.replaceState(null, "", "/checklist");
    void refreshChats();
  }

  async function send(text: string, viaVoice: boolean, retry = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    if (!retry) {
      setPending([
        {
          id: "pending",
          role: "trader",
          kind: "text",
          content: text,
          payload: null,
          via_voice: viaVoice,
          created_at: new Date().toISOString(),
          pending: true,
        },
      ]);
    }
    setThinkIdx(0);
    setThinking(true);
    try {
      let id = activeId;
      if (!id) {
        const res = await fetch("/api/chats", { method: "POST" });
        if (res.status === 401) return unauthorized();
        const d = await res.json();
        id = d.chat.id as string;
        setActiveId(id);
        setComposing(false);
        window.history.replaceState(null, "", `/checklist?c=${id}`);
      }
      const res = await fetch(`/api/chats/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retry ? { retry: true } : { content: text, viaVoice }),
      });
      if (res.status === 401) return unauthorized();
      const d = await res.json().catch(() => ({}));
      if (d.chat) {
        setView(d as ChatView); // includes the error reply on a 502 (input is saved)
      } else {
        setError(d.error || "Something went wrong. Try again.");
        if (!retry) composer.current?.setText(text); // never lose what they wrote
      }
      void refreshChats();
    } catch {
      setError("You seem to be offline. Your message wasn't sent.");
      if (!retry) composer.current?.setText(text);
    } finally {
      setPending([]);
      setThinking(false);
      setBusy(false);
    }
  }

  async function saveDraft(items: Rule[]) {
    if (!activeId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/chats/${activeId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't save that change.");
      setView(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that change.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!activeId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/chats/${activeId}/approve`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't approve the checklist.");
      setView(d);
      void refreshChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't approve the checklist.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const checklists = chats.filter((c) => c.edge_id);
  const hasChecklist = checklists.length > 0;
  // which screen: one checklist's conversation, the chat box, or the list
  const mode: "loading" | "chat" | "compose" | "list" = loading
    ? "loading"
    : activeId || pending.length
      ? "chat"
      : composing || !hasChecklist
        ? "compose"
        : "list";
  const lastChecklistId = [...messages].reverse().find((m) => m.kind === "checklist")?.id;
  const { part, first } = greeting(user?.name, hour);

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        user={user}
        open={sideOpen}
        onClose={() => setSideOpen(false)}
        onChecklist={goToChecklists}
        onSignOut={signOut}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
          <button type="button" className="icon-btn border-transparent md:hidden" onClick={() => setSideOpen(true)} aria-label="Open menu">
            <IconMenu />
          </button>
          {mode === "list" ? (
            <h1 className="truncate text-[1.05rem] font-medium tracking-[-0.02em]">Your checklists</h1>
          ) : (
            <>
              {/* PR-CH-5: every conversation states its purpose */}
              <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-ink/75">
                <span className="h-1.5 w-1.5 rounded-full bg-[#dcff3c]" aria-hidden="true" />
                {PURPOSE_LABEL[view?.chat.purpose ?? "build_edge"]}
              </span>
              <h1 className="min-w-0 truncate text-[0.95rem] font-normal tracking-normal text-ink">
                {view?.draft?.edgeName || view?.chat.title || (mode === "compose" ? "New checklist" : "")}
              </h1>
            </>
          )}
          {hasChecklist && mode !== "compose" && mode !== "loading" && (
            <button type="button" onClick={createNew} className="btn btn-sm ml-auto shrink-0 gap-2 border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-4">
              <IconPlus className="h-4 w-4 text-accent" />
              <span>Create new checklist</span>
            </button>
          )}
        </header>

        {mode === "loading" ? (
          <main className="grid flex-1 place-items-center text-sm text-muted">Loading…</main>
        ) : mode === "list" ? (
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[920px] px-4 py-8 sm:px-6">
              <p className="mb-6 text-ink/75">
                Open a checklist to review it, change it, or answer Edge&apos;s questions.
              </p>
              <ul className="grid gap-4 sm:grid-cols-2">
                {checklists.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openChat(c.id)}
                      className="card block h-full w-full text-left transition-transform hover:-translate-y-0.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="text-[1.1rem] font-medium leading-snug tracking-[-0.02em]">
                          {c.edge_name || c.title || "My edge"}
                        </h2>
                        {c.approved_version ? (
                          <span className="tag tag-pass shrink-0">
                            <IconCheck className="h-3.5 w-3.5" /> Approved · v{c.approved_version}
                          </span>
                        ) : (
                          <span className="tag tag-maybe shrink-0">Draft</span>
                        )}
                      </div>
                      <p className="mt-3 text-sm text-ink/75">
                        {c.rule_count ?? 0} rule{c.rule_count === 1 ? "" : "s"} · {c.hard_count ?? 0} hard gate
                        {c.hard_count === 1 ? "" : "s"}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Updated {new Date(c.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </main>
        ) : mode === "compose" ? (
          <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-10 sm:px-6">
            <div className="w-full max-w-[720px] fade-up">
              <div className="mb-8 flex flex-col items-center text-center">
                <span className="mb-6 grid h-16 w-16 place-items-center rounded-[20px] border border-[rgba(220,255,60,.35)] bg-[linear-gradient(135deg,rgba(220,255,60,.12),rgba(220,255,60,0))] shadow-[0_0_40px_-8px_rgba(220,255,60,.35)]">
                  <EdgeMark className="h-8 w-10" />
                </span>
                <h2 className="text-[clamp(1.9rem,4.4vw,2.7rem)] leading-tight font-light tracking-[-0.045em]">
                  {part}
                  {first ? (
                    <>
                      , <span className="text-accent">{first}</span>
                    </>
                  ) : null}
                  .
                </h2>
                <p className="mt-2 text-muted">What&apos;s your edge?</p>
              </div>

              {/* PR-CH-2: purpose banner above the input */}
              <div className="mb-3 flex items-start gap-3 rounded-2xl border border-[rgba(94,240,136,.25)] bg-[rgba(94,240,136,.06)] px-4 py-3 text-sm">
                <span className="mt-0.5 text-accent">
                  <IconMic className="h-4 w-4" />
                </span>
                <p className="text-ink/90">
                  <strong className="font-medium text-ink">Tell Edge your trading plan.</strong> Type it or
                  speak it. Edge turns it into a checklist you approve.
                </p>
              </div>

              <Composer
                ref={composer}
                onSend={(t, v) => send(t, v)}
                disabled={busy}
                autoFocus
                placeholder="e.g. I only buy when the 4H trend is up and price pulls back to the 20 EMA…"
              />
              {error && <p role="alert" className="mt-3 px-2 text-sm text-fail">{error}</p>}

              <div className="mt-5">
                <p className="mb-2.5 px-1 text-sm text-ink/70">Not sure how to start? Try one:</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button key={ex.label} type="button" className="chip-btn" onClick={() => composer.current?.setText(ex.text)}>
                      {ex.label}
                    </button>
                  ))}
                </div>
              </div>

              <ol className="mt-10 grid gap-4 border-t border-line pt-6 text-sm sm:grid-cols-3">
                {[
                  ["1", "Describe", "Type or speak your plan in your own words."],
                  ["2", "Approve", "Edge drafts the rules and asks about anything vague. You decide."],
                  ["3", "Teach", "Show Edge 1 to 6 chart examples per rule."],
                ].map(([n, t, d]) => (
                  <li key={n} className="border-t border-transparent">
                    <span className="text-xs text-accent">Step {n}</span>
                    <p className="mt-1 font-medium">{t}</p>
                    <p className="mt-0.5 text-muted">{d}</p>
                  </li>
                ))}
              </ol>
            </div>
          </main>
        ) : (
          <>
            <div ref={scroller} className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[760px] space-y-7 px-4 py-8 sm:px-6" aria-live="polite">
                {messages.map((m) =>
                  m.role === "trader" ? (
                    <div key={m.id} className="flex justify-end fade-up">
                      <div className="max-w-[85%]">
                        {m.via_voice && (
                          <p className="mb-1 flex items-center justify-end gap-1.5 text-xs text-muted">
                            <IconMic className="h-3.5 w-3.5" /> Voice note
                          </p>
                        )}
                        <div className="rounded-[20px] rounded-br-md border border-line bg-panel px-4 py-3 text-[0.97rem] leading-relaxed whitespace-pre-wrap">
                          {m.content}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex gap-3.5 fade-up">
                      <EdgeMark className="mt-1 h-6 w-7 shrink-0" />
                      <div className="min-w-0 flex-1">
                        {m.kind === "error" ? (
                          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--color-maybe)_40%,transparent)] bg-warn-bg px-4 py-3 text-sm">
                            <p className="text-ink">{m.content}</p>
                            {m.id === messages[messages.length - 1]?.id && (
                              <button
                                type="button"
                                className="btn btn-sm mt-3"
                                disabled={busy}
                                onClick={() => send("", false, true)}
                              >
                                <IconRetry /> Try again
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="text-[0.97rem] leading-relaxed whitespace-pre-wrap text-ink">{m.content}</p>
                        )}
                        {m.kind === "checklist" && m.payload &&
                          (m.id === lastChecklistId && view?.draft ? (
                            <ChecklistCard
                              mode="live"
                              draft={view.draft}
                              questions={view.openQuestions}
                              busy={busy}
                              onSave={saveDraft}
                              onApprove={approve}
                              onAnswer={(q) => composer.current?.setText(`About "${q}": `)}
                              onJudgmentCall={(q) =>
                                send(`About "${q}": that's a judgment call. I'll confirm it myself at the gate.`, false)
                              }
                            />
                          ) : (
                            <ChecklistCard mode="snapshot" rules={m.payload.rules} versionNumber={m.payload.versionNumber} />
                          ))}
                      </div>
                    </div>
                  )
                )}
                {thinking && (
                  <div className="flex items-center gap-3.5 fade-up" role="status">
                    <EdgeMark className="h-6 w-7 shrink-0" />
                    <span className="typing" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="text-sm text-muted">{THINKING[thinkIdx]}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 px-4 pb-4 sm:px-6">
              <div className="mx-auto w-full max-w-[760px]">
                {error && <p role="alert" className="mb-2 px-2 text-sm text-fail">{error}</p>}
                <Composer
                  ref={composer}
                  onSend={(t, v) => send(t, v)}
                  disabled={busy}
                  placeholder={view?.draft ? "Answer a question, or ask for a change (e.g. “make rule 2 a hard gate”)" : "Describe your trading plan…"}
                />
                <p className="mt-2 text-center text-xs text-ink/60">
                  Edge turns your words into rules. It never predicts markets or gives signals.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
