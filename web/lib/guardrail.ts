/**
 * Language guardrail (PRD REQ-LLM-12, PR-GT-8): AI text shown to the trader
 * must never predict direction or profit, rate a trade as good or bad, or
 * recommend a trade. Edge only says a trade passes or fails the trader's own
 * checklist. This check runs after generation, in code; `chatJson` uses it to
 * block and regenerate a reply, and to refuse one that still predicts.
 *
 * The trader's own words (their rules, plan and notes) are removed before
 * scanning, so quoting a rule such as "only buy if price will bounce off
 * support" back to them is not treated as a prediction by Edge.
 */

const MOVES =
  "win|profit|pay off|work out|succeed|go up|go down|rise|fall|drop|rally|pump|dump|crash|moon|reverse|bounce|" +
  "break out|break down|break higher|break lower|continue (?:up|down|higher|lower)|move (?:up|down|higher|lower)|" +
  "hit (?:the |your )?(?:target|tp|take profit|stop|sl|stop loss)";

const PATTERNS: RegExp[] = [
  // "will rise", "will likely hit your target", "is going to reverse"
  new RegExp(`\\b(?:will|is going to|are going to|is about to|should) (?:likely |probably |definitely |surely |soon )?(?:${MOVES})\\b`, "i"),
  // "likely to rally", "expected to fall", "poised to break out"
  new RegExp(`\\b(?:likely|unlikely|expected|set|poised|bound|due) to (?:${MOVES})\\b`, "i"),
  // rating the trade rather than the checklist
  /\b(?:good|great|solid|safe|winning|profitable|losing|bad|poor|perfect) (?:trade|setup|entry|opportunity)\b/i,
  /\bhigh[- ]probability\b/i,
  /\b(?:guarantee[sd]?|sure win|can'?t lose|cannot lose|risk[- ]free|easy money)\b/i,
  // recommending a trade
  /\b(?:you should|i recommend|i'd recommend|i would recommend|i suggest|i advise) (?:you )?(?:buy|sell|go long|go short|enter|take (?:this|the|that) trade|open (?:a|the) (?:trade|position))\b/i,
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns the first predictive phrase found in `text`, or null when the text
 * is clean. `ownWords` are the trader's own phrases, ignored while scanning.
 */
export function findPredictionLanguage(text: string, ownWords: string[] = []): string | null {
  const own = ownWords.map(normalize).filter((w) => w.length >= 3);
  let s = normalize(text);
  // remove whole quoted rules / phrases first
  for (const w of own) s = s.split(w).join(" ");
  for (const re of PATTERNS) {
    for (const m of s.matchAll(new RegExp(re.source, "gi"))) {
      // a phrase the trader used themselves is theirs, not Edge's prediction
      if (own.some((w) => w.includes(m[0]))) continue;
      return m[0];
    }
  }
  return null;
}

/** First hit across several user-facing strings (null / undefined are skipped). */
export function findInAll(texts: Array<string | null | undefined>, ownWords: string[] = []): string | null {
  for (const t of texts) {
    if (typeof t !== "string" || !t) continue;
    const hit = findPredictionLanguage(t, ownWords);
    if (hit) return hit;
  }
  return null;
}

export class PredictionLanguageError extends Error {
  phrase: string;
  constructor(phrase: string) {
    super(`AI output still used prediction wording after regeneration: "${phrase}"`);
    this.phrase = phrase;
  }
}
