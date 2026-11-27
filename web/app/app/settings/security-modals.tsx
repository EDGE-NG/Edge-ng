"use client";

import { useEffect, useState } from "react";
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

/**
 * Figma 81: "Change your email" modal.
 * Step 1: New email + current password -> sends 6-digit code to new address.
 * Step 2: Enter 6-digit code -> confirms email change.
 */
export function ChangeEmailModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: (updatedEmail: string) => void;
}) {
  const [step, setStep] = useState<"request" | "verify">("request");
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !currentPassword || busy) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail: newEmail.trim(), currentPassword }),
      });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not send code.");
      }
      setNewEmail(data.newEmail || newEmail.trim().toLowerCase());
      setStep("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    const cleanCode = code.replace(/\D/g, "").slice(0, 6);
    if (cleanCode.length !== 6 || busy) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-email-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, code: cleanCode }),
      });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Invalid verification code.");
      }
      onChanged(data.email || newEmail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-email-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 id="change-email-title" className="text-base font-semibold text-ink">
              {step === "request" ? "Change your email" : "Confirm your new email"}
            </h4>
            <p className="mt-1 text-xs text-muted">
              {step === "request"
                ? "We will send a code to the new address to confirm it."
                : `We sent a 6 digit code to ${newEmail}. Enter it below to finish.`}
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

        {step === "request" ? (
          <form onSubmit={handleSendCode} className="mt-5 space-y-4">
            <div>
              <label htmlFor="ce-new-email" className="block text-xs font-medium text-ink">
                New email
              </label>
              <input
                id="ce-new-email"
                type="email"
                required
                autoFocus
                value={newEmail}
                onChange={(e) => {
                  setNewEmail(e.target.value);
                  setError("");
                }}
                placeholder="new@example.com"
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="ce-password" className="block text-xs font-medium text-ink">
                Current password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="ce-password"
                  type={showPw ? "text" : "password"}
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
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-2 my-auto h-7 cursor-pointer rounded-full px-2.5 text-xs font-medium text-[#0f824e] hover:underline dark:text-accent"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Info banner (Figma 81) */}
            <div className="flex items-center gap-2.5 rounded-xl border border-pass/30 bg-pass-bg px-3.5 py-2.5 text-xs text-pass">
              <IconCheckCircle className="h-4 w-4 shrink-0" />
              <span>Your email only changes after you enter the code.</span>
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
                disabled={!newEmail.trim() || !currentPassword || busy}
                className="h-9 cursor-pointer rounded-xl bg-[#0f824e] px-4 text-xs font-semibold text-white transition hover:bg-[#0c6b40] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
              >
                {busy ? "Sending…" : "Send code"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="mt-5 space-y-4">
            <div>
              <label htmlFor="ce-code" className="block text-xs font-medium text-ink">
                6 digit code
              </label>
              <input
                id="ce-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError("");
                }}
                placeholder="Enter the 6 digit code"
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-center font-mono text-base font-semibold tracking-widest text-ink placeholder:font-sans placeholder:tracking-normal placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:outline-none"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-xl border border-fail/40 bg-err-bg px-3 py-2 text-xs text-fail">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setStep("request");
                  setCode("");
                  setError("");
                }}
                disabled={busy}
                className="cursor-pointer text-xs font-medium text-muted hover:text-ink"
              >
                ← Back
              </button>
              <div className="flex gap-2.5">
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
                  disabled={code.length !== 6 || busy}
                  className="h-9 cursor-pointer rounded-xl bg-[#0f824e] px-4 text-xs font-semibold text-white transition hover:bg-[#0c6b40] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
                >
                  {busy ? "Verifying…" : "Verify and change email"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Figma 84 & 85: "Your backup codes" + "Generate new backup codes?" confirmation modal.
 */
export function BackupCodesModal({
  onClose,
  onUpdated,
}: {
  onClose: () => void;
  onUpdated: (remaining: number, total: number) => void;
}) {
  const [view, setView] = useState<"list" | "confirm-regenerate">("list");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<{ code: string; used: boolean }[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [total, setTotal] = useState(8);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/mfa/backup-codes");
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load backup codes.");
        if (alive) {
          setCodes(data.codes || []);
          setRemaining(data.remaining ?? 0);
          setTotal(data.total ?? 8);
          onUpdated(data.remaining ?? 0, data.total ?? 8);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Could not load backup codes.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [onUpdated]);

  async function handleCopy() {
    const unused = codes.filter((c) => !c.used).map((c) => c.code);
    if (!unused.length) return;
    try {
      await navigator.clipboard.writeText(unused.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  function handleDownload() {
    const lines = codes.map((c, i) => `${i + 1}. ${c.code}${c.used ? " (used)" : ""}`);
    const content = [
      "Edge - Backup Codes",
      `Remaining: ${remaining} of ${total}`,
      "",
      ...lines,
      "",
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "edge-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleRegenerate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/backup-codes", { method: "POST" });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to generate new backup codes.");
      setCodes(data.codes || []);
      setRemaining(data.remaining ?? 8);
      setTotal(data.total ?? 8);
      onUpdated(data.remaining ?? 8, data.total ?? 8);
      setView("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate new backup codes.");
    } finally {
      setBusy(false);
    }
  }

  if (view === "confirm-regenerate") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="regen-title"
      >
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 id="regen-title" className="text-base font-semibold text-ink">
                Generate new backup codes?
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Your {remaining} remaining codes stop working right away. You will see the new codes once, so save
                them before you close the next screen.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setView("list")}
              className="cursor-pointer text-muted hover:text-ink"
              aria-label="Close"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-fail/40 bg-err-bg px-3 py-2 text-xs text-fail">
              {error}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setView("list")}
              disabled={busy}
              className="h-9 cursor-pointer rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={busy}
              className="h-9 cursor-pointer rounded-xl bg-[#0f824e] px-4 text-xs font-semibold text-white transition hover:bg-[#0c6b40] disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
            >
              {busy ? "Generating…" : "Generate new codes"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 id="backup-modal-title" className="text-base font-semibold text-ink">
              Your backup codes
            </h4>
            <p className="mt-1 text-xs text-muted">
              {remaining} of {total} codes left. Each one works once.
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

        {loading ? (
          <div className="py-10 text-center text-xs text-muted">Loading backup codes…</div>
        ) : (
          <>
            <div className="mt-5 rounded-xl border border-line bg-panel/40 p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 font-mono text-sm font-medium tracking-wide">
                {codes.map((item, i) => (
                  <span
                    key={i}
                    className={item.used ? "text-muted/60 line-through" : "text-ink select-all"}
                  >
                    {item.code}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={handleCopy}
                className="h-9 cursor-pointer rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="h-9 cursor-pointer rounded-xl border border-line bg-surface px-4 text-xs font-medium text-ink transition hover:bg-panel"
              >
                Download
              </button>
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-xl border border-fail/40 bg-err-bg px-3 py-2 text-xs text-fail">
                {error}
              </p>
            )}

            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setView("confirm-regenerate")}
                className="cursor-pointer text-xs font-medium text-[#0f824e] hover:underline dark:text-accent"
              >
                Generate new codes
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-9 cursor-pointer rounded-xl bg-[#0f824e] px-5 text-xs font-semibold text-white transition hover:bg-[#0c6b40] dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Figma 86: "Set up a new authenticator" modal.
 */
export function ChangeAuthenticatorModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState("");
  const [secret, setSecret] = useState("");
  const [formattedKey, setFormattedKey] = useState("");
  const [qrSvg, setQrSvg] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/mfa/change-authenticator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not start authenticator setup.");
        if (alive) {
          setFactorId(data.factorId || "");
          setSecret(data.secret || "");
          setFormattedKey(data.formattedKey || "");
          setQrSvg(data.qrSvg || "");
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Could not start setup.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function handleCopyKey() {
    if (!formattedKey) return;
    try {
      await navigator.clipboard.writeText(formattedKey.replace(/\s+/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.replace(/\D/g, "").slice(0, 6);
    if (clean.length !== 6 || busy) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/change-authenticator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", factorId, secret, code: clean }),
      });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Invalid code.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update authenticator.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-auth-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 id="new-auth-title" className="text-base font-semibold text-ink">
              Set up a new authenticator
            </h4>
            <p className="mt-1 text-xs text-muted">
              Your old authenticator stops working once you confirm.
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

        {loading ? (
          <div className="py-10 text-center text-xs text-muted">Generating new authenticator key…</div>
        ) : (
          <form onSubmit={handleConfirm} className="mt-5 space-y-4">
            <div className="flex items-center gap-4">
              <div
                className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black p-1.5"
                aria-label="New authenticator QR code"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <ol className="space-y-1.5 text-xs text-ink/90">
                <li>1. Open your authenticator app.</li>
                <li>2. Scan this code.</li>
                <li>3. Enter the 6 digit code it shows.</li>
              </ol>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-line bg-panel/40 px-3.5 py-2.5">
              <div>
                <div className="text-[11px] text-muted">Cannot scan? Enter this key</div>
                <div className="mt-0.5 font-mono text-xs font-semibold tracking-wider text-ink">
                  {formattedKey}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyKey}
                className="cursor-pointer text-xs font-medium text-[#0f824e] hover:underline dark:text-accent"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <div>
              <label htmlFor="new-auth-code" className="block text-xs font-medium text-ink">
                6 digit code
              </label>
              <input
                id="new-auth-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError("");
                }}
                placeholder="Enter the code"
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
              />
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
                disabled={code.length !== 6 || busy}
                className="h-9 cursor-pointer rounded-xl bg-[#0f824e] px-4 text-xs font-semibold text-white transition hover:bg-[#0c6b40] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
              >
                {busy ? "Confirming…" : "Confirm"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
