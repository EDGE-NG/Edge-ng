import { NextResponse } from "next/server";
import { getUser, tooManyAttempts } from "@/lib/auth";
import { recordRun } from "@/lib/ai";

const MAX_BYTES = 20 * 1024 * 1024; // Groq's limit is 25 MB; keep headroom
const MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo";

interface Segment {
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
}

/**
 * POST multipart { audio } -> { text, lowConfidence }.
 * Speech-to-text for voice notes (PR-CH-3). The transcript is returned for the
 * trader to correct before Edge uses it; nothing is extracted from audio
 * directly. Audio is not stored (PRD 9.5: deleted once transcribed).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: "Voice notes aren't set up on this server yet. Type your plan instead." },
      { status: 503 }
    );
  }
  if (tooManyAttempts(`stt:${user.id}`, 40, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many voice notes this hour. Try typing." }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "No recording received." }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "That recording is too long. Keep voice notes under 3 minutes." }, { status: 413 });
  }

  // Browsers label recordings with codec parameters (Chrome:
  // "audio/webm;codecs=opus"), which the speech API can reject as an invalid
  // file. Re-wrap the bytes with a plain media type and a matching extension.
  const base = (audio.type || "audio/webm").split(";")[0].trim().toLowerCase();
  const kind =
    base.includes("mp4") || base.includes("m4a") || base.includes("aac")
      ? { ext: "m4a", type: "audio/mp4" }
      : base.includes("ogg")
        ? { ext: "ogg", type: "audio/ogg" }
        : base.includes("wav")
          ? { ext: "wav", type: "audio/wav" }
          : base.includes("mpeg") || base.includes("mp3")
            ? { ext: "mp3", type: "audio/mpeg" }
            : { ext: "webm", type: "audio/webm" };
  const bytes = await audio.arrayBuffer();
  const clean = new File([bytes], `voice.${kind.ext}`, { type: kind.type });

  const upstream = new FormData();
  upstream.append("file", clean);
  upstream.append("model", MODEL);
  upstream.append("response_format", "verbose_json");
  upstream.append("temperature", "0");
  // Bias toward trading vocabulary so jargon transcribes correctly (EC-P3).
  upstream.append(
    "prompt",
    "Trading plan: EURUSD, GBPJPY, XAUUSD, NAS100, US30, BTC, 4H, 1H, 15m, EMA, SMA, RSI, MACD, VWAP, " +
      "London session, New York session, Asian range, pullback, breakout, swing high, swing low, stop loss, take profit, risk to reward, pips."
  );

  try {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: upstream,
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(
        "[transcribe] groq",
        res.status,
        detail.slice(0, 300),
        `| sent ${clean.name} (${clean.type}, ${bytes.byteLength} bytes; browser said "${audio.type}")`
      );
      return NextResponse.json(
        { error: "I couldn't transcribe that recording. Try again, or type your plan." },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { text?: string; segments?: Segment[]; duration?: number };
    const text = (data.text ?? "").trim();
    const segments = data.segments ?? [];
    const lowConfidence = segments.some(
      (s) => (s.avg_logprob ?? 0) < -0.7 || (s.no_speech_prob ?? 0) > 0.5
    );
    // tokens_in holds the audio length in seconds for speech-to-text runs
    await recordRun({ userId: user.id, job: "transcribe", provider: "groq", model: MODEL, tokensIn: Math.round(data.duration ?? 0) });
    if (!/\p{L}/u.test(text)) {
      // empty, or only punctuation (what silence / background noise comes back as)
      return NextResponse.json({ error: "I didn't catch any words. Try again a little closer to the mic." }, { status: 422 });
    }
    return NextResponse.json({ text, lowConfidence });
  } catch (err) {
    console.error("[transcribe]", err);
    return NextResponse.json(
      { error: "I couldn't reach the transcription service. Try again, or type your plan." },
      { status: 502 }
    );
  }
}
