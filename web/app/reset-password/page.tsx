"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const PASSWORD_MIN = 8;

function EdgeMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 54 44" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="em-rp-g" x1="0" y1="0" x2="54" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5ef088" />
          <stop offset="1" stopColor="#dcff3c" />
        </linearGradient>
      </defs>
      <rect x="14" y="2" width="40" height="9" rx="4.5" fill="url(#em-rp-g)" />
      <rect x="7" y="17" width="40" height="9" rx="4.5" fill="url(#em-rp-g)" />
      <rect y="32" width="40" height="9" rx="4.5" fill="url(#em-rp-g)" />
    </svg>
  );
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (alive) {
          setIsAuthenticated(res.ok);
        }
      } catch {
        if (alive) setIsAuthenticated(false);
      } finally {
        if (alive) setCheckingAuth(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");

    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to update password. Please try again.");
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/checklist");
        router.refresh();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="theme-dark auth-scene flex min-h-dvh flex-col">
      <div className="fx blob l" aria-hidden="true" />
      <div className="fx blob t" aria-hidden="true" />
      <svg
        className="fx rings"
        viewBox="0 0 1200 700"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <circle cx="380" cy="350" r="330" />
        <circle cx="820" cy="350" r="330" />
        <circle className="run" cx="380" cy="350" r="330" />
      </svg>

      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link href="/" className="inline-flex items-center gap-2.5 text-xl font-semibold tracking-[-0.04em]">
          <EdgeMark className="h-9 w-11" />
          Edge
        </Link>
        <Link href="/login" className="text-sm text-muted hover:text-ink">
          ← Back to sign in
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-5 py-10">
        <section className="glass-panel w-full max-w-[460px] p-7 sm:p-9 fade-up" aria-labelledby="rp-h">
          <h1 id="rp-h" className="text-[2rem] leading-tight font-semibold text-ink">
            Set new <span className="lime">password.</span>
          </h1>
          <p className="mt-2 text-[0.95rem] text-muted">
            Choose a strong password with at least {PASSWORD_MIN} characters.
          </p>

          {checkingAuth ? (
            <div className="mt-8 flex items-center justify-center py-6 text-sm text-muted">
              Verifying your recovery link…
            </div>
          ) : !isAuthenticated && !success ? (
            <div className="mt-7 space-y-5">
              <div className="rounded-xl border border-fail/40 bg-err-bg p-4 text-sm text-fail">
                <p className="font-semibold">Invalid or expired link</p>
                <p className="mt-1 text-ink/80 leading-relaxed">
                  This password reset link is invalid or has expired. Please request a new link to reset your password.
                </p>
              </div>

              <Link
                href="/forgot-password"
                className="btn btn-main w-full justify-center"
              >
                Request a new link
              </Link>
            </div>
          ) : success ? (
            <div className="mt-7 space-y-4">
              <div className="rounded-xl border border-pass/40 bg-pass-bg p-4 text-sm text-pass">
                <p className="font-semibold">✓ Password updated</p>
                <p className="mt-1 text-ink/85 leading-relaxed">
                  Your password has been changed successfully. Redirecting you to your workspace…
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-ink">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="new-password"
                    className="input pr-16"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={PASSWORD_MIN}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter new password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute inset-y-0 right-2 my-auto h-8 rounded-full px-3 text-xs text-muted hover:text-ink"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-muted">At least {PASSWORD_MIN} characters.</p>
              </div>

              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-ink">
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  className="input"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-fail/40 bg-err-bg px-3.5 py-2.5 text-sm text-fail">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="btn btn-main w-full justify-center"
                disabled={busy || !password || !confirmPassword}
              >
                {busy ? "Updating password…" : "Update password"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
