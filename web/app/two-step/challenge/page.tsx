"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import EdgeMark from "@/app/_components/edge-mark";

function TwoStepChallengeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/checklist";

  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [backupCode, setBackupCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const backupRef = useRef<HTMLInputElement | null>(null);
  const errorId = useId();

  useEffect(() => {
    if (mode === "totp") {
      inputRefs.current[0]?.focus();
    } else {
      backupRef.current?.focus();
    }
  }, [mode]);

  const isTotpComplete = digits.every((d) => d.length === 1 && /^\d$/.test(d));
  const isBackupReady = backupCode.replace(/[^a-zA-Z0-9]/g, "").length >= 6;

  async function submitChallenge(codeOverride?: string) {
    if (busy) return;
    const payloadCode =
      mode === "totp" ? (codeOverride ?? digits.join("")) : backupCode.trim();

    if (mode === "totp" && payloadCode.length !== 6) return;
    if (mode === "backup" && !isBackupReady) return;

    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/auth/mfa/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: payloadCode, mode }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error(data.error || "Invalid verification code.");
      }

      router.push(from);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Try again.");
      setBusy(false);
    }
  }

  function handleDigitChange(index: number, val: string) {
    const cleaned = val.replace(/\D/g, "");
    if (!cleaned) {
      const next = [...digits];
      next[index] = "";
      setDigits(next);
      return;
    }

    if (cleaned.length === 1) {
      const next = [...digits];
      next[index] = cleaned;
      setDigits(next);
      setError("");

      if (index < 5) {
        inputRefs.current[index + 1]?.focus();
      } else {
        const allCode = next.join("");
        if (allCode.length === 6) {
          submitChallenge(allCode);
        }
      }
    } else {
      const pasteDigits = cleaned.slice(0, 6).split("");
      const next = [...digits];
      for (let i = 0; i < pasteDigits.length && index + i < 6; i++) {
        next[index + i] = pasteDigits[i];
      }
      setDigits(next);
      setError("");

      const nextFocus = Math.min(index + pasteDigits.length, 5);
      inputRefs.current[nextFocus]?.focus();

      if (next.every((d) => d.length === 1)) {
        submitChallenge(next.join(""));
      }
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (digits[index] === "" && index > 0) {
        e.preventDefault();
        const next = [...digits];
        next[index - 1] = "";
        setDigits(next);
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasteText = e.clipboardData.getData("text");
    const numericChars = pasteText.replace(/\D/g, "").slice(0, 6);
    if (!numericChars) return;

    const next = [...digits];
    const chars = numericChars.split("");
    for (let i = 0; i < chars.length; i++) {
      next[i] = chars[i];
    }
    setDigits(next);
    setError("");

    const targetIndex = Math.min(chars.length, 5);
    inputRefs.current[targetIndex]?.focus();

    if (chars.length === 6) {
      submitChallenge(numericChars);
    }
  }

  function switchMode(nextMode: "totp" | "backup") {
    setMode(nextMode);
    setError("");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12 sm:px-6">
      {/* Top branding: Edge mark + Edge text */}
      <Link href="/" className="mb-8 flex items-center justify-center gap-2.5 outline-none">
        <EdgeMark className="h-8 w-10" />
        <span className="text-xl font-bold tracking-tight text-ink">Edge</span>
      </Link>

      {/* Main card matching Figma Screen 11 */}
      <section
        className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-7 sm:p-9 shadow-sm"
        aria-labelledby="two-step-heading"
      >
        <h1 id="two-step-heading" className="text-2xl font-bold tracking-tight text-ink sm:text-[1.65rem]">
          {mode === "totp" ? "Enter your code" : "Enter a backup code"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {mode === "totp"
            ? "Open your authenticator app and enter the 6 digit code for Edge."
            : "Enter one of the 8-character backup codes you saved when you set up two-step login."}
        </p>

        {error && (
          <p
            id={errorId}
            role="alert"
            className="mt-4 rounded-xl border border-fail/40 bg-err-bg px-3.5 py-2.5 text-sm text-fail"
          >
            {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitChallenge();
          }}
          className="mt-7"
        >
          {mode === "totp" ? (
            <div
              className="grid grid-cols-6 gap-2 sm:gap-2.5"
              role="group"
              aria-label="6 digit authenticator code"
            >
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  aria-label={`Digit ${i + 1} of 6`}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={handlePaste}
                  onFocus={(e) => e.target.select()}
                  className="h-13 sm:h-15 w-full rounded-xl border border-line bg-surface text-center text-2xl font-semibold text-ink shadow-xs transition outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              ))}
            </div>
          ) : (
            <div>
              <label htmlFor="backup-code-input" className="sr-only">
                Backup code
              </label>
              <input
                ref={backupRef}
                id="backup-code-input"
                type="text"
                value={backupCode}
                onChange={(e) => {
                  setBackupCode(e.target.value.toUpperCase());
                  setError("");
                }}
                placeholder="XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-center font-mono text-lg font-semibold tracking-wider text-ink shadow-xs outline-none transition placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={(mode === "totp" ? !isTotpComplete : !isBackupReady) || busy}
            className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-[#0f824e] text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c6b40] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
          >
            {busy ? "Verifying…" : "Verify and sign in"}
          </button>
        </form>

        <div className="mt-5 text-center">
          {mode === "totp" ? (
            <button
              type="button"
              onClick={() => switchMode("backup")}
              className="cursor-pointer text-xs sm:text-sm font-medium text-[#0f824e] underline-offset-4 hover:underline dark:text-accent"
            >
              Use a backup code
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode("totp")}
              className="cursor-pointer text-xs sm:text-sm font-medium text-[#0f824e] underline-offset-4 hover:underline dark:text-accent"
            >
              Use authenticator app instead
            </button>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-muted">
          We will email you if we see a sign in from a new device.
        </p>
      </section>
    </div>
  );
}

export default function TwoStepChallengePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <div className="text-sm text-muted">Loading…</div>
        </div>
      }
    >
      <TwoStepChallengeContent />
    </Suspense>
  );
}
