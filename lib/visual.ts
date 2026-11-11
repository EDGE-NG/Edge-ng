/**
 * Visual Edge Library helpers (PRD 4.3):
 * rule → trader screenshot(s) → explanation → AI interpretation → trader confirmation.
 */
import { chatJson } from "./ai";

const INTERPRET_SYSTEM = `You are learning how ONE individual trader interprets their own checklist rule on a chart.
You receive the rule text, an example chart image, whether the trader labels it a POSITIVE (valid setup) or NEGATIVE (invalid / trap) example, and the trader's explanation.

Respond ONLY with JSON:
{
  "interpretation": "3-5 sentences: what this image shows and how it illustrates the trader's rule, in the trader's framing",
  "grounded": true|false
}
grounded = false if the image does not plausibly relate to the rule.
Never invent indicator values, prices, timeframes, or patterns that are not visible in the image or stated in the explanation.
The trader will review your interpretation and confirm or correct it.`;

/** Run the vision model over the stored image + trader explanation. */
export async function interpretExample(
  rule: string,
  polarity: string,
  explanation: string,
  image: string,
  userId: string
): Promise<string> {
  const label =
    polarity === "negative"
      ? "NEGATIVE example (this setup is INVALID or a trap under the rule)"
      : "POSITIVE example (this setup is VALID under the rule)";
  const parsed = await chatJson<{ interpretation?: string; grounded?: boolean }>(
    [
      { role: "system", content: INTERPRET_SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Rule: ${rule}`,
              `Label: ${label}`,
              `Trader's explanation: ${explanation}`,
              `Describe how the attached image illustrates this rule.`,
            ].join("\n"),
          },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
    { userId, feature: "visual_library" }
  );
  if (typeof parsed.interpretation !== "string" || !parsed.interpretation.trim()) {
    throw new Error("AI returned no interpretation");
  }
  return parsed.interpretation.trim();
}

/** A reference row as returned by the API. */
export interface VisualRef {
  id: string;
  polarity: string;
  explanation: string | null;
  ai_interpretation: string | null;
  confirmed_interpretation: string | null;
  confirmed_at: string | null;
  approval_status: string;
  superseded_by: string | null;
  replaced_at: string | null;
  created_at: string;
  image: string;
}

export function refJson(r: Record<string, unknown>): VisualRef {
  return {
    id: r.id as string,
    polarity: r.polarity as string,
    explanation: (r.explanation as string | null) ?? null,
    ai_interpretation: (r.ai_interpretation as string | null) ?? null,
    confirmed_interpretation: (r.confirmed_interpretation as string | null) ?? null,
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    approval_status: r.approval_status as string,
    superseded_by: (r.superseded_by as string | null) ?? null,
    replaced_at: (r.replaced_at as string | null) ?? null,
    created_at: r.created_at as string,
    image: r.image_key as string,
  };
}
