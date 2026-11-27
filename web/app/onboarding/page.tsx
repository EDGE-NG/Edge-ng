"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Dropdown from "@/app/_components/dropdown";
import EdgeMark from "@/app/_components/edge-mark";
import { IconCheck, IconShield } from "@/app/_components/icons";

const TIMEZONE_OPTIONS = [
  { value: "Africa/Lagos", label: "West Africa Time (Lagos, UTC+1)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
  { value: "Europe/London", label: "London (GMT / BST)" },
  { value: "America/New_York", label: "New York (Eastern Time)" },
  { value: "America/Chicago", label: "Chicago (Central Time)" },
  { value: "America/Los_Angeles", label: "Los Angeles (Pacific Time)" },
  { value: "Europe/Paris", label: "Paris / Berlin (Central European)" },
  { value: "Asia/Dubai", label: "Dubai (Gulf Standard Time)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
];

const MARKET_OPTIONS = [
  { value: "forex", label: "Forex" },
  { value: "crypto", label: "Cryptocurrency" },
  { value: "indices", label: "Indices" },
  { value: "stocks", label: "Stocks" },
  { value: "futures", label: "Futures" },
];

function detectDefaultTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONE_OPTIONS.some((o) => o.value === tz)) return tz;
  } catch {
    /* ignore */
  }
  return "Africa/Lagos";
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/checklist";

  const [step, setStep] = useState<"workspace" | "agreement" | "done">("workspace");
  const [timezone, setTimezone] = useState<string>(() => detectDefaultTimezone());
  const [preferredMarket, setPreferredMarket] = useState<string>("forex");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleAgree() {
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone,
          preferredMarket,
          acceptDisclaimer: true,
        }),
      });
      if (res.status === 401) {
        router.push(`/login?from=${encodeURIComponent("/onboarding")}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not save your preferences.");
      }
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete setup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12 sm:px-6">
      {/* Centered Edge branding */}
      <Link href="/" className="mb-8 flex items-center justify-center gap-2.5 outline-none">
        <EdgeMark className="h-8 w-10" />
        <span className="text-xl font-bold tracking-tight text-ink">Edge</span>
      </Link>

      {/* Step 1: Set up your workspace (Figma 5) */}
      {step === "workspace" && (
        <section
          className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-7 sm:p-9 shadow-sm"
          aria-labelledby="ws-heading"
        >
          <h1 id="ws-heading" className="text-2xl font-bold tracking-tight text-ink sm:text-[1.65rem]">
            Set up your workspace
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Two quick details. You can change them later in Settings.
          </p>

          <div className="mt-6 space-y-5">
            <div>
              <label className="block text-xs font-medium text-ink sm:text-sm">Time zone</label>
              <div className="mt-1.5">
                <Dropdown
                  value={timezone}
                  onChange={setTimezone}
                  options={TIMEZONE_OPTIONS}
                  className="w-full"
                  ariaLabel="Time zone"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted">Used for session times and your journal.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink sm:text-sm">Preferred market</label>
              <div className="mt-1.5">
                <Dropdown
                  value={preferredMarket}
                  onChange={setPreferredMarket}
                  options={MARKET_OPTIONS}
                  className="w-full"
                  ariaLabel="Preferred market"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted">You can trade other markets later.</p>
            </div>

            <button
              type="button"
              onClick={() => setStep("agreement")}
              className="mt-2 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-[#0f824e] text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c6b40] dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* Step 2: Before you start / Agreement (Figma 6) */}
      {step === "agreement" && (
        <section
          className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-7 sm:p-9 shadow-sm"
          aria-labelledby="agree-heading"
        >
          <h1 id="agree-heading" className="text-2xl font-bold tracking-tight text-ink sm:text-[1.65rem]">
            Before you start
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Please read this. Tapping agree confirms you understand it.
          </p>

          <div className="mt-6 rounded-xl border border-pass/30 bg-pass-bg p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <IconShield className="h-4 w-4 shrink-0 text-pass" />
              <span>Edge is decision support</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted sm:text-[13px]">
              Edge checks your trade against the rules you wrote. It does not give financial advice, predict prices or
              promise results. Every trade you place is your decision and your responsibility.
            </p>
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-fail/40 bg-err-bg px-3.5 py-2.5 text-sm text-fail">
              {error}
            </p>
          )}

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={handleAgree}
              disabled={busy}
              className="flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-[#0f824e] text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c6b40] disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
            >
              {busy ? "Saving…" : "Agree and continue"}
            </button>

            <button
              type="button"
              onClick={() => {
                setError("");
                setStep("workspace");
              }}
              disabled={busy}
              className="flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-line bg-surface text-sm font-medium text-ink transition hover:bg-panel disabled:opacity-50"
            >
              Back
            </button>
          </div>

          <p className="mt-4 text-center text-xs text-muted">
            Your acceptance is saved with the date and version.
          </p>
        </section>
      )}

      {/* Step 3: Your account is ready (Figma 7) */}
      {step === "done" && (
        <section
          className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-7 sm:p-9 text-center shadow-sm"
          aria-labelledby="done-heading"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-pass/30 bg-pass-bg text-pass">
            <IconCheck className="h-5 w-5" />
          </div>

          <h1 id="done-heading" className="mt-5 text-2xl font-bold tracking-tight text-ink sm:text-[1.65rem]">
            Your account is ready
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Next, tell Edge your trading plan. Type it or speak it.
          </p>

          <button
            type="button"
            onClick={() => {
              router.push(from);
              router.refresh();
            }}
            className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-[#0f824e] text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c6b40] dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
          >
            Go to Edge
          </button>
        </section>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <div className="text-sm text-muted">Loading…</div>
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
