/**
 * AI provider adapters: Groq (text), Google Gemini (images, and text fallback), OpenRouter (last fallback).
 * All three expose OpenAI-compatible chat-completions APIs.
 * Keys stay server-side; the client never sees them.
 *
 * Every call (PRD REQ-LLM-1, REQ-LLM-10, REQ-LLM-12):
 *  - has a time limit per provider, so a hung provider falls through to the
 *    fallback instead of hanging the gate;
 *  - is recorded in llm_runs with job, provider, model, prompt version,
 *    latency and outcome (failed attempts too);
 *  - when it returns text the trader will read, is scanned for prediction
 *    wording; a hit is regenerated once, and refused if it still predicts.
 */
import { db, uuid } from "./db";
import { findInAll, PredictionLanguageError } from "./guardrail";

/** Default time limit per provider attempt. Callers on the gate path pass less. */
export const DEFAULT_TIMEOUT_MS = 20_000;

const JOBS = ["plan_extract", "plan_patch", "image_interpret", "rule_check", "journal", "digest", "transcribe"];

/**
 * Record a model call in llm_runs (PRD 5.6, REQ-LLM-1), including failed
 * attempts. Returns the run id (null if it could not be stored). Never breaks
 * the main flow.
 */
export async function recordRun(r: {
  userId?: string | null;
  job: string;
  provider: string;
  model: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number | null;
  promptVersion?: string | null;
  status?: "ok" | "invalid_output" | "error" | "timeout";
  errorCode?: string | null;
}): Promise<string | null> {
  const id = uuid();
  try {
    await db.run(
      `INSERT INTO llm_runs (id, user_id, job, provider, model, prompt_version, status, error_code, latency_ms, tokens_in, tokens_out)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      r.userId ?? null,
      JOBS.includes(r.job) ? r.job : "plan_extract",
      r.provider,
      r.model,
      r.promptVersion ?? null,
      r.status ?? "ok",
      r.errorCode ? r.errorCode.slice(0, 300) : null,
      r.latencyMs ?? null,
      r.tokensIn ?? null,
      r.tokensOut ?? null
    );
    return id;
  } catch (err) {
    console.error("[ai] could not record the model run:", err);
    return null;
  }
}

interface ProviderConfig {
  name: string;
  url: string;
  key: string | undefined;
  textModel: string;
  visionModel: string;
  /** Provider-specific request fields. */
  extraBody?: Record<string, unknown>;
  /** Output cap for image calls (thinking models need room before the answer). */
  visionMaxTokens?: number;
}

const PROVIDERS: ProviderConfig[] = [
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: process.env.GROQ_API_KEY,
    textModel: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
    // Groq serves no vision model on this key — vision calls go to OpenRouter
    visionModel: process.env.GROQ_VISION_MODEL || "",
  },
  {
    // Google Gemini through its OpenAI-compatible endpoint, on the Gemini API
    // free tier (key from aistudio.google.com/apikey). Groq has no vision model,
    // so image calls come here first; text calls use it as a free fallback.
    name: "google",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: process.env.GEMINI_API_KEY,
    textModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    visionModel: process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
    // keep Gemini 2.5's built-in thinking short, so the answer fits and comes back fast
    extraBody: { reasoning_effort: "low" },
    visionMaxTokens: 4096,
  },
  {
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: process.env.OPENROUTER_API_KEY,
    textModel: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct",
    visionModel: process.env.OPENROUTER_VISION_MODEL || "google/gemini-2.5-flash",
  },
];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface AIResult {
  text: string;
  provider: string;
  model: string;
  /** llm_runs id of this call (null if it could not be recorded). */
  runId: string | null;
}

export interface AIOptions {
  userId?: string;
  /** The PRD job: plan_extract, image_interpret, rule_check, ... */
  feature?: string;
  /** Version of the prompt and output schema used, recorded on every run. */
  promptVersion?: string;
  timeoutMs?: number;
}

function hasVision(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url")
  );
}

export async function chat(messages: ChatMessage[], opts: AIOptions = {}): Promise<AIResult> {
  const vision = hasVision(messages);
  const candidates = PROVIDERS.filter((p) => p.key && (!vision || p.visionModel));
  if (candidates.length === 0) {
    throw new Error(
      vision
        ? "No vision-capable AI provider configured. Set GEMINI_API_KEY (or OPENROUTER_API_KEY)."
        : "No AI provider configured. Set GROQ_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY."
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = {
    userId: opts.userId,
    job: opts.feature ?? "plan_extract",
    promptVersion: opts.promptVersion ?? null,
  };
  const errors: string[] = [];
  for (const p of candidates) {
    const model = vision ? p.visionModel : p.textModel;
    const started = Date.now();
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          // Explicit caps: some providers default to 65535 max_tokens, which
          // trips OpenRouter's "can you afford this request" check on low credits.
          max_tokens: vision ? p.visionMaxTokens ?? 1024 : 4096,
          ...p.extraBody,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${p.name} ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      const text: string = data.choices?.[0]?.message?.content ?? "";
      const usage = data.usage ?? {};
      const runId = await recordRun({
        ...run,
        provider: p.name,
        model,
        tokensIn: usage.prompt_tokens,
        tokensOut: usage.completion_tokens,
        latencyMs: Date.now() - started,
      });
      return { text, provider: p.name, model, runId };
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      const msg = timedOut ? `timed out after ${timeoutMs} ms` : err instanceof Error ? err.message : String(err);
      await recordRun({
        ...run,
        provider: p.name,
        model,
        status: timedOut ? "timeout" : "error",
        errorCode: msg,
        latencyMs: Date.now() - started,
      });
      // record this provider's failure and try the next one
      errors.push(`${p.name}(${model}): ${msg}`);
    }
  }
  throw new Error(`All AI providers failed -> ${errors.join(" | ")}`);
}

/** Parse a JSON object out of an LLM response, tolerating code fences and prose. */
export function parseJson<T>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in AI response");
  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch (err) {
    const repaired = escapeNewlinesInStrings(slice);
    if (repaired !== slice) {
      try {
        return JSON.parse(repaired) as T;
      } catch {
        /* fall through to original error */
      }
    }
    throw err instanceof Error
      ? new Error(`AI returned malformed JSON: ${err.message}`)
      : new Error("AI returned malformed JSON");
  }
}

/**
 * Escape raw newline/tab characters that appear *inside* JSON string values
 * (an LLM slip) without touching structural whitespace between tokens.
 */
function escapeNewlinesInStrings(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString && c === "\\") {
      out += c + (s[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === '"') inString = !inString;
    if (inString && c === "\n") {
      out += "\\n";
      continue;
    }
    if (inString && c === "\t") {
      out += "\\t";
      continue;
    }
    out += c;
  }
  return out;
}

export interface JsonOptions<T> extends AIOptions {
  /**
   * Language guardrail (REQ-LLM-12): `texts` picks the fields the trader will
   * read; `ownWords` are the trader's own phrases, which are not flagged.
   */
  guard?: { texts: (value: T) => Array<string | null | undefined>; ownWords?: string[] };
}

export interface JsonResult<T> {
  data: T;
  provider: string;
  model: string;
  promptVersion: string | null;
  /** llm_runs id of the call that produced `data`. */
  runId: string | null;
}

/**
 * Call the AI and parse JSON, retrying once with a correction if the model
 * returns malformed JSON (common with quotes inside string values). With a
 * guard, a reply that predicts is regenerated once; if it still predicts,
 * PredictionLanguageError is thrown so the caller treats it as a failure
 * (never as a pass).
 */
export async function chatJson<T>(messages: ChatMessage[], opts: JsonOptions<T> = {}): Promise<JsonResult<T>> {
  const { guard, ...callOpts } = opts;

  const parsed = async (msgs: ChatMessage[]): Promise<{ value: T; text: string; res: AIResult }> => {
    const res = await chat(msgs, callOpts);
    try {
      return { value: parseJson<T>(res.text), text: res.text, res };
    } catch {
      const corrected: ChatMessage[] = [
        ...msgs,
        { role: "assistant", content: res.text },
        {
          role: "user",
          content:
            "Your response was not valid JSON (a quote or newline inside a string was not escaped). " +
            "Resend the SAME content as one valid JSON object only. Escape all quotes and newlines inside strings.",
        },
      ];
      const retry = await chat(corrected, callOpts);
      return { value: parseJson<T>(retry.text), text: retry.text, res: retry };
    }
  };

  let out = await parsed(messages);
  if (guard) {
    const hit = findInAll(guard.texts(out.value), guard.ownWords);
    if (hit) {
      out = await parsed([
        ...messages,
        { role: "assistant", content: out.text },
        {
          role: "user",
          content:
            `Your reply used prediction or advice wording ("${hit}"). Edge never predicts price moves or profit, ` +
            `never rates a trade as good or bad, and never recommends a trade; it only says what the chart shows ` +
            `and whether the trader's own rule is met. Resend the SAME JSON with neutral, factual wording.`,
        },
      ]);
      const again = findInAll(guard.texts(out.value), guard.ownWords);
      if (again) {
        await recordRun({
          userId: callOpts.userId,
          job: callOpts.feature ?? "plan_extract",
          provider: out.res.provider,
          model: out.res.model,
          promptVersion: callOpts.promptVersion ?? null,
          status: "invalid_output",
          errorCode: `guardrail blocked: "${again}"`,
        });
        throw new PredictionLanguageError(again);
      }
    }
  }
  return {
    data: out.value,
    provider: out.res.provider,
    model: out.res.model,
    promptVersion: callOpts.promptVersion ?? null,
    runId: out.res.runId,
  };
}
