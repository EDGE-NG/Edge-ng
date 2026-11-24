"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppFrame from "../../_components/app-frame";
import Dropdown from "../../_components/dropdown";
import {
  IconCheck,
  IconGear,
  IconLogout,
  IconMonitor,
  IconMoon,
  IconShield,
  IconSmartphone,
  IconSun,
  IconTrash,
  IconX,
} from "../../_components/icons";
import { toast } from "../../_components/toaster";
import { applyTheme, getStoredTheme, type Theme } from "../../_components/theme-toggle";
import {
  fetchDeviceSessions,
  handleSessionExpired,
  revokeDeviceSession,
  signOut,
  signOutOtherDevices,
  type DeviceSession,
} from "@/lib/client-auth";

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const MARKETS = [
  { id: "crypto", label: "Cryptocurrency (BTC, ETH, SOL...)" },
  { id: "forex", label: "Forex (EUR/USD, GBP/USD...)" },
  { id: "indices", label: "Indices (S&P 500, Nasdaq, DAX...)" },
];

export default function SettingsView() {
  const router = useRouter();
  const [tab, setTab] = useState<"profile" | "billing" | "export" | "danger">("profile");

  // Profile Form State
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [preferredMarkets, setPreferredMarkets] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Delete Account State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [showSignOutOthersModal, setShowSignOutOthersModal] = useState(false);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingSessions(true);
      const list = await fetchDeviceSessions();
      if (alive) {
        setSessions(list);
        setLoadingSessions(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/settings/profile");
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (alive && data.user) {
            setEmail(data.user.email || "");
            setDisplayName(data.user.displayName || "");
            setTimezone(data.user.timezone || "UTC");
            setPreferredMarkets(data.user.preferredMarkets || []);
            setAvatarUrl(data.user.avatarUrl || null);
            if (data.user.avatarUrl) {
              try {
                localStorage.setItem("edge-user-avatar", data.user.avatarUrl);
              } catch {}
            }
            if (data.user.theme) {
              setTheme(data.user.theme as Theme);
              applyTheme(data.user.theme as Theme);
            } else {
              setTheme(getStoredTheme());
            }
          }
        } else {
          toast.error("Failed to load profile settings.");
        }
      } catch (err) {
        console.error("Failed to load settings profile", err);
        toast.error("Network error: Unable to load profile. Please check your connection.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image (PNG, JPEG, or WebP).");
      return;
    }

    setUploadingAvatar(true);
    const reader = new FileReader();
    reader.onerror = () => {
      toast.error("Failed to read the selected image file.");
      setUploadingAvatar(false);
    };
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => {
        toast.error("Failed to process image.");
        setUploadingAvatar(false);
      };
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 256;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setAvatarUrl(dataUrl);
        setUploadingAvatar(false);
        toast.info("Profile photo updated. Click 'Save changes' to apply.", { duration: 3000 });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  function handleSelectTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
  }

  async function handleSaveProfile(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, timezone, preferredMarkets, avatarUrl, theme }),
      });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (res.ok) {
        toast.success("Profile preferences saved successfully.");
        if (avatarUrl) {
          try {
            localStorage.setItem("edge-user-avatar", avatarUrl);
          } catch {}
        } else {
          try {
            localStorage.removeItem("edge-user-avatar");
          } catch {}
        }
        // Notify sidebar & application frame to update avatar & display name immediately
        window.dispatchEvent(
          new CustomEvent("edge:profile-updated", {
            detail: { displayName, avatarUrl },
          })
        );
      } else {
        const d = await res.json().catch(() => ({}));
        if (d.error === "Not authenticated") {
          handleSessionExpired();
          return;
        }
        toast.error(d.error || "Failed to update profile settings.");
      }
    } catch (err) {
      console.error("Failed to update profile", err);
      toast.error("Network error: Unable to reach the server. Please check your internet connection.");
    } finally {
      setSaving(false);
    }
  }

  function toggleMarket(marketId: string) {
    setPreferredMarkets((prev) =>
      prev.includes(marketId) ? prev.filter((m) => m !== marketId) : [...prev, marketId]
    );
  }

  const [exporting, setExporting] = useState(false);

  async function handleDownloadExport() {
    setExporting(true);
    toast.info("Preparing data export...", { duration: 2000 });
    try {
      const res = await fetch("/api/settings/export");
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (!res.ok) {
        throw new Error("Export failed with status " + res.status);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `edge-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("Data export downloaded successfully.");
    } catch (err) {
      console.error("Export failed", err);
      toast.error("Network error: Could not download export. Please check your internet connection.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmation !== "DELETE") return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/settings/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (res.ok) {
        const d = (await res.json().catch(() => ({}))) as { dueAt?: string };
        const when = d.dueAt ? new Date(d.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "in 14 days";
        try {
          localStorage.removeItem("edge-user-profile");
          localStorage.removeItem("edge-user-avatar");
        } catch {
          /* storage blocked */
        }
        toast.success(`Your account will be deleted on ${when}. Sign in before then to cancel.`, { duration: 10000 });
        router.push("/");
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        const msg = d.error || "Failed to delete account";
        setDeleteError(msg);
        toast.error(msg);
      }
    } catch {
      const msg = "Network error: Unable to reach server. Please check your internet connection.";
      setDeleteError(msg);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppFrame active="settings" title="Settings">
      <div className="mx-auto w-full max-w-[800px] px-4 py-8 sm:px-6">
        {/* Navigation Tabs */}
        <div className="mb-8 border-b border-line">
          <nav className="-mb-px flex space-x-4 sm:space-x-6 overflow-x-auto whitespace-nowrap scrollbar-none">
            {(
              [
                { id: "profile", label: "Profile & Preferences" },
                { id: "billing", label: "Billing & Plan" },
                { id: "export", label: "Data & Export" },
                { id: "danger", label: "Account Deletion" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`border-b-2 py-3 text-sm font-medium transition ${
                  tab === t.id
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:border-line hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab 1: Profile & Preferences */}
        {tab === "profile" && (
          <section className="card p-6 sm:p-8">
            <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-medium text-ink">Trader Profile & Preferences</h3>
                <p className="mt-1 text-xs text-muted">
                  Configure your timezone and display preferences (PRD 4.8).
                </p>
              </div>
              <div className="flex items-center gap-3 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => handleSaveProfile()}
                  disabled={saving}
                  className="btn btn-main btn-sm text-xs px-4"
                >
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-8 text-xs text-muted">Loading preferences...</div>
            ) : (
              <form onSubmit={handleSaveProfile} className="mt-6 space-y-6">
                {/* Profile Photo */}
                <div>
                  <label className="block text-xs font-medium text-ink">Profile Photo</label>
                  <div className="mt-3 flex items-center gap-4">
                    {/* Interactive Avatar Circle with Upload Badge */}
                    <label
                      className="group relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-2 ring-line transition hover:ring-accent/70"
                      title="Click to upload profile photo"
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt="Profile photo"
                          className="h-full w-full object-cover transition group-hover:opacity-75"
                        />
                      ) : (
                        <span
                          className="grid h-full w-full place-items-center text-2xl font-semibold text-[#04110a]"
                          style={{ background: "linear-gradient(135deg,#e6ff5a,#5ef088)" }}
                        >
                          {(displayName || email || "T").trim().charAt(0).toUpperCase()}
                        </span>
                      )}

                      {/* Hover Scrim with Camera/Upload Icon */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 opacity-0 transition group-hover:opacity-100">
                        <svg
                          className="h-5 w-5 text-accent"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                          />
                        </svg>
                        <span className="mt-0.5 text-[10px] font-medium text-white">Upload</span>
                      </div>

                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleAvatarFile}
                        className="hidden"
                      />
                    </label>

                    {/* Explanatory text & actions */}
                    <div className="flex flex-col gap-1 text-xs">
                      <span className="font-medium text-ink">
                        {uploadingAvatar ? "Processing photo…" : "Upload profile photo"}
                      </span>
                      <span className="text-[11px] text-muted">
                        Click the avatar to select an image (JPG, PNG, or WebP).
                      </span>
                      {avatarUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setAvatarUrl(null);
                            toast.info("Profile photo cleared. Click 'Save changes' to apply.", { duration: 3000 });
                          }}
                          className="mt-0.5 w-fit text-[11px] font-medium text-fail hover:underline"
                        >
                          Remove photo
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted">Email Address</label>
                  <input
                    type="email"
                    disabled
                    value={email}
                    className="mt-1 w-full rounded-md border border-line bg-track/60 px-3 py-2 text-xs text-muted cursor-not-allowed"
                  />
                  <span className="mt-1 block text-[11px] text-muted">
                    Managed securely via Supabase Auth.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink">Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your trader name"
                    className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink">Timezone</label>
                  <div className="mt-1">
                    <Dropdown
                      value={timezone}
                      onChange={setTimezone}
                      options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                      className="w-full"
                      ariaLabel="Timezone"
                    />
                  </div>
                  <span className="mt-1.5 block text-[11px] text-muted">
                    Timestamps in the journal and workspace will format according to this timezone.
                  </span>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium text-ink">Preferred Markets</label>
                  <div className="space-y-2">
                    {MARKETS.map((m) => {
                      const checked = preferredMarkets.includes(m.id);
                      return (
                        <label
                          key={m.id}
                          className="flex cursor-pointer items-center gap-2.5 text-xs text-ink/90"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMarket(m.id)}
                            className="rounded border-line bg-surface text-accent focus:ring-accent"
                          />
                          <span>{m.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Interface Theme */}
                <div>
                  <label className="block text-xs font-medium text-ink">Interface Theme</label>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Choose how Edge looks across charts and workspaces. You can also quickly toggle anytime using the sun/moon button in the top header.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {[
                      {
                        id: "dark" as const,
                        title: "Dark mode",
                        desc: "Deep blacks and forest green for focused trading",
                        icon: <IconMoon className="h-4 w-4 text-accent" />,
                      },
                      {
                        id: "light" as const,
                        title: "Light mode",
                        desc: "Clean high-contrast theme for daytime sessions",
                        icon: <IconSun className="h-4 w-4 text-amber-500" />,
                      },
                      {
                        id: "system" as const,
                        title: "System default",
                        desc: "Automatically adapts to device appearance",
                        icon: (
                          <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                            <rect x="2" y="3" width="20" height="14" rx="2" />
                            <path d="M8 21h8M12 17v4" />
                          </svg>
                        ),
                      },
                    ].map((opt) => {
                      const selected = theme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleSelectTheme(opt.id)}
                          className={`flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition ${
                            selected
                              ? "border-accent bg-accent/10 ring-1 ring-accent"
                              : "border-line bg-surface/50 hover:border-line hover:bg-surface"
                          }`}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="flex items-center gap-2 text-xs font-semibold text-ink">
                              {opt.icon}
                              {opt.title}
                            </span>
                            <span
                              className={`h-2 w-2 rounded-full ${
                                selected ? "bg-accent ring-2 ring-accent/30" : "bg-line"
                              }`}
                            />
                          </div>
                          <p className="text-[11px] leading-relaxed text-muted">{opt.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-end border-t border-line pt-4">
                  <button type="submit" disabled={saving} className="btn btn-main btn-sm text-xs px-4">
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* Tab 2: Billing & Plan */}
        {tab === "billing" && (
          <section className="card p-6 sm:p-8">
            <h3 className="text-lg font-medium text-ink">Subscription & Billing</h3>
            <p className="mt-1 text-xs text-muted">
              Current membership plan and feature access.
            </p>

            <div className="mt-6 rounded-lg border border-accent/30 bg-card-a p-5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="tag tag-pass">Active Plan</span>
                  <h4 className="mt-2 text-base font-medium text-ink">Edge Preview / Core Demo</h4>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-light text-ink">$0</span>
                  <span className="text-xs text-muted"> / month</span>
                </div>
              </div>

              <div className="mt-4 border-t border-line pt-4 text-xs text-ink/80">
                <div className="font-medium text-ink">Included in this preview:</div>
                <ul className="mt-2 space-y-1.5 text-muted">
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-pass" />
                    <span>Unlimited AI trading plan to checklist generation</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-pass" />
                    <span>Up to 6 evidence images per rule</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-pass" />
                    <span>Live multi-timeframe trade workspace & pre-trade gate</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-pass" />
                    <span>Discipline journal & override recording</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-line bg-panel p-4 text-xs text-muted">
              <p>
                <strong>Note on Billing:</strong> Paid membership tiers, payment processing, and broker integration are
                part of future development phases as specified in the project roadmap. No payment method is required
                during the core loop demo.
              </p>
            </div>
          </section>
        )}

        {/* Tab 3: Data & Export */}
        {tab === "export" && (
          <section className="card p-6 sm:p-8">
            <h3 className="text-lg font-medium text-ink">Export Your Data</h3>
            <p className="mt-1 text-xs text-muted">
              Download a complete machine-readable copy of your checklists, evidence, trade intents, gate decisions, and journal entries (PRD 4.8 / GDPR).
            </p>

            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-line bg-panel p-4 text-xs text-ink/85">
                <p>The export includes:</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
                  <li>Account profile & legal acceptance records</li>
                  <li>Checklists and all immutable approved versions</li>
                  <li>Checklist items and rules</li>
                  <li>Evidence library metadata and AI explanations</li>
                  <li>All trade intents and pre-trade gate decisions</li>
                  <li>Recorded overrides with bypassed rules and stated reasons</li>
                  <li>Full journal reflections and execution notes</li>
                </ul>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleDownloadExport}
                  disabled={exporting}
                  className="btn btn-main btn-sm inline-flex items-center gap-2 text-xs"
                >
                  <IconGear className="h-3.5 w-3.5" />
                  {exporting ? "Preparing export..." : "Download Full JSON Export"}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Tab 4: Account Deletion (Danger Zone) */}
        {tab === "danger" && (
          <section className="card border-fail/30 p-6 sm:p-8">
            <div className="flex items-center gap-2 text-fail">
              <IconTrash className="h-5 w-5" />
              <h3 className="text-lg font-medium">Delete Account & Data</h3>
            </div>
            <p className="mt-1 text-xs text-muted">
              Remove your account and all its checklists, example charts, decisions and journal entries. You have 14 days to change your mind.
            </p>

            <div className="mt-6 rounded-lg border border-fail/20 bg-err-bg/30 p-4 text-xs text-ink/85">
              <p className="font-semibold text-fail">Your account is deleted 14 days after you confirm.</p>
              <p className="mt-1 text-muted">
                You&apos;ll be signed out on every device. Sign in again within 14 days to cancel. After that, your account
                and all its data are deleted for good and can&apos;t be recovered. A short record that the account was
                deleted (email and date) is kept for security.
              </p>
            </div>

            <div className="mt-6 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="rounded-md border border-fail/60 bg-fail/10 px-4 py-2 text-xs font-semibold text-fail transition hover:bg-fail/20"
              >
                Delete My Account
              </button>
            </div>
          </section>
        )}

        {/* Active Sessions & Sign Out: on every tab, below the tab's content */}
        <section className="card mt-6 p-6 sm:p-8" aria-labelledby="signout-title">
          <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <h3 id="signout-title" className="text-lg font-medium text-ink">Active Devices & Sessions</h3>
                {sessions.length > 0 && (
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                    {sessions.length} {sessions.length === 1 ? "device" : "devices"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                {email ? (
                  <>
                    Signed in as <span className="break-all text-ink">{email}</span>. Manage all devices and browsers where Edge is signed in.
                  </>
                ) : (
                  "Manage all devices and browsers where Edge is signed in."
                )}
              </p>
            </div>

            {sessions.filter((s) => !s.isCurrent).length > 0 && (
              <div className="flex shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSignOutOthersModal(true)}
                  disabled={signingOutOthers || signingOut}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink transition hover:border-accent/40 hover:bg-panel disabled:opacity-60"
                  title="Revoke access on all devices except this one"
                >
                  <IconShield className="h-3.5 w-3.5 text-accent" />
                  Sign out all other devices
                </button>
              </div>
            )}
          </div>

          {/* Device session cards */}
          <div className="mt-5 space-y-3">
            {loadingSessions ? (
              <div className="py-6 text-center text-xs text-muted">Loading your active devices…</div>
            ) : sessions.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted">No other active sessions found.</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-3 rounded-xl border border-line bg-panel/30 p-4 transition hover:bg-panel/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${
                        s.isCurrent
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-line bg-surface text-muted"
                      }`}
                    >
                      {s.isMobile ? <IconSmartphone className="h-4 w-4" /> : <IconMonitor className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink truncate">{s.device}</span>
                        {s.isCurrent && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-pass/30 bg-pass-bg px-2 py-0.5 text-[10px] font-semibold text-pass">
                            <span className="h-1.5 w-1.5 rounded-full bg-pass animate-pulse" />
                            This device
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {s.isCurrent ? (
                          <span className="font-medium text-accent">Active now</span>
                        ) : (
                          <>
                            Last active {new Date(s.lastActive).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </>
                        )}
                        {s.ip && <span className="opacity-75"> · IP: {s.ip}</span>}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                    {s.isCurrent ? (
                      <button
                        type="button"
                        onClick={async () => {
                          setSigningOut(true);
                          if (!(await signOut(router))) setSigningOut(false);
                        }}
                        disabled={signingOut}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-line px-3.5 py-1.5 text-xs font-medium text-ink transition hover:bg-panel disabled:opacity-60"
                      >
                        <IconLogout className="h-3.5 w-3.5" />
                        {signingOut ? "Signing out…" : "Sign out"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          setRevokingSessionId(s.id);
                          const ok = await revokeDeviceSession(s.id);
                          setRevokingSessionId(null);
                          if (ok) {
                            setSessions((prev) => prev.filter((item) => item.id !== s.id));
                          }
                        }}
                        disabled={revokingSessionId === s.id}
                        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-fail/30 bg-fail/5 px-3 py-1.5 text-xs font-medium text-fail transition hover:border-fail/50 hover:bg-fail/15 disabled:opacity-50"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                        {revokingSessionId === s.id ? "Signing out…" : "Sign out device"}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Sign Out Other Devices Modal */}
        {showSignOutOthersModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-accent/10 text-accent">
                    <IconShield className="h-4 w-4" />
                  </div>
                  <h4 className="text-base font-semibold text-ink">Sign Out Other Devices</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSignOutOthersModal(false)}
                  className="text-muted hover:text-ink"
                  aria-label="Close"
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted">
                This will immediately invalidate all active Edge sessions on all other phones, tablets, and computers. Any other device will be required to sign in again.
              </p>

              <div className="mt-3 rounded-lg border border-line bg-panel p-3 text-xs text-ink/90">
                <span className="font-semibold text-accent">✓ You will stay signed in</span> on this current browser and device.
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowSignOutOthersModal(false)}
                  className="btn btn-ghost btn-sm text-xs"
                  disabled={signingOutOthers}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={signingOutOthers}
                  onClick={async () => {
                    setSigningOutOthers(true);
                    const ok = await signOutOtherDevices();
                    setSigningOutOthers(false);
                    if (ok) setShowSignOutOthersModal(false);
                  }}
                  className="btn btn-main btn-sm text-xs font-semibold"
                >
                  {signingOutOthers ? "Signing out others…" : "Confirm & sign out other devices"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-semibold text-fail">Confirm Account Deletion</h4>
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="text-muted hover:text-ink"
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <p className="mt-3 text-xs text-muted">
                Your account will be deleted in 14 days unless you sign in again before then. To confirm, type{" "}
                <strong className="text-ink">DELETE</strong> below:
              </p>

              <input
                type="text"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder="Type DELETE"
                className="mt-3 w-full rounded-md border border-line bg-panel px-3 py-2 font-mono text-xs text-ink focus:border-fail focus:outline-none"
              />

              {deleteError && (
                <div className="mt-2 text-xs text-fail">{deleteError}</div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="btn btn-ghost btn-sm text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteConfirmation !== "DELETE" || deleting}
                  onClick={handleDeleteAccount}
                  className="rounded-md bg-fail px-4 py-1.5 text-xs font-semibold text-white transition disabled:opacity-40 hover:bg-fail/90"
                >
                  {deleting ? "Deleting…" : "Delete my account"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppFrame>
  );
}

