"use client";

import { useEffect, useState } from "react";

interface SettingsData {
  email: string;
  name: string | null;
  timezone: string;
  createdAt: string;
  notifications: {
    reviewComplete: boolean;
    journalReady: boolean;
    dailyDigest: boolean;
    weeklyReview: boolean;
    monthlyReview: boolean;
  };
  reduceMotion: boolean;
  mailgunConfigured: boolean;
}

const NOTIFICATION_ROWS: Array<{
  key: keyof SettingsData["notifications"];
  label: string;
  hint: string;
}> = [
  {
    key: "reviewComplete",
    label: "Review completed",
    hint: "Email when an AI review finishes.",
  },
  {
    key: "journalReady",
    label: "Journal prompt",
    hint: "Nudge after a closed trade to log the journal entry.",
  },
  {
    key: "dailyDigest",
    label: "Daily digest",
    hint: "A short summary of yesterday's discipline.",
  },
  {
    key: "weeklyReview",
    label: "Weekly review",
    hint: "Sunday recap: adherence, overrides, P&L.",
  },
  {
    key: "monthlyReview",
    label: "Monthly review",
    hint: "End-of-month report across all edges.",
  },
];

function timezoneList(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone");
    if (zones && zones.length) {
      // supportedValuesOf omits the literal "UTC" zone — keep it first.
      return zones.includes("UTC") ? zones : ["UTC", ...zones];
    }
  } catch {
    /* fall through */
  }
  return [
    "UTC",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Paris",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Australia/Sydney",
  ];
}

function applyAppearance(reduceMotion: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-motion", reduceMotion ? "reduce" : "full");
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [notifications, setNotifications] = useState<SettingsData["notifications"] | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState("");
  const zones = useState(() => timezoneList())[0];

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        setData(d);
        setName(d.name ?? "");
        setTimezone(d.timezone ?? "UTC");
        setNotifications(d.notifications);
        setReduceMotion(Boolean(d.reduceMotion));
      })
      .catch(() => setError("Could not load settings"));

    const storedTheme = localStorage.getItem("edge-theme");
    if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
  }, []);

  function showFlash(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(""), 2500);
  }

  function setNotification(key: keyof SettingsData["notifications"], value: boolean) {
    setNotifications((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, timezone }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      showFlash("Profile saved.");
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveNotifications(next: SettingsData["notifications"]) {
    setNotifications(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifications: next }),
      });
      if (!res.ok) throw new Error("Save failed");
      showFlash("Notification preferences saved.");
    } catch {
      setFlash("Could not save notification preferences.");
    }
  }

  function switchTheme(next: "dark" | "light") {
    setTheme(next);
    localStorage.setItem("edge-theme", next);
    document.documentElement.setAttribute("data-theme", next);
    showFlash(next === "light" ? "Light theme on." : "Dark theme on.");
  }

  async function switchMotion(next: boolean) {
    setReduceMotion(next);
    applyAppearance(next);
    try {
      localStorage.setItem("edge-motion", next ? "reduce" : "full");
    } catch {
      /* private mode */
    }
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reduceMotion: next }),
      });
      showFlash(next ? "Reduced motion on." : "Full motion on.");
    } catch {
      /* preference still applies locally */
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (error) return <p className="text-fail">{error}</p>;
  if (!data || !notifications) return <p className="text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl tracking-tight">Settings</h1>
          <p className="mt-1 text-muted">Profile, notifications, privacy, and account controls.</p>
        </div>
        {flash && (
          <span className="tag tag-pass" role="status">
            {flash}
          </span>
        )}
      </div>

      {/* profile */}
      <section className="card space-y-4">
        <h2 className="text-lg font-medium">Profile</h2>
        <form onSubmit={saveProfile} className="space-y-3">
          <div>
            <label htmlFor="s-email" className="mb-1 block text-xs text-muted">
              Email
            </label>
            <input id="s-email" className="input" value={data.email} disabled readOnly />
          </div>
          <div>
            <label htmlFor="s-name" className="mb-1 block text-xs text-muted">
              Display name
            </label>
            <input
              id="s-name"
              className="input"
              placeholder="Optional"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </div>
          <div>
            <label htmlFor="s-tz" className="mb-1 block text-xs text-muted">
              Timezone
            </label>
            <select
              id="s-tz"
              className="input"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-main" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save profile"}
          </button>
        </form>
      </section>

      {/* notifications */}
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-medium">Notifications</h2>
          <p className="mt-1 text-sm text-muted">
            {data.mailgunConfigured
              ? "Sent by email via Mailgun."
              : "Mailgun is not configured — emails are disabled in this environment."}
          </p>
        </div>
        <ul className="divide-y divide-line">
          {NOTIFICATION_ROWS.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm">{row.label}</p>
                <p className="text-xs text-muted">{row.hint}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifications[row.key]}
                aria-label={row.label}
                onClick={() => saveNotifications({ ...notifications, [row.key]: !notifications[row.key] })}
                className={`tag ${notifications[row.key] ? "tag-pass" : "tag-neutral"}`}
              >
                {notifications[row.key] ? "On" : "Off"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* appearance + accessibility */}
      <section className="card space-y-4">
        <h2 className="text-lg font-medium">Appearance &amp; accessibility</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm">Theme</p>
            <p className="text-xs text-muted">Light or dark across the whole app.</p>
          </div>
          <div className="flex gap-2">
            {(["dark", "light"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`btn ${theme === t ? "border-accent text-accent" : ""}`}
                onClick={() => switchTheme(t)}
              >
                {t === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm">Reduce motion</p>
            <p className="text-xs text-muted">
              Also honors your OS “prefers reduced motion” setting automatically.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={reduceMotion}
            aria-label="Reduce motion"
            onClick={() => switchMotion(!reduceMotion)}
            className={`tag ${reduceMotion ? "tag-pass" : "tag-neutral"}`}
          >
            {reduceMotion ? "On" : "Off"}
          </button>
        </div>
      </section>

      {/* privacy */}
      <section className="card space-y-3">
        <h2 className="text-lg font-medium">Privacy</h2>
        <p className="text-sm text-muted">
          Download a complete copy of your data — edges, checklists, visual references, reviews,
          trades, and journal entries — as JSON.
        </p>
        <a className="btn" href="/api/export">
          Export my data ↓
        </a>
      </section>

      {/* account */}
      <section className="card space-y-3">
        <h2 className="text-lg font-medium">Account</h2>
        <p className="text-sm text-muted">
          Signed in as {data.email}
          {data.createdAt ? ` · member since ${new Date(data.createdAt).toLocaleDateString()}` : ""}
        </p>
        <button type="button" className="btn btn-danger" onClick={signOut}>
          Sign out
        </button>
      </section>
    </div>
  );
}
