"use client";

/**
 * Chat input: type, or record a voice note (PR-CH-3).
 * A recording is transcribed on the server and dropped into the text box for
 * the trader to correct; nothing is sent until they press send.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { IconArrowUp, IconCheck, IconMic, IconX } from "../_components/icons";
import { MAX_MESSAGE_CHARS } from "./types";

const MAX_RECORD_SECONDS = 180;
const BARS = 22;

export interface ComposerHandle {
  focus: () => void;
  setText: (t: string) => void;
}

interface Props {
  onSend: (text: string, viaVoice: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

type RecState = "idle" | "recording" | "transcribing";

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { onSend, disabled, placeholder = "Describe your trading plan…", autoFocus },
  ref
) {
  const [text, setText] = useState("");
  const [viaVoice, setViaVoice] = useState(false);
  const [rec, setRec] = useState<RecState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.08));
  const [notice, setNotice] = useState<{ tone: "info" | "warn" | "error"; text: string } | null>(null);
  const [canRecord, setCanRecord] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(t.length, t.length);
        }
      });
    },
  }));

  useEffect(() => {
    setCanRecord(Boolean(navigator.mediaDevices?.getUserMedia) && pickMime() !== undefined);
  }, []);

  // autosize
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4)) + "px";
  }, [text]);

  const teardown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    timerRef.current = null;
    rafRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      if (mediaRef.current?.state === "recording") mediaRef.current.stop();
      teardown();
    },
    [teardown]
  );

  async function transcribe(blob: Blob) {
    setRec("transcribing");
    try {
      const fd = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      fd.append("audio", blob, `voice.${ext}`);
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "I couldn't transcribe that. Try again or type it.");
      setText((prev) => (prev.trim() ? prev.trimEnd() + " " : "") + d.text);
      setViaVoice(true);
      setNotice(
        d.lowConfidence
          ? { tone: "warn", text: "Some words were hard to hear. Check the transcript and fix anything wrong, then send." }
          : { tone: "info", text: "Here's what I heard. Fix anything that's wrong, then send." }
      );
      requestAnimationFrame(() => taRef.current?.focus());
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Transcription failed." });
    } finally {
      setRec("idle");
    }
  }

  async function startRecording() {
    setNotice(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNotice({
        tone: "error",
        text: "Edge can't use your microphone. Allow microphone access in your browser, or type your plan.",
      });
      return;
    }
    const mime = pickMime();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    streamRef.current = stream;
    mediaRef.current = mr;
    chunksRef.current = [];
    cancelledRef.current = false;
    mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    mr.onstop = () => {
      teardown();
      if (cancelledRef.current) {
        setRec("idle");
        return;
      }
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || mime || "audio/webm" });
      if (blob.size < 1200) {
        setRec("idle");
        setNotice({ tone: "warn", text: "That was too short to hear anything. Hold on a little longer." });
        return;
      }
      void transcribe(blob);
    };

    // live level bars
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      ctxRef.current = ctx;
      const buf = new Uint8Array(an.frequencyBinCount);
      let last = 0;
      const tick = (t: number) => {
        rafRef.current = requestAnimationFrame(tick);
        if (t - last < 70) return;
        last = t;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        setLevels((prev) => [...prev.slice(1), Math.max(0.08, rms)]);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* bars are decoration only */
    }

    mr.start(250);
    setSeconds(0);
    setRec("recording");
    const started = Date.now();
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORD_SECONDS) stopRecording();
    }, 250);
  }

  function stopRecording() {
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
  }
  function cancelRecording() {
    cancelledRef.current = true;
    stopRecording();
    setLevels(Array(BARS).fill(0.08));
  }

  function send() {
    const t = text.trim();
    if (!t || disabled || rec !== "idle" || t.length > MAX_MESSAGE_CHARS) return;
    onSend(t, viaVoice);
    setText("");
    setViaVoice(false);
    setNotice(null);
  }

  const over = text.length > MAX_MESSAGE_CHARS;
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div>
      <div className="chat-composer px-4 pt-3.5 pb-3">
        {rec === "recording" ? (
          <div className="flex min-h-[52px] items-center gap-3" aria-live="polite">
            <span className="rec-dot" aria-hidden="true" />
            <span className="w-11 font-mono text-sm tabular-nums text-ink">{mmss}</span>
            <span className="rec-bars flex-1 justify-center" aria-hidden="true">
              {levels.map((l, i) => (
                <i key={i} style={{ height: `${Math.round(l * 22)}px` }} />
              ))}
            </span>
            <span className="sr-only">Recording your voice note</span>
          </div>
        ) : (
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            autoFocus={autoFocus}
            disabled={rec === "transcribing"}
            placeholder={rec === "transcribing" ? "Transcribing your voice note…" : placeholder}
            aria-label="Your message to Edge"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="block min-h-[52px] py-1"
          />
        )}

        <div className="mt-2 flex items-center gap-2">
          {rec === "recording" ? (
            <>
              <button type="button" className="icon-btn" onClick={cancelRecording} aria-label="Discard recording">
                <IconX />
              </button>
              <span className="composer-hint">Speak your plan. Up to 3 minutes.</span>
              <button
                type="button"
                className="send-btn ml-auto"
                onClick={stopRecording}
                aria-label="Finish recording and transcribe"
                title="Done"
              >
                <IconCheck />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="speak-btn"
                onClick={startRecording}
                disabled={!canRecord || rec === "transcribing" || disabled}
                aria-label="Record a voice note"
                title={canRecord ? "Record a voice note" : "Voice notes aren't supported in this browser"}
              >
                {rec === "transcribing" ? <span className="typing"><i /><i /><i /></span> : <IconMic />}
                <span>{rec === "transcribing" ? "Transcribing" : "Speak"}</span>
              </button>
              <span className="composer-hint hidden sm:inline">
                Enter to send · Shift + Enter for a new line
              </span>
              {text.length > MAX_MESSAGE_CHARS * 0.8 && (
                <span className={`ml-auto text-xs tabular-nums ${over ? "text-fail" : "text-muted"}`}>
                  {text.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}
                </span>
              )}
              <button
                type="button"
                className={`send-btn ${text.length > MAX_MESSAGE_CHARS * 0.8 ? "" : "ml-auto"}`}
                onClick={send}
                disabled={!text.trim() || disabled || rec !== "idle" || over}
                aria-label="Send"
              >
                <IconArrowUp />
              </button>
            </>
          )}
        </div>
      </div>
      {(notice || over) && (
        <p
          role={notice?.tone === "error" || over ? "alert" : "status"}
          className={`mt-2 px-2 text-sm ${
            over || notice?.tone === "error" ? "text-fail" : notice?.tone === "warn" ? "text-maybe" : "text-ink/80"
          }`}
        >
          {over
            ? `That's over the ${MAX_MESSAGE_CHARS.toLocaleString()}-character limit. Split it into two messages.`
            : notice?.text}
        </p>
      )}
    </div>
  );
});

export default Composer;
