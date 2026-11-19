"use client";

/**
 * Alerts: the trader picks markets for Edge to watch with an approved
 * checklist. When every hard-gate chart rule passes, Edge sends a browser /
 * phone notification and an email. The alert never approves a trade: the
 * trader checks it in the workspace, where the gate decides.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AppFrame from "../../_components/app-frame";
import Dropdown from "../../_components/dropdown";
import { IconBell, IconCheck, IconRetry, IconTrash, IconX } from "../../_components/icons";
import { toast } from "../../_components/toaster";
import { handleSessionExpired } from "@/lib/client-auth";

type RuleStatus = "pass" | "fail" | "inconclusive" | "unchecked";

interface RuleSummary {
  itemKey: string;
  text: string;
  hardGate: boolean;
  timeframe: string;
  status: RuleStatus;
  reasoning: string;
  checkedAt: string | null;
  confirmedExamples: number;
}

interface Summary {
  edgeName: string;
  versionNumber: number | null;
  lastPrice: number | null;
  watched: RuleSummary[];
  traderRules: string[];
  riskRules: string[];
  notes: string[];
}

interface Monitor {
  id: string;
  edgeId: string;
  edgeName: string | null;
  instrument: string;
  label: string;
  timeframe: string;
  status: "active" | "paused";
  state: "unknown" | "met" | "not_met";
  summary: Summary | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastAlertAt: string | null;
  error: string | null;
}

interface AlertEvent {
  id: string;
  monitorId: string | null;
  edgeId: string | null;
  instrument: string;
  label: string;
  timeframe: string;
  lastPrice: number | null;
  summary: Summary | null;
  deliveries: { push?: { sent: number; failed: number } | "off"; email?: "sent" | "failed" | "off" };
  createdAt: string;
  readAt: string | null;
}

interface AlertsData {
  monitors: Monitor[];
  events: AlertEvent[];
  checklists: Array<{ edgeId: string; name: string; versionNumber: number }>;
  instruments: Array<{ symbol: string; label: string; assetClass: string; ready: boolean }>;
  timeframes: string[];
  maxMonitors: number;
  prefs: { push: boolean; email: boolean };
  channels: {
    push: { configured: boolean; publicKey: string | null; devices: number };
    email: { configured: boolean; address: string };
  };
}

type DeviceState = "checking" | "unsupported" | "needs-install" | "denied" | "off" | "on";

const ASSET_LABEL: Record<string, string> = { crypto: "Crypto", forex: "Forex", metals: "Metals", indices: "Indices" };

/* ------------------------------------------------------------ helpers --- */

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function until(iso: string | null): string {
  if (!iso) return "";
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
  if (s <= 60) return "within a minute";
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`;
  return `at ${new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIosWithoutInstall(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function api<T>(url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (res.status === 401) {
    handleSessionExpired();
    return null;
  }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast.error(d.error || "Something went wrong. Try again.");
    return null;
  }
  return d as T;
}

function fetchAlerts(): Promise<AlertsData | null> {
  return api<AlertsData>("/api/alerts");
}

/** This browser's notification state. */
async function deviceState(): Promise<DeviceState> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return isIosWithoutInstall() ? "needs-install" : "unsupported";
    }
    if (Notification.permission === "denied") return "denied";
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "unsupported";
  }
}

/* ------------------------------------------------------- small pieces --- */

function RuleStatusBadge({ status }: { status: RuleStatus }) {
  // never colour alone: icon + text (WCAG 2.2 AA)
  if (status === "pass")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pass-bg px-2 py-0.5 text-xs font-medium text-pass">
        <IconCheck className="h-3.5 w-3.5" /> Pass
      </span>
    );
  if (status === "fail")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-err-bg px-2 py-0.5 text-xs font-medium text-fail">
        <IconX className="h-3.5 w-3.5" /> Fail
      </span>
    );
  if (status === "inconclusive")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-bg px-2 py-0.5 text-xs font-medium text-maybe">
        <IconRetry className="h-3.5 w-3.5" /> Can&apos;t tell
      </span>
    );
  return <span className="inline-flex shrink-0 items-center rounded-full bg-track px-2 py-0.5 text-xs text-muted">Not checked</span>;
}

