"use client";

/**
 * Record a short voice note and get back its transcript (via /api/transcribe).
 * The caller shows the text for correction before using it (PR-CH-3, PR-EV-2).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "recording" | "transcribing";

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export function useVoiceNote(onText: (text: string, lowConfidence: boolean) => void, maxSeconds = 120) {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  useEffect(() => {
    const ok = Boolean(navigator.mediaDevices?.getUserMedia) && pickMime() !== undefined;
    const id = requestAnimationFrame(() => setSupported(ok));
    return () => cancelAnimationFrame(id);
  }, []);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelled.current = true;
      if (rec.current?.state === "recording") rec.current.stop();
      cleanup();
    },
    [cleanup]
  );

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    setError("");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Edge can't use your microphone. Allow access in your browser, or type the note.");
      return;
    }
    const mime = pickMime();
    const mr = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    rec.current = mr;
    chunks.current = [];
    cancelled.current = false;
    mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    mr.onstop = async () => {
      cleanup();
      if (cancelled.current) {
        setState("idle");
        return;
      }
      const blob = new Blob(chunks.current, { type: mr.mimeType || mime || "audio/webm" });
      if (blob.size < 1200) {
        setState("idle");
        setError("That was too short to hear anything.");
        return;
      }
      setState("transcribing");
      try {
        const fd = new FormData();
        fd.append("audio", blob, "voice.webm");
        const res = await fetch("/api/transcribe", { method: "POST", body: fd });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "I couldn't transcribe that. Try again or type it.");
        onTextRef.current(d.text, Boolean(d.lowConfidence));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Transcription failed.");
      } finally {
        setState("idle");
      }
    };
    mr.start(250);
    setSeconds(0);
    setState("recording");
    const t0 = Date.now();
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s >= maxSeconds) stop();
    }, 250);
  }, [cleanup, maxSeconds, stop]);

  return { state, seconds, error, supported, start, stop, cancel };
}
