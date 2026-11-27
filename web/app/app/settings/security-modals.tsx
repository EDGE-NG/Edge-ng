"use client";

import { useState } from "react";
import { IconCheckCircle, IconX } from "../../_components/icons";
import { handleSessionExpired } from "@/lib/client-auth";

/**
 * Figma 82: "Confirm it is you" modal.
 * Reusable re-authentication gate for sensitive Security & Profile actions (M6, M7, M8).
 */
export function ConfirmItIsYouModal({
  onClose,
  onConfirmed,
}: {
  onClose: () => void;
  onConfirmed: (verifiedPassword: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reauthenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, code: code.trim(), mode }),
      });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not verify your identity.");
      }
      onConfirmed(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify your identity.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 id="reauth-title" className="text-base font-semibold text-ink">
              Confirm it is you
            </h4>
            <p className="mt-1 text-xs text-muted">
              Enter your password and a code from your authenticator app.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-muted hover:text-ink"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="reauth-password" className="block text-xs font-medium text-ink">
              Password
            </label>
            <div className="relative mt-1.5">
              <input
                id="reauth-password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                required
                autoFocus
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                placeholder="Your password"
                className="h-11 w-full rounded-xl border border-line bg-surface px-3.5 pr-16 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute inset-y-0 right-2 my-auto h-7 cursor-pointer rounded-full px-2.5 text-xs font-medium text-[#0f824e] hover:underline dark:text-accent"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="reauth-code" className="block text-xs font-medium text-ink">
              {mode === "totp" ? "6 digit code" : "Backup code"}
            </label>
            <input
              id="reauth-code"
              type="text"
              inputMode={mode === "totp" ? "numeric" : "text"}
              value={code}
              onChange={(e) => {
                const val =
                  mode === "totp"
                    ? e.target.value.replace(/\D/g, "").slice(0, 6)
                    : e.target.value.toUpperCase();
                setCode(val);
                setError("");
              }}
              placeholder={mode === "totp" ? "Enter the code" : "XXXX-XXXX"}
              className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === "totp" ? "backup" : "totp"));
                setCode("");
                setError("");
              }}
              className="mt-2 cursor-pointer text-xs font-medium text-[#0f824e] hover:underline dark:text-accent"
            >
              {mode === "totp" ? "Use a backup code" : "Use authenticator app instead"}
            </button>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-fail/40 bg-err-bg px-3 py-2 text-xs text-fail">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-9 cursor-pointer rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password || busy}
              className="h-9 cursor-pointer rounded-xl bg-[#0f824e] px-4 text-xs font-semibold text-white transition hover:bg-[#0c6b40] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
            >
              {busy ? "Confirming…" : "Confirm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Figma 83: "Change your password" modal.
 */
export function ChangePasswordModal({
  initialCurrentPassword = "",
  onClose,
  onChanged,
}: {
  initialCurrentPassword?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState(initialCurrentPassword);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mismatch = Boolean(confirmPassword && newPassword !== confirmPassword);
  const tooShort = newPassword.length > 0 && newPassword.length < 12;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }
    if (newPassword.length < 12) {
      setError("New password must be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          password: newPassword,
          minLength: 12,
          signOutOthers: true,
        }),
      });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to change password.");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="change-pw-title">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h4 id="change-pw-title" className="text-base font-semibold text-ink">
            Change your password
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-muted hover:text-ink"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="cp-current" className="block text-xs font-medium text-ink">
              Current password
            </label>
            <div className="relative mt-1.5">
              <input
                id="cp-current"
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setError("");
                }}
                placeholder="Your current password"
                className="h-11 w-full rounded-xl border border-line bg-surface px-3.5 pr-16 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute inset-y-0 right-2 my-auto h-7 cursor-pointer rounded-full px-2.5 text-xs font-medium text-[#0f824e] hover:underline dark:text-accent"
                aria-label={showCurrent ? "Hide current password" : "Show current password"}
              >
                {showCurrent ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="cp-new" className="block text-xs font-medium text-ink">
              New password
            </label>
            <div className="relative mt-1.5">
              <input
                id="cp-new"
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={12}
                autoFocus
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError("");
                }}
                placeholder="Create a new password"
                aria-invalid={tooShort}
                className="h-11 w-full rounded-xl border border-line bg-surface px-3.5 pr-16 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute inset-y-0 right-2 my-auto h-7 cursor-pointer rounded-full px-2.5 text-xs font-medium text-[#0f824e] hover:underline dark:text-accent"
                aria-label={showNew ? "Hide new password" : "Show new password"}
              >
                {showNew ? "Hide" : "Show"}
              </button>
            </div>
            <p className={`mt-1.5 text-xs ${tooShort ? "text-fail" : "text-muted"}`}>
              At least 12 characters. A long phrase works well.
            </p>
          </div>

          <div>
            <label htmlFor="cp-confirm" className="block text-xs font-medium text-ink">
              Confirm new password
            </label>
            <input
              id="cp-confirm"
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError("");
              }}
              placeholder="Repeat the new password"
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "cp-confirm-err" : undefined}
              className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
            />
            {mismatch && (
              <p id="cp-confirm-err" className="mt-1.5 text-xs text-fail">
                Passwords do not match.
              </p>
            )}
          </div>

          {/* Info banner (Figma 83) */}
          <div className="flex items-center gap-2.5 rounded-xl border border-pass/30 bg-pass-bg px-3.5 py-2.5 text-xs text-pass">
            <IconCheckCircle className="h-4 w-4 shrink-0" />
            <span>You will be signed out of your other devices.</span>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-fail/40 bg-err-bg px-3 py-2 text-xs text-fail">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-9 cursor-pointer rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!currentPassword || newPassword.length < 12 || mismatch || !confirmPassword || busy}
              className="h-9 cursor-pointer rounded-xl bg-[#0f824e] px-4 text-xs font-semibold text-white transition hover:bg-[#0c6b40] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
            >
              {busy ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