function MonitorState({ m }: { m: Monitor }) {
  if (m.status === "paused")
    return <span className="rounded-full bg-track px-2.5 py-1 text-xs font-medium text-muted">Paused</span>;
  if (m.state === "met")
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-pass-bg px-2.5 py-1 text-xs font-medium text-pass">
        <IconCheck className="h-3.5 w-3.5" /> Chart rules pass
      </span>
    );
  if (m.state === "not_met") {
    const w = m.summary?.watched ?? [];
    const n = w.filter((r) => r.status === "pass").length;
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-track px-2.5 py-1 text-xs font-medium text-muted">
        <IconBell className="h-3.5 w-3.5" /> Watching · {n} of {w.length} pass
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-track px-2.5 py-1 text-xs font-medium text-muted">
      <IconRetry className="h-3.5 w-3.5" /> Waiting for the first check
    </span>
  );
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`inline-flex h-7 shrink-0 items-center gap-2 rounded-full border border-line px-1 pr-2.5 text-xs font-medium transition disabled:opacity-50 ${
        on ? "bg-pass-bg text-pass" : "bg-track text-muted"
      }`}
    >
      <span className={`h-5 w-5 rounded-full transition ${on ? "bg-pass" : "bg-muted/60"}`} aria-hidden />
      {on ? "On" : "Off"}
    </button>
  );
}

