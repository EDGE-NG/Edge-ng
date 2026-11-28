"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useState } from "react";
import EdgeMark from "@/app/_components/edge-mark";
import { IconCopy, IconDownload } from "@/app/_components/icons";
import { renderQrSvg } from "@/lib/qr-svg";

function TwoStepContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/checklist";

  const [step, setStep] = useState<"setup" | "backup-codes">("setup");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  // Setup state
  const [secret, setSecret] = useState<string>("");
  const [formattedKey, setFormattedKey] = useState<string>("");
  const [uri, setUri] = useState<string>("");
  const [qrSvg, setQrSvg] = useState<string>("");
  const [factorId, setFactorId] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState(false);

  // Backup codes state
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const errorId = useId();

  // Load MFA setup details on mount
  useEffect(() => {
    async function loadSetup() {
      try {
        const res = await fetch("/api/auth/mfa/setup");
        if (res.status === 401) {
          router.push(`/login?from=${encodeURIComponent("/two-step")}`);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Could not start two-step setup.");
        }

        setSecret(data.secret || "");
        setFormattedKey(data.formattedKey || "");
        setUri(data.uri || "");
        setFactorId(data.factorId || "");

        const svg = renderQrSvg(data.qrCode, data.uri || "");
        setQrSvg(svg);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load setup details.");
      } finally {
        setLoading(false);
      }
    }

    loadSetup();
  }, [router]);

  async function handleCopyKey() {
    if (!formattedKey) return;
    try {
      await navigator.clipboard.writeText(formattedKey.replace(/\s+/g, ""));
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // Fallback
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const cleanCode = code.replace(/\D/g, "").slice(0, 6);
    if (cleanCode.length !== 6 || busy) return;

    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factorId,
          secret,
          code: cleanCode,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Invalid verification code.");
      }

      setBackupCodes(data.backupCodes || []);
      setStep("backup-codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyCodes() {
    if (!backupCodes.length) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    } catch {
      // Fallback
    }
  }

  function handleDownloadCodes() {
    if (!backupCodes.length) return;
    const content = [
      "Edge - Two-Step Login Backup Codes",
      "Generated: " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      "",
      "Keep these backup codes safe. Each code can only be used once if you lose access to your authenticator app.",
      "",
      ...backupCodes.map((c, i) => `${i + 1}. ${c}`),
      "",
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "edge-backup-codes.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleCompleteCodes() {
    setBusy(true);
    try {
      await fetch("/api/auth/mfa/confirm-backup-codes", { method: "POST" });
      router.push(from);
      router.refresh();
    } catch {
      router.push(from);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12 sm:px-6">
      {/* Top branding: Edge mark + Edge text */}
      <Link href="/" className="mb-8 flex items-center justify-center gap-2.5 outline-none">
        <EdgeMark className="h-8 w-10" />
        <span className="text-xl font-bold tracking-tight text-ink">Edge</span>
      </Link>

      {/* Screen 1: Two-step setup (Figma 3) */}
      {step === "setup" && (
        <section
          className="w-full max-w-[460px] rounded-2xl border border-line bg-surface p-7 sm:p-9 shadow-sm"
          aria-labelledby="setup-heading"
        >
          <h1 id="setup-heading" className="text-2xl font-bold tracking-tight text-ink sm:text-[1.65rem]">
            Set up two-step login
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Every Edge account needs it. It protects your account and any broker you connect later.
          </p>

          {/* QR code and ordered steps */}
          <div className="mt-6 flex items-center gap-5 sm:gap-6">
            <div
              className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black p-2 shadow-xs sm:h-36 sm:w-36"
              aria-label="Authenticator QR code"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <ol className="flex flex-col justify-center space-y-2 text-xs leading-relaxed text-ink/90 sm:text-sm">
              <li>1. Open an authenticator app.</li>
              <li>2. Scan this code.</li>
              <li>3. Enter the 6 digit code it shows.</li>
            </ol>
          </div>

          {/* Cannot scan? Enter this key instead */}
          <div className="mt-6">
            <p className="text-xs text-muted">Cannot scan? Enter this key instead</p>
            <div className="mt-2 flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 shadow-xs">
              <span className="font-mono text-sm font-semibold tracking-wider text-ink sm:text-base">
                {formattedKey || "•••• •••• •••• ••••"}
              </span>
              <button
                type="button"
                onClick={handleCopyKey}
                className="cursor-pointer text-xs font-semibold text-[#0f824e] transition hover:underline dark:text-accent sm:text-sm"
              >
                {copiedKey ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* Code input form */}
          <form onSubmit={handleVerify} className="mt-6">
            <label htmlFor="auth-code" className="block text-xs font-medium text-ink sm:text-sm">
              Code from your app
            </label>
            <input
              id="auth-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                setError("");
              }}
              placeholder="6 digit code"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-4 text-base font-medium text-ink shadow-xs outline-none transition placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20"
            />

            {error && (
              <p
                id={errorId}
                role="alert"
                className="mt-3 rounded-xl border border-fail/40 bg-err-bg px-3.5 py-2.5 text-sm text-fail"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={code.length !== 6 || busy}
              className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-[#0f824e] text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c6b40] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
            >
              {busy ? "Verifying…" : "Confirm and continue"}
            </button>
          </form>
        </section>
      )}

      {/* Screen 2: Save backup codes (Figma 4) */}
      {step === "backup-codes" && (
        <section
          className="w-full max-w-[460px] rounded-2xl border border-line bg-surface p-7 sm:p-9 shadow-sm"
          aria-labelledby="backup-heading"
        >
          <h1 id="backup-heading" className="text-2xl font-bold tracking-tight text-ink sm:text-[1.65rem]">
            Save your backup codes
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Use one if you lose your phone. Each code works once. We show them only now, so keep them somewhere you can find them.
          </p>

          {/* 8 Codes in 2 Columns of 4 */}
          <div className="mt-6 rounded-xl border border-line bg-panel/40 p-5 sm:p-6">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-sm font-semibold tracking-wider text-ink sm:text-base">
              <div className="flex flex-col space-y-3">
                {backupCodes.slice(0, 4).map((c, i) => (
                  <span key={i} className="select-all">
                    {c}
                  </span>
                ))}
              </div>
              <div className="flex flex-col space-y-3">
                {backupCodes.slice(4, 8).map((c, i) => (
                  <span key={i} className="select-all">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Copy and Download Buttons */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleCopyCodes}
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-medium text-ink shadow-2xs transition hover:bg-panel"
            >
              <IconCopy className="h-4 w-4" />
              {copiedCodes ? "Copied!" : "Copy codes"}
            </button>
            <button
              type="button"
              onClick={handleDownloadCodes}
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-medium text-ink shadow-2xs transition hover:bg-panel"
            >
              <IconDownload className="h-4 w-4" />
              Download
            </button>
          </div>

          {/* Primary Action Button */}
          <button
            type="button"
            onClick={handleCompleteCodes}
            disabled={busy}
            className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-[#0f824e] text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c6b40] disabled:opacity-50 dark:bg-accent dark:text-[#04110a] dark:hover:brightness-110"
          >
            {busy ? "Saving…" : "I have saved my codes"}
          </button>
        </section>
      )}
    </div>
  );
}

export default function TwoStepPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <div className="text-sm text-muted">Loading…</div>
        </div>
      }
    >
      <TwoStepContent />
    </Suspense>
  );
}
