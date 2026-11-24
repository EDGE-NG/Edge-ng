"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

const URL_ERRORS: Record<string, string> = {
  expired: "This reset link has expired or was opened on another device. Request a new one.",
};

const noSubscribe = () => () => {};
const readUrlError = () =>
  URL_ERRORS[new URLSearchParams(window.location.search).get("error") ?? ""] ?? "";

function EdgeMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 54 44" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="em-fp-g" x1="0" y1="0" x2="54" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5ef088" />
          <stop offset="1" stopColor="#dcff3c" />
        </linearGradient>
      </defs>
      <rect x="14" y="2" width="40" height="9" rx="4.5" fill="url(#em-fp-g)" />
      <rect x="7" y="17" width="40" height="9" rx="4.5" fill="url(#em-fp-g)" />
      <rect y="32" width="40" height="9" rx="4.5" fill="url(#em-fp-g)" />
    </svg>
  );
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const urlError = useSyncExternalStore(noSubscribe, readUrlError, () => "");
  const shownError = error || urlError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email) return;
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to send reset link. Try again later.");
      }

      setSent(true);
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
        <section className="glass-panel w-full max-w-[460px] p-7 sm:p-9 fade-up" aria-labelledby="fp-h">
          <h1 id="fp-h" className="text-[2rem] leading-tight font-semibold text-ink">
            Reset your <span className="lime">password.</span>
          </h1>
          <p className="mt-2 text-[0.95rem] text-muted">
            Enter the email address tied to your account and we&apos;ll send you a recovery link.
          </p>

          {sent ? (
            <div className="mt-7 space-y-5">
              <div className="rounded-xl border border-pass/40 bg-pass-bg p-4 text-sm text-pass">
                <p className="font-semibold">✓ Check your inbox</p>
                <p className="mt-1 text-ink/85 leading-relaxed">
                  If an account exists for <strong className="text-ink">{email}</strong>, we sent a password reset link. Open the link to create a new password.
                </p>
              </div>

              <div className="pt-2">
                <Link
                  href="/login"
                  className="btn btn-main w-full justify-center"
                >
                  Return to sign in
                </Link>
              </div>

              <p className="text-center text-xs text-muted">
                Didn&apos;t receive the email? Check your spam folder or{" "}
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className="text-accent underline hover:text-accent/80"
                >
                  try again
                </button>
                .
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  className="input"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              {shownError && (
                <p role="alert" className="rounded-xl border border-fail/40 bg-err-bg px-3.5 py-2.5 text-sm text-fail">
                  {shownError}
                </p>
              )}

              <button
                type="submit"
                className="btn btn-main w-full justify-center"
                disabled={busy || !email.trim()}
              >
                {busy ? "Sending reset link…" : "Send reset link"}
              </button>

              <p className="pt-3 text-center text-xs text-muted">
                Remember your password?{" "}
                <Link href="/login" className="text-accent hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
