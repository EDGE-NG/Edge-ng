/**
 * AI provider adapters — Groq (primary) and OpenRouter (fallback).
 * Both expose OpenAI-compatible chat-completions APIs.
 * Keys stay server-side; the client never sees them.
 */
import { db, now, uuid } from "./db";

interface ProviderConfig {
  name: string;
  url: string;
  key: string | undefined;
  textModel: string;
  visionModel: string;
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
}

function hasVision(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url")
  );
}

export async function chat(
  messages: ChatMessage[],
  opts: { userId?: string; feature?: string } = {}
): Promise<AIResult> {
  const vision = hasVision(messages);
  const candidates = PROVIDERS.filter((p) => p.key && (!vision || p.visionModel));
  if (candidates.length === 0) {
    throw new Error(
      vision
        ? "No vision-capable AI provider configured. Set OPENROUTER_API_KEY in .env.local"
        : "No AI provider configured. Set GROQ_API_KEY or OPENROUTER_API_KEY in .env.local"
    );
  }

  const errors: string[] = [];
  for (const p of candidates) {
    const model = vision ? p.visionModel : p.textModel;
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
          max_tokens: vision ? 1024 : 4096,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${p.name} ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      const text: string = data.choices?.[0]?.message?.content ?? "";
      const usage = data.usage ?? {};
      try {
        db.prepare(
          `INSERT INTO ai_usage_ledger (id, user_id, feature, provider, model, tokens_in, tokens_out, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uuid(),
          opts.userId ?? null,
          opts.feature ?? "chat",
          p.name,
          model,
          usage.prompt_tokens ?? null,
          usage.completion_tokens ?? null,
          now()
        );
      } catch {
        // usage logging must never break the main flow
      }
      return { text, provider: p.name, model };
    } catch (err) {
      // record this provider's failure and try the next one
      errors.push(`${p.name}(${model}): ${err instanceof Error ? err.message : String(err)}`);
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

/**
 * Call the AI and parse JSON, retrying once with a correction if the model
 * returns malformed JSON (common with quotes inside string values).
 */
export async function chatJson<T>(
  messages: ChatMessage[],
  opts: { userId?: string; feature?: string } = {}
): Promise<T> {
  const res = await chat(messages, opts);
  try {
    return parseJson<T>(res.text);
  } catch {
    const corrected: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: res.text },
      {
        role: "user",
        content:
          "Your response was not valid JSON (a quote or newline inside a string was not escaped). " +
          "Resend the SAME content as one valid JSON object only. Escape all quotes and newlines inside strings.",
      },
    ];
    const retry = await chat(corrected, opts);
    return parseJson<T>(retry.text);
  }
}
