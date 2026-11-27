"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppFrame from "../../_components/app-frame";
import Dropdown from "../../_components/dropdown";
import {
  IconBell,
  IconCheck,
  IconCheckCircle,
  IconCreditCard,
  IconDatabase,
  IconLogout,
  IconMonitor,
  IconMoon,
  IconShield,
  IconSmartphone,
  IconSun,
  IconTrash,
  IconUser,
  IconX,
} from "../../_components/icons";
import { ChangePasswordModal, ConfirmItIsYouModal } from "./security-modals";
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

type SettingsTab = "profile" | "security" | "notifications" | "billing" | "privacy";

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: <IconUser className="h-4 w-4" /> },
  { id: "security", label: "Security", icon: <IconShield className="h-4 w-4" /> },
  { id: "notifications", label: "Notifications", icon: <IconBell className="h-4 w-4" /> },
  { id: "billing", label: "Plan and billing", icon: <IconCreditCard className="h-4 w-4" /> },
  { id: "privacy", label: "Data and privacy", icon: <IconDatabase className="h-4 w-4" /> },
];

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Lagos",
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
  const [tab, setTab] = useState<SettingsTab>("profile");

  // Profile Form State
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [preferredMarkets, setPreferredMarkets] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  const [initialProfile, setInitialProfile] = useState<{
    displayName: string;
    timezone: string;
    preferredMarkets: string[];
    avatarUrl: string | null;
    theme: Theme;
  } | null>(null);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Delete Account State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sessions & Sign Out State
  const [signingOut, setSigningOut] = useState(false);
  const [showSignOutOthersModal, setShowSignOutOthersModal] = useState(false);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  // Export State
  const [exporting, setExporting] = useState(false);

  // Change Password Flow State (Task M6: Figma 80, 82, 83)
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [showChangePwModal, setShowChangePwModal] = useState(false);
  const [verifiedPassword, setVerifiedPassword] = useState("");
  const [passwordChangedBanner, setPasswordChangedBanner] = useState(false);

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
            const loadedName = data.user.displayName || "";
            const loadedTz = data.user.timezone || "UTC";
            const loadedMarkets = data.user.preferredMarkets || [];
            const loadedAvatar = data.user.avatarUrl || null;
            const loadedTheme: Theme = data.user.theme ? (data.user.theme as Theme) : getStoredTheme();

            setEmail(data.user.email || "");
            setDisplayName(loadedName);
            setTimezone(loadedTz);
            setPreferredMarkets(loadedMarkets);
            setAvatarUrl(loadedAvatar);
            setTheme(loadedTheme);
            applyTheme(loadedTheme);

            setInitialProfile({
              displayName: loadedName,
              timezone: loadedTz,
              preferredMarkets: loadedMarkets,
              avatarUrl: loadedAvatar,
              theme: loadedTheme,
            });

            if (loadedAvatar) {
              try {
                localStorage.setItem("edge-user-avatar", loadedAvatar);
              } catch {}
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

  function handleCancelProfile() {
    if (!initialProfile) return;
    setDisplayName(initialProfile.displayName);
    setTimezone(initialProfile.timezone);
    setPreferredMarkets(initialProfile.preferredMarkets);
    setAvatarUrl(initialProfile.avatarUrl);
    setTheme(initialProfile.theme);
    applyTheme(initialProfile.theme);
    toast.info("Changes discarded.");
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
        setInitialProfile({ displayName, timezone, preferredMarkets, avatarUrl, theme });
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
        const when = d.dueAt
          ? new Date(d.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
          : "in 14 days";
        try {
          localStorage.removeItem("edge-user-profile");
          localStorage.removeItem("edge-user-avatar");
        } catch {}
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

  const otherDevices = sessions.filter((s) => !s.isCurrent);

  return (
    <AppFrame active="settings" title="Settings">
      <div className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6">
        {/* Page Header (Figma 76 / 79 / 87) */}
        <header className="mb-7">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Settings</h2>
          <p className="mt-1 text-sm text-muted">
            Manage your account, security and how Edge contacts you.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[210px_1fr] lg:items-start">
          {/* Left Navigation Tabs */}
          <nav
            aria-label="Settings sections"
            className="flex gap-1 overflow-x-auto pb-2 scrollbar-none lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-sm transition ${
                    active
                      ? "bg-panel font-medium text-ink shadow-2xs ring-1 ring-line"
                      : "text-muted hover:bg-panel/50 hover:text-ink"
                  }`}
                >
                  <span className={active ? "text-ink" : "text-muted"}>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Tab Content */}
          <div className="min-w-0 space-y-6">
            {/* Tab 1: Profile (Figma 76) */}
            {tab === "profile" && (
              <>
                <section className="card p-6 sm:p-8">
                  <div>
                    <h3 className="text-base font-semibold text-ink">Profile</h3>
                    <p className="mt-0.5 text-xs text-muted">How you appear in Edge.</p>
                  </div>

                  {loading ? (
                    <div className="py-8 text-xs text-muted">Loading profile…</div>
                  ) : (
                    <form onSubmit={handleSaveProfile} className="mt-6 space-y-6">
                      {/* Avatar + Name + Email Summary */}
                      <div className="flex items-center gap-4">
                        <label
                          className="group relative flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1 ring-line transition hover:ring-accent/70"
                          title="Click to upload profile photo"
                        >
                          {avatarUrl ? (
                            <img
                              src={avatarUrl}
                              alt="Profile photo"
                              className="h-full w-full object-cover transition group-hover:opacity-75"
                            />
                          ) : (
                            <span className="grid h-full w-full place-items-center bg-accent/15 text-lg font-semibold text-accent">
                              {(displayName || email || "T").trim().charAt(0).toUpperCase()}
                            </span>
                          )}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100">
                            <span className="text-[10px] font-medium text-white">
                              {uploadingAvatar ? "…" : "Edit"}
                            </span>
                          </div>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={handleAvatarFile}
                            className="hidden"
                          />
                        </label>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-ink">
                            {displayName || "Trader"}
                          </div>
                          <div className="truncate text-xs text-muted">{email}</div>
                          {avatarUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                setAvatarUrl(null);
                                toast.info("Profile photo cleared. Click 'Save changes' to apply.", { duration: 3000 });
                              }}
                              className="mt-1 text-[11px] font-medium text-fail hover:underline"
                            >
                              Remove photo
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 2x2 Grid: Full name, Email, Time zone, Preferred market */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="profile-name" className="block text-xs font-medium text-ink">
                            Full name
                          </label>
                          <input
                            id="profile-name"
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Your name"
                            className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <label htmlFor="profile-email" className="block text-xs font-medium text-ink">
                              Email
                            </label>
                            <span className="text-[11px] font-medium text-muted" title="Email change coming in M7">
                              Verified
                            </span>
                          </div>
                          <div className="mt-1.5 flex h-10 items-center justify-between rounded-xl border border-line bg-panel/60 px-3">
                            <input
                              id="profile-email"
                              type="email"
                              disabled
                              value={email}
                              className="w-full bg-transparent text-sm text-muted cursor-not-allowed focus:outline-none"
                            />
                            <span className="ml-2 shrink-0 rounded-full border border-pass/30 bg-pass-bg px-2 py-0.5 text-[10px] font-medium text-pass">
                              Verified
                            </span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-ink">Time zone</label>
                          <div className="mt-1.5">
                            <Dropdown
                              value={timezone}
                              onChange={setTimezone}
                              options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                              className="w-full"
                              ariaLabel="Time zone"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-ink">Preferred market</label>
                          <div className="mt-2 space-y-1.5">
                            {MARKETS.map((m) => {
                              const checked = preferredMarkets.includes(m.id);
                              return (
                                <label
                                  key={m.id}
                                  className="flex cursor-pointer items-center gap-2 text-xs text-ink/90"
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
                      </div>

                      {/* Interface Theme */}
                      <div className="border-t border-line pt-5">
                        <label className="block text-xs font-medium text-ink">Interface Theme</label>
                        <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          {[
                            {
                              id: "dark" as const,
                              title: "Dark mode",
                              icon: <IconMoon className="h-4 w-4 text-accent" />,
                            },
                            {
                              id: "light" as const,
                              title: "Light mode",
                              icon: <IconSun className="h-4 w-4 text-amber-500" />,
                            },
                            {
                              id: "system" as const,
                              title: "System default",
                              icon: <IconMonitor className="h-4 w-4 text-muted" />,
                            },
                          ].map((opt) => {
                            const selected = theme === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => handleSelectTheme(opt.id)}
                                className={`flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition ${
                                  selected
                                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                                    : "border-line bg-surface/50 hover:bg-surface"
                                }`}
                              >
                                <span className="flex items-center gap-2 text-xs font-medium text-ink">
                                  {opt.icon}
                                  {opt.title}
                                </span>
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    selected ? "bg-accent ring-2 ring-accent/30" : "bg-line"
                                  }`}
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2.5 border-t border-line pt-5">
                        <button
                          type="button"
                          onClick={handleCancelProfile}
                          disabled={saving}
                          className="h-9 cursor-pointer rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={saving}
                          className="h-9 cursor-pointer rounded-xl bg-[#0f824e] px-4 text-xs font-semibold text-white transition hover:bg-[#0c6b40] disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
                        >
                          {saving ? "Saving…" : "Save changes"}
                        </button>
                      </div>
                    </form>
                  )}
                </section>

                {/* This device card (Figma 76) */}
                <section className="card p-6 sm:p-7">
                  <h3 className="text-base font-semibold text-ink">This device</h3>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-medium text-ink">Sign out</div>
                      <p className="text-xs text-muted">Sign out of Edge on this device.</p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        setSigningOut(true);
                        if (!(await signOut(router))) setSigningOut(false);
                      }}
                      disabled={signingOut}
                      className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel disabled:opacity-60"
                    >
                      <IconLogout className="h-3.5 w-3.5" />
                      {signingOut ? "Signing out…" : "Sign out"}
                    </button>
                  </div>
                </section>
              </>
            )}

            {/* Tab 2: Security (Figma 80, 82, 83, 87) */}
            {tab === "security" && (
              <>
                {passwordChangedBanner && (
                  <div
                    role="status"
                    className="flex items-start justify-between gap-3 rounded-2xl border border-pass/35 bg-pass-bg px-5 py-4"
                  >
                    <div className="flex items-start gap-3">
                      <IconCheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-pass" />
                      <div>
                        <div className="text-sm font-semibold text-ink">Password changed</div>
                        <p className="mt-0.5 text-xs text-muted">
                          We signed you out of your other devices and sent you an email.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPasswordChangedBanner(false)}
                      className="cursor-pointer text-muted hover:text-ink"
                      aria-label="Dismiss"
                    >
                      <IconX className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <section className="card p-6 sm:p-8">
                  <div>
                    <h3 className="text-base font-semibold text-ink">Sign in and two-step login</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      Two-step login is required for every Edge account. It cannot be turned off.
                    </p>
                  </div>

                  <div className="mt-6 divide-y divide-line">
                    <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-medium text-ink">Password</div>
                        <p className="text-xs text-muted">Keep your account protected with a strong password.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setVerifiedPassword("");
                          setShowReauthModal(true);
                        }}
                        className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface px-3.5 text-xs font-medium text-ink transition hover:bg-panel"
                      >
                        Change password
                      </button>
                    </div>

                    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-medium text-ink">Authenticator app</div>
                        <p className="text-xs text-muted">Use a 6-digit code from your authenticator app.</p>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="rounded-full border border-pass/30 bg-pass-bg px-2.5 py-0.5 text-[11px] font-medium text-pass">
                          On
                        </span>
                        <Link
                          href="/two-step"
                          className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface px-3.5 text-xs font-medium text-ink transition hover:bg-panel"
                        >
                          Change authenticator
                        </Link>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-medium text-ink">Backup codes</div>
                        <p className="text-xs text-muted">Single-use codes if you lose your phone.</p>
                      </div>
                      <Link
                        href="/two-step"
                        className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface px-3.5 text-xs font-medium text-ink transition hover:bg-panel"
                      >
                        View codes
                      </Link>
                    </div>
                  </div>
                </section>

                {/* Active Devices & Sessions (moved to Security tab per M5 / Figma 87) */}
                <section className="card p-6 sm:p-8" aria-labelledby="signout-title">
                  <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <h3 id="signout-title" className="text-base font-semibold text-ink">
                          Active devices
                        </h3>
                        {sessions.length > 0 && (
                          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                            {sessions.length} {sessions.length === 1 ? "device" : "devices"}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {email ? (
                          <>
                            Signed in as <span className="break-all text-ink">{email}</span>. Manage all devices where Edge is signed in.
                          </>
                        ) : (
                          "Manage all devices and browsers where Edge is signed in."
                        )}
                      </p>
                    </div>

                    {otherDevices.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowSignOutOthersModal(true)}
                        disabled={signingOutOthers || signingOut}
                        className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-xs font-medium text-ink transition hover:bg-panel disabled:opacity-60"
                      >
                        Sign out all other devices
                      </button>
                    )}
                  </div>

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
                              {s.isMobile ? (
                                <IconSmartphone className="h-4 w-4" />
                              ) : (
                                <IconMonitor className="h-4 w-4" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-medium text-ink">{s.device}</span>
                                {s.isCurrent && (
                                  <span className="inline-flex items-center gap-1.5 rounded-full border border-pass/30 bg-pass-bg px-2 py-0.5 text-[10px] font-semibold text-pass">
                                    This device
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-muted">
                                {s.isCurrent ? (
                                  <span className="font-medium text-accent">Active now</span>
                                ) : (
                                  <>
                                    Last active{" "}
                                    {new Date(s.lastActive).toLocaleDateString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
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
                                className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink transition hover:bg-panel disabled:opacity-60"
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
                                className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-ink transition hover:border-fail/40 hover:text-fail disabled:opacity-50"
                              >
                                {revokingSessionId === s.id ? "Signing out…" : "Sign out"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </>
            )}

            {/* Tab 3: Notifications */}
            {tab === "notifications" && (
              <section className="card p-6 sm:p-8">
                <h3 className="text-base font-semibold text-ink">Notifications</h3>
                <p className="mt-1 text-xs text-muted">
                  Choose how Edge contacts you about trade checks, alerts, and account security.
                </p>
                <div className="mt-5 rounded-xl border border-line bg-panel/40 p-4 text-xs text-muted">
                  Notification delivery preferences and email alerts are managed in{" "}
                  <Link href="/app/alerts" className="font-medium text-accent hover:underline">
                    Alerts
                  </Link>
                  . Detailed per-channel toggles will appear here soon.
                </div>
              </section>
            )}

            {/* Tab 4: Plan and billing */}
            {tab === "billing" && (
              <section className="card p-6 sm:p-8">
                <h3 className="text-base font-semibold text-ink">Plan and billing</h3>
                <p className="mt-1 text-xs text-muted">
                  Current membership plan and feature access.
                </p>

                <div className="mt-6 rounded-xl border border-accent/30 bg-card-a p-5">
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

                <div className="mt-5 rounded-xl border border-line bg-panel p-4 text-xs text-muted">
                  <p>
                    <strong>Note on Billing:</strong> Paid membership tiers and payment processing will be added here
                    once billing is enabled.
                  </p>
                </div>
              </section>
            )}

            {/* Tab 5: Data and privacy (Figma 79) */}
            {tab === "privacy" && (
              <>
                <section className="card p-6 sm:p-8">
                  <h3 className="text-base font-semibold text-ink">Your data</h3>

                  <div className="mt-5 divide-y divide-line">
                    <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-medium text-ink">Export your data</div>
                        <p className="mt-0.5 text-xs text-muted">
                          Your journal, checklists and examples, downloaded as JSON.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleDownloadExport}
                        disabled={exporting}
                        className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel disabled:opacity-50"
                      >
                        {exporting ? "Preparing export…" : "Export data"}
                      </button>
                    </div>

                    <div className="pt-5">
                      <div className="text-sm font-medium text-ink">What Edge keeps</div>
                      <p className="mt-0.5 text-xs text-muted">
                        Journal entries stay until you delete your account. Edge never stores your broker password.
                      </p>
                    </div>
                  </div>
                </section>

                <section className="card border-fail/30 bg-err-bg/15 p-6 sm:p-8">
                  <h3 className="text-base font-semibold text-ink">Delete account</h3>
                  <p className="mt-1 text-xs text-muted">
                    Deletes your journal, checklists and examples after 14 days. You can cancel during that time.
                  </p>
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(true)}
                      className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-fail/35 bg-fail/10 px-4 text-xs font-medium text-fail transition hover:bg-fail/20"
                    >
                      Delete account
                    </button>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>

        {/* Sign Out Other Devices Modal (Figma 87) */}
        {showSignOutOthersModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-base font-semibold text-ink">Sign out of all other devices?</h4>
                  <p className="mt-1 text-xs text-muted">
                    {otherDevices.length}{" "}
                    {otherDevices.length === 1 ? "device will be signed out." : "devices will be signed out."} This
                    device stays signed in.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSignOutOthersModal(false)}
                  className="cursor-pointer text-muted hover:text-ink"
                  aria-label="Close"
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 max-h-52 space-y-2 overflow-y-auto">
                {otherDevices.map((d) => (
                  <div key={d.id} className="rounded-xl border border-line bg-panel/40 px-3.5 py-2.5">
                    <div className="text-xs font-medium text-ink">{d.device}</div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {d.ip ? `${d.ip} · ` : ""}
                      Active{" "}
                      {new Date(d.lastActive).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowSignOutOthersModal(false)}
                  className="h-9 cursor-pointer rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel"
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
                    if (ok) {
                      setSessions((prev) => prev.filter((item) => item.isCurrent));
                      setShowSignOutOthersModal(false);
                    }
                  }}
                  className="h-9 cursor-pointer rounded-xl bg-[#0f824e] px-4 text-xs font-semibold text-white transition hover:bg-[#0c6b40] disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
                >
                  {signingOutOthers
                    ? "Signing out…"
                    : `Sign out ${otherDevices.length} ${otherDevices.length === 1 ? "device" : "devices"}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm It Is You Modal (Figma 82) */}
        {showReauthModal && (
          <ConfirmItIsYouModal
            onClose={() => setShowReauthModal(false)}
            onConfirmed={(pw) => {
              setVerifiedPassword(pw);
              setShowReauthModal(false);
              setShowChangePwModal(true);
            }}
          />
        )}

        {/* Change Password Modal (Figma 83) */}
        {showChangePwModal && (
          <ChangePasswordModal
            initialCurrentPassword={verifiedPassword}
            onClose={() => {
              setShowChangePwModal(false);
              setVerifiedPassword("");
            }}
            onChanged={() => {
              setShowChangePwModal(false);
              setVerifiedPassword("");
              setPasswordChangedBanner(true);
              setSessions((prev) => prev.filter((item) => item.isCurrent));
            }}
          />
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-semibold text-fail">Confirm Account Deletion</h4>
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="cursor-pointer text-muted hover:text-ink"
                  aria-label="Close"
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
                className="mt-3 w-full rounded-xl border border-line bg-panel px-3 py-2 font-mono text-xs text-ink focus:border-fail focus:outline-none"
              />

              {deleteError && <div className="mt-2 text-xs text-fail">{deleteError}</div>}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="h-9 cursor-pointer rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteConfirmation !== "DELETE" || deleting}
                  onClick={handleDeleteAccount}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-fail px-4 text-xs font-semibold text-white transition hover:bg-fail/90 disabled:opacity-40"
                >
                  <IconTrash className="h-3.5 w-3.5" />
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
