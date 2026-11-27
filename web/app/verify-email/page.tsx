"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import EdgeMark from "@/app/_components/edge-mark";

/**
 * Mask an email address to format: h***@example.com (matching Figma screen 2).
 */
function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "your email";
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const first = local.charAt(0);
  return `${first}***@${domain}`;
}

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawEmail = searchParams.get("email") || "";
  const email = rawEmail.trim().toLowerCase();
  const from = searchParams.get("from") || "/checklist";

  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [timer, setTimer] = useState(60);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const errorId = useId();
  const noticeId = useId();

  // Focus the first input on initial mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Resend countdown timer
  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => {
      setTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const isComplete = digits.every((d) => d.length === 1 && /^\d$/.test(d));
  const fullCode = digits.join("");

  async function handleVerify(codeToSubmit?: string) {
    const code = codeToSubmit ?? fullCode;
    if (code.length !== 6 || busy) return;
    if (!email) {
      setError("Email address is missing. Please sign up or sign in again.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "The code is incorrect or has expired.");
      }

      // Successful verification: redirect to destination
      router.push(from);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Try again.");
      setBusy(false);
    }
  }

  function handleDigitChange(index: number, val: string) {
    // Only accept numeric digits
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
        // Last digit entered, verify if all filled
        const allCode = next.join("");
        if (allCode.length === 6) {
          handleVerify(allCode);
        }
      }
    } else {
      // Multiple digits (e.g. autofill or quick paste into single field)
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
        handleVerify(next.join(""));
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
      handleVerify(numericChars);
    }
  }

  async function handleResend() {
    if (timer > 0 || resending) return;
    if (!email) {
      setError("Email address is missing. Please sign up again.");
      return;
    }

    setResending(true);
    setError("");
    setNotice("");

    try {
      const res = await fetch("/api/auth/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.alreadyConfirmed) {
          router.push("/login");
          return;
        }
        throw new Error(data.error || "Failed to resend code. Please try again.");
      }

      setNotice(data.message || "A new 6-digit code has been sent.");
      setTimer(60);
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code.");
    } finally {
      setResending(false);
    }
  }

  const masked = maskEmail(email);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12 sm:px-6">
      {/* Top branding: Edge mark + Edge text */}
      <div className="mb-8 flex items-center justify-center gap-2.5">
        <EdgeMark className="h-8 w-10" />
        <span className="text-xl font-bold tracking-tight text-ink">Edge</span>
      </div>

      {/* Main card matching Figma Screen 2 */}
      <section
        className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-7 sm:p-9 shadow-sm"
        aria-labelledby="verify-heading"
      >
        <h1 id="verify-heading" className="text-2xl font-bold tracking-tight text-ink sm:text-[1.65rem]">
          Check your email
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          We sent a 6 digit code to <span className="font-medium text-ink">{masked}</span>. It expires in 10 minutes.
        </p>

        {/* Status Alerts */}
        {error && (
          <p
            id={errorId}
            role="alert"
            className="mt-4 rounded-xl border border-fail/40 bg-err-bg px-3.5 py-2.5 text-sm text-fail"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            id={noticeId}
            role="status"
            className="mt-4 rounded-xl border border-accent/40 bg-pass-bg px-3.5 py-2.5 text-sm text-accent"
          >
            {notice}
          </p>
        )}

        {/* 6 Digit Inputs */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleVerify();
          }}
          className="mt-7"
        >
          <div
            className="grid grid-cols-6 gap-2 sm:gap-2.5"
            role="group"
            aria-label="6 digit verification code"
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
                aria-describedby={error ? errorId : notice ? noticeId : undefined}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={handlePaste}
                onFocus={(e) => e.target.select()}
                className="h-13 sm:h-15 w-full rounded-xl border border-line bg-surface text-center text-2xl font-semibold text-ink shadow-xs transition outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            ))}
          </div>

          {/* Primary Action Button */}
          <button
            type="submit"
            disabled={!isComplete || busy}
            className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-[#0f824e] text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c6b40] dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Verifying…" : "Verify email"}
          </button>
        </form>

        {/* Resend Timer / Action */}
        <div className="mt-5 text-center">
          {timer > 0 ? (
            <p className="text-xs sm:text-sm text-muted">
              You can ask for a new code in 0:{timer.toString().padStart(2, "0")}
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="text-xs sm:text-sm font-medium text-accent underline-offset-4 hover:underline disabled:opacity-50 cursor-pointer"
            >
              {resending ? "Sending code…" : "Resend code"}
            </button>
          )}
        </div>

        {/* Use a different email */}
        <div className="mt-3 text-center">
          <Link
            href="/signup"
            className="text-xs sm:text-sm font-medium text-muted hover:text-ink transition underline-offset-4 hover:underline"
          >
            Use a different email
          </Link>
        </div>
      </section>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <div className="text-sm text-muted">Loading…</div>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