function RuleList({ summary }: { summary: Summary }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {summary.watched.map((r) => (
          <li key={r.itemKey} className="rounded-lg border border-line bg-panel p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-ink">{r.text}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {r.timeframe} chart{r.hardGate ? " · hard gate" : ""}
                  {r.checkedAt ? ` · checked ${ago(r.checkedAt)}` : ""}
                </p>
              </div>
              <RuleStatusBadge status={r.status} />
            </div>
            {r.reasoning && <p className="mt-2 text-xs leading-relaxed text-muted">{r.reasoning}</p>}
            {r.confirmedExamples === 0 && (
              <p className="mt-2 text-xs text-maybe">
                This rule has no confirmed chart example, so it can&apos;t pass.{" "}
                <Link href="/app/evidence" className="underline">
                  Add one in the Evidence library
                </Link>
                .
              </p>
            )}
          </li>
        ))}
      </ul>
      {(summary.traderRules.length > 0 || summary.riskRules.length > 0) && (
        <div className="rounded-lg border border-line bg-surface/40 p-3 text-xs text-muted">
          <p className="font-medium text-ink">Still yours to check when an alert comes in</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {summary.traderRules.map((t) => (
              <li key={t}>{t}</li>
            ))}
            {summary.riskRules.length > 0 && <li>Your risk rules, from the ticket when you press Buy or Sell.</li>}
          </ul>
        </div>
      )}
      {summary.notes.length > 0 && <p className="text-xs text-maybe">{summary.notes.join(" ")}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- view --- */

export default function AlertsView() {
  const router = useRouter();
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [device, setDevice] = useState<DeviceState>("checking");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focusEvent, setFocusEvent] = useState<string | null>(null);
  const [form, setForm] = useState({ edgeId: "", instrument: "", timeframe: "15m" });

  /** Apply a fresh load of the page data (state is only set from callbacks). */
  const apply = useCallback((d: AlertsData | null) => {
    if (d) {
      setData(d);
      setForm((f) => ({ ...f, edgeId: f.edgeId || d.checklists[0]?.edgeId || "" }));
      // opened from a notification: show that alert's rules
      setFocusEvent((prev) => prev ?? new URLSearchParams(window.location.search).get("event"));
    }
    setLoading(false);
  }, []);

  const load = useCallback(
    () =>
      fetchAlerts().then(apply, () => {
        toast.error("Network error: couldn't load your alerts.");
        setLoading(false);
      }),
    [apply]
  );

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      fetchAlerts().then(
        (d) => alive && apply(d),
        () => alive && setLoading(false)
      );
    refresh();
    deviceState().then((s) => alive && setDevice(s));
    // keep the page current while it's open (the scheduler checks in the background)
    const t = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [apply]);

  // opening the page reads the alerts
  const unread = data?.events.filter((e) => !e.readAt).length ?? 0;
  useEffect(() => {
    if (unread > 0) fetch("/api/alerts/events", { method: "PATCH" }).catch(() => {});
  }, [unread]);

  async function enableDevice() {
    if (!data?.channels.push.publicKey) return;
    setBusy("device");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setDevice(perm === "denied" ? "denied" : "off");
        toast.error("Notifications weren't allowed in this browser.");
        return;
      }
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(data.channels.push.publicKey) }));
      const ok = await api("/api/alerts/push", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (ok) {
        if (!data.prefs.push) await api("/api/alerts/prefs", { method: "PATCH", body: JSON.stringify({ push: true }) });
        setDevice("on");
        toast.success("This device will get Edge alerts.");
        load();
      }
    } catch (err) {
      console.error(err);
      toast.error("This browser couldn't turn on notifications.");
    } finally {
      setBusy(null);
    }
  }

  async function disableDevice() {
    setBusy("device");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api("/api/alerts/push", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setDevice("off");
      load();
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    const r = await api<{ sent: number }>("/api/alerts/push/test", { method: "POST" });
    if (r) toast.success("Test sent. It should pop up in a few seconds.");
    setBusy(null);
  }

  async function setPref(key: "push" | "email", value: boolean) {
    const r = await api<{ prefs: AlertsData["prefs"] }>("/api/alerts/prefs", {
      method: "PATCH",
      body: JSON.stringify({ [key]: value }),
    });
    if (r && data) setData({ ...data, prefs: r.prefs });
  }

  async function addMonitor() {
    setBusy("add");
    const r = await api<{ monitor: Monitor }>("/api/alerts/monitors", { method: "POST", body: JSON.stringify(form) });
    if (r) {
      toast.success(`Edge is now watching ${r.monitor.label}.`);
      setForm((f) => ({ ...f, instrument: "" }));
      await load();
      setExpanded(r.monitor.id);
    }
    setBusy(null);
  }

  async function checkNow(m: Monitor) {
    setBusy(`check-${m.id}`);
    const r = await api<{ result: { alerted: boolean; state: string; error: string | null } }>(
      `/api/alerts/monitors/${m.id}/check`,
      { method: "POST" }
    );
    if (r) {
      if (r.result.alerted) toast.success(`${m.label} passes your checklist's chart rules. Alert sent.`);
      else if (r.result.error) toast.error(r.result.error);
      else toast.success("Checked.");
      await load();
      setExpanded(m.id);
    }
    setBusy(null);
  }

  async function setStatus(m: Monitor, status: "active" | "paused") {
    setBusy(`status-${m.id}`);
    if (await api(`/api/alerts/monitors/${m.id}`, { method: "PATCH", body: JSON.stringify({ status }) })) await load();
    setBusy(null);
  }

  async function remove(m: Monitor) {
    if (!window.confirm(`Stop watching ${m.label}? Past alerts stay in your history.`)) return;
    setBusy(`remove-${m.id}`);
    if (await api(`/api/alerts/monitors/${m.id}`, { method: "DELETE" })) {
      toast.success(`Stopped watching ${m.label}.`);
      await load();
    }
    setBusy(null);
  }

  /** Open the trade workspace on this instrument with this checklist. */
  async function openWorkspace(edgeId: string | null, instrument: string) {
    if (!edgeId) return router.push("/app/workspace");
    setBusy(`open-${instrument}`);
    const r = await api("/api/workspace/sessions", { method: "POST", body: JSON.stringify({ edgeId, instrument }) });
    setBusy(null);
    if (r) router.push("/app/workspace");
  }

  const monitors = data?.monitors ?? [];
  const atLimit = data ? monitors.length >= data.maxMonitors : true;
  const push = data?.channels.push;
  const email = data?.channels.email;

  return (
    <AppFrame active="alerts" title="Alerts">
      <div className="mx-auto w-full max-w-[960px] px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h2 className="text-xl font-medium tracking-tight text-ink sm:text-2xl">Let Edge watch the markets</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Pick the markets you trade with the same checklist. Edge checks your chart rules on every new candle and
            tells you when they all pass, so you don&apos;t have to sit at the screen. An alert isn&apos;t an approval:
            you still check the trade in the workspace before placing it.
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center rounded-xl border border-line bg-surface/30 py-16">
            <span className="text-sm text-muted">Loading your alerts...</span>
          </div>
        )}

        {!loading && data && data.checklists.length === 0 && (
          <div className="flex flex-col items-center rounded-xl border border-line bg-surface/30 p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-track text-muted">
              <IconBell className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-medium text-ink">Approve a checklist first</h3>
            <p className="mt-1 max-w-md text-sm text-muted">
              Edge watches the markets with your own approved checklist and its confirmed chart examples.
            </p>
            <Link href="/checklist" className="btn btn-main btn-sm mt-6">
              Build your checklist
            </Link>
          </div>
        )}

        {!loading && data && data.checklists.length > 0 && (
          <div className="space-y-6">
            {/* ------------------------------------------------ channels -- */}
            <section className="card p-5" aria-labelledby="notify-h">
              <h3 id="notify-h" className="text-base font-medium text-ink">
                How Edge tells you
              </h3>
              <div className="mt-4 divide-y divide-line">
                <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">Browser and phone notifications</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {!push?.configured
                        ? "Not set up on this server yet."
                        : device === "on"
                          ? `On for this device${push.devices > 1 ? ` and ${push.devices - 1} other${push.devices > 2 ? "s" : ""}` : ""}.`
                          : device === "denied"
                            ? "Blocked in this browser. Allow notifications for this site in the browser settings."
                            : device === "needs-install"
                              ? "On iPhone and iPad: tap Share, then Add to Home Screen, and open Edge from there."
                              : device === "unsupported"
                                ? "This browser can't show notifications."
                                : push.devices > 0
                                  ? `On for ${push.devices} other device${push.devices > 1 ? "s" : ""}. Not on this one.`
                                  : "Pops up on your laptop or phone, even when Edge isn't open."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {push?.configured && device === "on" && (
                      <>
                        <Switch on={data.prefs.push} onChange={(v) => setPref("push", v)} label="Send notifications" />
                        <button type="button" className="btn btn-sm" onClick={sendTest} disabled={busy === "test"}>
                          Send a test
                        </button>
                        <button type="button" className="btn btn-sm" onClick={disableDevice} disabled={busy === "device"}>
                          Turn off here
                        </button>
                      </>
                    )}
                    {push?.configured && device === "off" && (
                      <button type="button" className="btn btn-main btn-sm" onClick={enableDevice} disabled={busy === "device"}>
                        Turn on for this device
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">Email</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {email?.configured ? `To ${email.address}, with each rule's result.` : "Not set up on this server yet."}
                    </p>
                  </div>
                  {email?.configured && <Switch on={data.prefs.email} onChange={(v) => setPref("email", v)} label="Email alerts" />}
                </div>
              </div>
            </section>

            {/* --------------------------------------------- add monitor -- */}
            <section className="card p-5" aria-labelledby="add-h">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id="add-h" className="text-base font-medium text-ink">
                  Watch a market
                </h3>
                <span className="text-xs text-muted">
                  {monitors.length} of {data.maxMonitors} used
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1.2fr_1.2fr_0.8fr_auto] sm:items-end">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted">Checklist</span>
                  <Dropdown
                    ariaLabel="Checklist"
                    value={form.edgeId}
                    onChange={(v) => setForm({ ...form, edgeId: v })}
                    options={data.checklists.map((c) => ({ value: c.edgeId, label: c.name, sublabel: `v${c.versionNumber}` }))}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted">Market</span>
                  <Dropdown
                    ariaLabel="Market"
                    placeholder="Pick a market…"
                    value={form.instrument}
                    onChange={(v) => setForm({ ...form, instrument: v })}
                    options={data.instruments.map((i) => ({
                      value: i.symbol,
                      label: i.label,
                      sublabel: i.ready ? ASSET_LABEL[i.assetClass] : "Prices not available yet",
                      disabled:
                        !i.ready || monitors.some((m) => m.instrument === i.symbol && m.edgeId === form.edgeId),
                    }))}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted">Timeframe</span>
                  <Dropdown
                    ariaLabel="Timeframe"
                    value={form.timeframe}
                    onChange={(v) => setForm({ ...form, timeframe: v })}
                    options={data.timeframes.map((t) => ({ value: t, label: t }))}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-main btn-sm"
                  onClick={addMonitor}
                  disabled={atLimit || !form.edgeId || !form.instrument || busy === "add"}
                >
                  Start watching
                </button>
              </div>
              <p className="mt-3 text-xs text-muted">
                The timeframe is used for chart rules that don&apos;t name their own. Rules that do (e.g. &quot;4H
                trend&quot;) are checked on theirs.
              </p>
            </section>

            {/* ------------------------------------------------ monitors -- */}
            <section aria-labelledby="watching-h">
              <h3 id="watching-h" className="mb-3 text-base font-medium text-ink">
                Watching
              </h3>
              {monitors.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface/30 p-6 text-center text-sm text-muted">
                  Nothing yet. Add a market above.
                </p>
              ) : (
                <div className="space-y-3">
                  {monitors.map((m) => {
                    const open = expanded === m.id;
                    return (
                      <div key={m.id} className={`card overflow-hidden ${open ? "ring-1 ring-line" : ""}`}>
                        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                          <button
                            type="button"
                            className="flex min-w-0 flex-wrap items-center gap-2 text-left"
                            onClick={() => setExpanded(open ? null : m.id)}
                            aria-expanded={open}
                          >
                            <span className="text-base font-medium text-ink">{m.label}</span>
                            <span className="rounded bg-track px-1.5 py-0.5 text-xs text-muted">{m.timeframe}</span>
                            <span className="truncate text-xs text-muted">{m.edgeName ?? "Checklist"}</span>
                          </button>
                          <div className="flex flex-wrap items-center gap-2">
                            <MonitorState m={m} />
                            <span className="text-xs text-muted">{open ? "Collapse ▲" : "Details ▼"}</span>
                          </div>
                        </div>
                        {m.error && (
                          <p className="border-t border-line bg-warn-bg px-5 py-2 text-xs text-maybe">{m.error}</p>
                        )}
                        {open && (
                          <div className="border-t border-line bg-surface/40 p-4 sm:p-5">
                            <p className="mb-3 text-xs text-muted">
                              Last checked {ago(m.lastCheckedAt)}
                              {m.nextCheckAt ? ` · next check ${until(m.nextCheckAt)}` : ""}
                              {m.lastAlertAt ? ` · last alert ${ago(m.lastAlertAt)}` : ""}
                            </p>
                            {m.summary ? (
                              <RuleList summary={m.summary} />
                            ) : (
                              <p className="text-sm text-muted">Edge hasn&apos;t checked this market yet.</p>
                            )}
                            <div className="mt-4 flex flex-wrap gap-2">
                              {m.status === "active" && (
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => checkNow(m)}
                                  disabled={busy === `check-${m.id}`}
                                >
                                  <IconRetry className="h-4 w-4" />
                                  {busy === `check-${m.id}` ? "Checking…" : "Check now"}
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => setStatus(m, m.status === "active" ? "paused" : "active")}
                                disabled={busy === `status-${m.id}`}
                              >
                                {m.status === "active" ? "Pause" : "Resume"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => openWorkspace(m.edgeId, m.instrument)}
                                disabled={busy === `open-${m.instrument}`}
                              >
                                Open in workspace
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => remove(m)}
                                disabled={busy === `remove-${m.id}`}
                              >
                                <IconTrash className="h-4 w-4" /> Remove
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* --------------------------------------------------- history -- */}
            <section aria-labelledby="history-h">
              <h3 id="history-h" className="mb-3 text-base font-medium text-ink">
                Recent alerts
              </h3>
              {data.events.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface/30 p-6 text-center text-sm text-muted">
                  No alerts yet. When a market you watch passes your checklist&apos;s chart rules, it shows up here.
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.events.map((e) => {
                    const focus = focusEvent === e.id;
                    return (
                      <li key={e.id} className={`card p-4 sm:p-5 ${focus ? "ring-1 ring-accent" : ""}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              {!e.readAt && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-black">NEW</span>}
                              <span className="text-base font-medium text-ink">{e.label}</span>
                              <span className="rounded bg-track px-1.5 py-0.5 text-xs text-muted">{e.timeframe}</span>
                              <span className="flex items-center gap-1 text-xs font-medium text-pass">
                                <IconCheck className="h-3.5 w-3.5" /> Passed your checklist&apos;s chart rules
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted">
                              {new Date(e.createdAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {e.summary?.edgeName ? ` · ${e.summary.edgeName}` : ""}
                              {e.lastPrice != null ? ` · price ${e.lastPrice}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="btn btn-main btn-sm shrink-0"
                            onClick={() => openWorkspace(e.edgeId, e.instrument)}
                            disabled={busy === `open-${e.instrument}`}
                          >
                            Check the trade
                          </button>
                        </div>
                        {focus && e.summary && (
                          <div className="mt-4">
                            <RuleList summary={e.summary} />
                          </div>
                        )}
                        {!focus && (
                          <button type="button" className="mt-2 text-xs text-muted underline" onClick={() => setFocusEvent(e.id)}>
                            Show the rules
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <p className="text-xs text-muted">
              Edge checks your own checklist. It doesn&apos;t predict prices or recommend trades.
            </p>
          </div>
        )}
      </div>
    </AppFrame>
  );
}
