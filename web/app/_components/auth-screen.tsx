"use client";

/**
 * Sign in / Sign up (PRD F1). Continues the homepage's emerald hero scene.
 * On success the trader lands on a new, empty chat (PR-CH-1).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import EdgeMark from "./edge-mark";
import { BREACHED_PASSWORD_WARNING, useBreachedPassword } from "./use-breached-password";
import { toast } from "./toaster";

type Mode = "signin" | "signup";

/** Messages for ?error= after "Continue with Google" comes back (see /auth/callback). */
const URL_ERRORS: Record<string, string> = {
  google: "Google sign-in didn't work. Try again, or use your email and password.",
  google_cancelled: "Google sign-in was cancelled.",
  disclaimer: "Tick the box to confirm Edge is decision support, then continue with Google.",
};

const noSubscribe = () => () => {};
const readUrlError = () => URL_ERRORS[new URLSearchParams(window.location.search).get("error") ?? ""] ?? "";

/** Start Google sign-in (/api/auth/google), carrying the disclaimer acceptance and time zone. */
function continueWithGoogle() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // a full page load on purpose: the server route redirects on to Google
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/api/auth/google?accept=1&tz=${encodeURIComponent(tz)}`;
}

export default function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const signup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState("");
  const [exists, setExists] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "submit" | "google">("");
  const breached = useBreachedPassword(password, signup);
  // an error passed back in the URL (Google sign-in); empty on the server
  const urlError = useSyncExternalStore(noSubscribe, readUrlError, () => "");
  const shownError = error || (notice ? "" : urlError);

  // coming back from Google with the browser's Back button restores the page
  // as it was ("Opening Google…"); make the buttons usable again
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy("");
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (signup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy("submit");
    setError("");
    setExists(false);
    setNotice("");
    try {
      const res = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          signup
            ? {
                name,
                email,
                password,
                acceptDisclaimer: accept,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }
            : { email, password }
        ),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d.code === "unconfirmed") {
          router.push(`/verify-email?email=${encodeURIComponent(email)}`);
          return;
        }
        setExists(d.code === "exists");
        throw new Error(d.error || "Something went wrong. Try again.");
      }
      // Email confirmation is on: Supabase sent a 6-digit code (Task M1, Figma 2, PRD F1).
      // signing in within the 14 days cancels a scheduled account deletion (PRD F13)
      if (d.deletionCancelled) toast.success("Welcome back. Your account deletion was cancelled.");
      let destination = "/checklist";
      try {
        const search = new URLSearchParams(window.location.search);
        const from = search.get("from");
        const url = new URL(from ?? "/checklist", window.location.origin);
        if (url.origin === window.location.origin) destination = url.pathname + url.search;
      } catch {
        /* fallback to /checklist */
      }
      if (d.needsConfirmation) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}&from=${encodeURIComponent(destination)}`);
        return;
      }
      router.push(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy("");
    }
  }


  return (
    <div className="theme-dark auth-scene flex flex-col">
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
        <Link href="/" className="text-sm text-muted hover:text-ink">
          ← Back to home
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-5 py-10 lg:grid-cols-[minmax(0,460px)_1fr]">
        <section
          className={`glass-panel w-full fade-up ${signup ? "p-7 sm:p-8" : "p-8 sm:p-9"}`}
          aria-labelledby="auth-h"
        >
          <h1 id="auth-h" className="text-[2rem] leading-tight font-semibold">
            {signup ? (
              <>
                Define your <span className="lime">edge.</span>
              </>
            ) : (
              <>
                Welcome <span className="lime">back.</span>
              </>
            )}
          </h1>
          <p className="mt-2 text-[0.95rem] text-muted">
            {signup
              ? "Create your account, then tell Edge your trading plan. It turns it into a checklist you approve."
              : "Sign in to pick up your edge where you left it."}
          </p>

          <form
            onSubmit={submit}
            className={signup ? "mt-6 space-y-[18px]" : "mt-8 space-y-6"}
            noValidate
          >
            {signup && (
              <Field label="Your name" htmlFor="name" compact>
                <input
                  id="name"
                  className="input h-12 px-4"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What should Edge call you?"
                />
              </Field>
            )}
            <Field label="Email" htmlFor="email" compact={signup}>
              <input
                id="email"
                className="input h-12 px-4"
                type="email"
                autoComplete="email"
                required
                autoFocus={!signup}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field
              label={
                <span className="flex items-center justify-between">
                  <span>Password</span>
                  {!signup && (
                    <Link
                      href="/forgot-password"
                      className="text-xs font-normal text-muted hover:text-accent transition"
                    >
                      Forgot password?
                    </Link>
                  )}
                </span>
              }
              htmlFor="password"
              hint={
                signup
                  ? breached
                    ? BREACHED_PASSWORD_WARNING
                    : "At least 8 characters."
                  : undefined
              }
              hintId={signup && breached ? "password-breach-warning" : undefined}
              hintTone={signup && breached ? "warn" : "muted"}
              compact={signup}
            >
              <div className="relative">
                <input
                  id="password"
                  className="input h-12 px-4 pr-16"
                  type={showPw ? "text" : "password"}
                  autoComplete={signup ? "new-password" : "current-password"}
                  required
                  minLength={signup ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={signup ? "Create a password" : "Your password"}
                  aria-describedby={signup && breached ? "password-breach-warning" : undefined}
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
            </Field>

            {signup && (
              <Field
                label="Confirm password"
                htmlFor="confirm-password"
                compact
                hint={
                  confirmPassword && password !== confirmPassword
                    ? "Passwords do not match."
                    : undefined
                }
                hintId="confirm-password-error"
                hintTone="fail"
              >
                <div className="relative">
                  <input
                    id="confirm-password"
                    className="input h-12 px-4 pr-16"
                    type={showConfirmPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    aria-invalid={Boolean(confirmPassword && password !== confirmPassword)}
                    aria-describedby={
                      confirmPassword && password !== confirmPassword
                        ? "confirm-password-error"
                        : undefined
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw((v) => !v)}
                    className="absolute inset-y-0 right-2 my-auto h-8 rounded-full px-3 text-xs text-muted hover:text-ink"
                    aria-label={showConfirmPw ? "Hide confirm password" : "Show confirm password"}
                  >
                    {showConfirmPw ? "Hide" : "Show"}
                  </button>
                </div>
              </Field>
            )}

            {signup && (
              <label className="flex cursor-pointer items-start gap-3 text-sm text-muted pt-0.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[#5ef088]"
                  checked={accept}
                  onChange={(e) => setAccept(e.target.checked)}
                />
                <span>
                  I understand Edge is decision support, not financial advice. It gives no signals,
                  and I make every trade.
                </span>
              </label>
            )}

            {notice && (
              <p role="status" className="rounded-xl border border-pass/40 bg-pass-bg px-3.5 py-2.5 text-sm text-pass">
                ✓ {notice}
              </p>
            )}
            {shownError && (
              <p role="alert" className="rounded-xl border border-fail/40 bg-err-bg px-3.5 py-2.5 text-sm text-fail">
                {shownError}{" "}
                {exists && (
                  <Link href="/login" className="underline">
                    Sign in
                  </Link>
                )}
              </p>
            )}

            <button
              type="submit"
              className={`btn btn-main w-full ${signup ? "mt-2 min-h-[46px]" : "mt-3 min-h-[48px]"}`}
              disabled={
                busy !== "" ||
                !email ||
                !password ||
                (signup && (!name.trim() || !accept || !confirmPassword))
              }
            >
              {busy === "submit"
                ? signup
                ? "Creating your account…"
                : "Signing in…"
                : signup
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>

          <div
            className={`${signup ? "my-5" : "my-7"} flex items-center gap-3 text-xs text-muted`}
            aria-hidden="true"
          >
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>

          <button
            type="button"
            className={`btn w-full gap-3 border border-line bg-surface text-ink hover:border-accent/50 ${
              signup ? "min-h-[46px]" : "min-h-[48px]"
            }`}
            disabled={busy !== "" || (signup && !accept)}
            onClick={() => {
              setBusy("google");
              continueWithGoogle();
            }}
          >
            <GoogleMark className="h-4.5 w-4.5" />
            {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
          <p className="mt-3 text-center text-xs leading-relaxed text-muted/80">
            {signup
              ? accept
                ? "Google confirms your email, so there's no confirmation link."
                : "Tick the box above first."
              : "By continuing with Google, you confirm Edge is decision support, not financial advice."}
          </p>

          <p className={`${signup ? "mt-5" : "mt-6"} text-center text-sm text-muted`}>
            {signup ? "Already have an account? " : "New to Edge? "}
            <Link href={signup ? "/login" : "/signup"} className="text-ink underline-offset-4 hover:underline">
              {signup ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </section>

        <Preview />
      </main>

      <p className="pb-6 text-center text-xs text-muted">
        Edge is decision support, not financial advice. Trading involves risk.
      </p>
    </div>
  );
}

/** Google's "G" mark, as Google's sign-in branding guidelines ask for. */
function GoogleMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  hintId,
  hintTone = "muted",
  compact,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: string;
  hintId?: string;
  hintTone?: "muted" | "fail" | "warn";
  compact?: boolean;
  children: React.ReactNode;
}) {
  const toneCls =
    hintTone === "fail" ? "text-fail" : hintTone === "warn" ? "text-maybe" : "text-muted";
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className={`${compact ? "mb-1.5" : "mb-2.5"} block text-sm font-medium text-ink`}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p
          id={hintId}
          role={hintTone === "warn" ? "status" : undefined}
          className={`${compact ? "mt-1.5" : "mt-2"} text-xs ${toneCls}`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/** What happens next: the chat turning a plan into a checklist (static). */
function Preview() {
  return (
    <aside className="hidden lg:block" aria-label="What happens after you sign in">
      <p className="mb-5 text-sm uppercase tracking-[0.18em] text-muted">Next: your edge, in your words</p>
      <div className="glass-panel max-w-[520px] p-5">
        <div className="flex items-center justify-between border-b border-hr pb-3 text-xs text-muted">
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#dcff3c]" /> Build an edge
          </span>
          <span>Draft · v1</span>
        </div>
        <div className="mt-4 ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-white/[.06] px-4 py-3 text-sm text-ink">
          I only buy EURUSD in the London session when the 4H trend is up and price pulls back to
          the 20 EMA. Risk 1% max, stop under the swing low.
        </div>
        <div className="mt-4 flex gap-3">
          <EdgeMark className="mt-1 h-5 w-6 shrink-0" />
          <div className="flex-1 space-y-2 text-sm">
            <p className="text-muted">I found 5 rules. One question: how close counts as “at” the 20 EMA?</p>
            {[
              ["Context", "London session only", "Hard gate"],
              ["Context", "4H trend is up", "Hard gate"],
              ["Entry", "Pullback to the 20 EMA", "Soft"],
              ["Risk", "Max 1% risk per trade", "Hard gate"],
              ["Risk", "Stop below the swing low", "Hard gate"],
            ].map(([cat, rule, sev]) => (
              <div key={rule} className="flex items-center justify-between gap-3 border-t border-hr pt-2">
                <span>
                  <span className="mr-2 text-xs text-muted">{cat}</span>
                  {rule}
                </span>
                <span className={`tag ${sev === "Soft" ? "tag-neutral" : "tag-pass"}`}>{sev}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
