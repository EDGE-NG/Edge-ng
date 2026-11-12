"use client";

/**
 * Sign in / Sign up (PRD F1). Continues the homepage's emerald hero scene.
 * On success the trader lands on a new, empty chat (PR-CH-1).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import EdgeMark from "./edge-mark";

type Mode = "signin" | "signup";

export default function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const signup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState("");
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState<"" | "submit">("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("submit");
    setError("");
    setExists(false);
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
        setExists(d.code === "exists");
        throw new Error(d.error || "Something went wrong. Try again.");
      }
      router.push("/checklist");
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

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-5 py-10 lg:grid-cols-[minmax(0,440px)_1fr]">
        <section className="glass-panel w-full p-7 sm:p-8 fade-up" aria-labelledby="auth-h">
          <h1 id="auth-h" className="text-[2rem] leading-tight">
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

          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            {signup && (
              <Field label="Your name" htmlFor="name">
                <input
                  id="name"
                  className="input"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What should Edge call you?"
                />
              </Field>
            )}
            <Field label="Email" htmlFor="email">
              <input
                id="email"
                className="input"
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
              label="Password"
              htmlFor="password"
              hint={signup ? "At least 8 characters." : undefined}
            >
              <div className="relative">
                <input
                  id="password"
                  className="input pr-16"
                  type={showPw ? "text" : "password"}
                  autoComplete={signup ? "new-password" : "current-password"}
                  required
                  minLength={signup ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={signup ? "Create a password" : "Your password"}
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
              <label className="flex cursor-pointer items-start gap-3 text-sm text-muted">
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

            {error && (
              <p role="alert" className="rounded-xl border border-fail/40 bg-err-bg px-3.5 py-2.5 text-sm text-fail">
                {error}{" "}
                {exists && (
                  <Link href="/login" className="underline">
                    Sign in
                  </Link>
                )}
              </p>
            )}

            <button
              type="submit"
              className="btn btn-main w-full"
              disabled={
                busy !== "" || !email || !password || (signup && (!name.trim() || !accept))
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

          <p className="mt-6 text-center text-sm text-muted">
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

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
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
