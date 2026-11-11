"use client";

/**
 * Login: email-code flow (PRD auth). Request a code -> check your email ->
 * enter it -> session cookie -> /app. In dev (no Mailgun configured) the code
 * is shown on screen. Plus one-click demo access to the existing test data.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = "email" | "code";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function requestEmail(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy("send");
    setError("");
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not send the code");
      setSent(true);
      setDevCode(d.dev_code ?? null);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code");
    } finally {
      setBusy("");
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy("verify");
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Verification failed");
      router.push("/app/edge");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy("");
    }
  }

  async function demo() {
    setBusy("demo");
    setError("");
    try {
      const res = await fetch("/api/auth/demo", { method: "POST" });
      if (!res.ok) throw new Error("Demo sign-in failed");
      router.push("/app/edge");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo sign-in failed");
      setBusy("");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <a href="/" className="mb-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/edge-logo.svg" alt="Edge" className="logo-light h-9 w-auto" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/edge-logo-dark.svg" alt="Edge" className="logo-dark h-9 w-auto" />
      </a>

      <div className="card w-full max-w-md space-y-5">
        <div>
          <h1 className="text-2xl tracking-tight">
            {step === "email" ? "Sign in" : "Enter your code"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {step === "email"
              ? "We email you a one-time code. No password to remember."
              : `We sent a 6-digit code to ${email}. It expires in 15 minutes.`}
          </p>
        </div>

        {error && <p className="text-sm text-fail">{error}</p>}

        {devCode && (
          <div className="rounded-xl border border-[rgba(255,200,80,.4)] p-3 text-sm">
            <span className="tag tag-maybe">dev mode</span>
            <p className="mt-2 text-muted">
              Mailgun is not configured, so your code is:{" "}
              <span className="font-mono text-ink">{devCode}</span>
            </p>
          </div>
        )}

        {step === "email" ? (
          <form onSubmit={requestEmail} className="space-y-4">
            <input
              className="input"
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="btn btn-main w-full" disabled={busy === "send"} type="submit">
              {busy === "send" ? "Sending…" : "Email me a login code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <input
              className="input text-center font-mono tracking-[0.4em]"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button
              className="btn btn-main w-full"
              disabled={busy === "verify" || code.length !== 6}
              type="submit"
            >
              {busy === "verify" ? "Verifying…" : "Verify & enter"}
            </button>
            <div className="flex justify-between text-sm">
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setSent(false);
                  setDevCode(null);
                }}
              >
                ← Use a different email
              </button>
              <button
                type="button"
                className="text-muted hover:text-ink"
                disabled={busy === "send"}
                onClick={() => requestEmail()}
              >
                {busy === "send" ? "Resending…" : "Resend code"}
              </button>
            </div>
          </form>
        )}

        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-hr" />
          or
          <span className="h-px flex-1 bg-hr" />
        </div>

        <button className="btn w-full" disabled={busy === "demo"} onClick={demo}>
          {busy === "demo" ? "Signing in…" : "Continue with demo data"}
        </button>
        <p className="text-center text-xs text-muted">
          Explore the app with the example checklists and reviews already loaded.
        </p>
      </div>

      <p className="mt-6 text-xs text-muted">
        Edge is decision support, not financial advice.{" "}
        <a href="/" className="underline hover:text-ink">
          Back to home
        </a>
      </p>
    </div>
  );
}
