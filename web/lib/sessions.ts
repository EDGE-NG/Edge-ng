/**
 * Market sessions from the clock (new product decision, Daniel, 2026-11-21).
 *
 * Session hours are public, so Edge works them out itself instead of asking
 * the trader. Hours are in each city's own time, so daylight saving is
 * handled by the time zone. A rule such as "Entry during the London session"
 * is checked in code from these hours (code decides, PR-GT-7); no model call.
 *
 * Pure and dependency-free: used by the server (rule checks) and the page
 * (the session strip).
 */

export type SessionKey = "asian" | "london" | "newyork";

export interface SessionDef {
  key: SessionKey;
  name: string;
  city: string;
  tz: string;
  /** Local opening and closing hour (24h). */
  open: number;
  close: number;
}

export const SESSIONS: SessionDef[] = [
  { key: "asian", name: "Asian", city: "Tokyo", tz: "Asia/Tokyo", open: 9, close: 18 },
  { key: "london", name: "London", city: "London", tz: "Europe/London", open: 8, close: 17 },
  { key: "newyork", name: "New York", city: "New York", tz: "America/New_York", open: 8, close: 17 },
];

interface LocalTime {
  weekday: string; // "Mon".."Sun"
  minutes: number; // minutes since local midnight
  hm: string; // "08:05"
}

function localTime(date: Date, tz: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const h = Number(get("hour"));
  const m = Number(get("minute"));
  return { weekday: get("weekday"), minutes: h * 60 + m, hm: `${get("hour")}:${get("minute")}` };
}

/**
 * Forex, metals and index CFDs close from Friday 17:00 to Sunday 17:00 New
 * York time. Crypto trades all week.
 */
export function weekendClosed(date: Date, assetClass: string): boolean {
  if (assetClass === "crypto") return false;
  const ny = localTime(date, "America/New_York");
  return ny.weekday === "Sat" || (ny.weekday === "Fri" && ny.minutes >= 17 * 60) || (ny.weekday === "Sun" && ny.minutes < 17 * 60);
}

export interface SessionState {
  def: SessionDef;
  open: boolean;
  local: LocalTime;
  /** Minutes until it closes (when open) or opens later today (when not yet open). */
  closesIn: number | null;
  opensIn: number | null;
}

export function sessionState(def: SessionDef, date: Date, assetClass = "forex"): SessionState {
  const local = localTime(date, def.tz);
  const o = def.open * 60;
  const c = def.close * 60;
  const weekday = local.weekday !== "Sat" && local.weekday !== "Sun";
  const open = weekday && !weekendClosed(date, assetClass) && local.minutes >= o && local.minutes < c;
  return {
    def,
    open,
    local,
    closesIn: open ? c - local.minutes : null,
    opensIn: !open && weekday && local.minutes < o ? o - local.minutes : null,
  };
}

export function allSessions(date: Date, assetClass = "forex"): SessionState[] {
  return SESSIONS.map((d) => sessionState(d, date, assetClass));
}

export function duration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return mins % 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.floor(mins / 60)}h`;
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Which session a rule names, if any. "overlap" = London and New York both
 * open. Only the session words are read; the rest of the rule is the
 * caller's concern (see ruleMode in workspace.ts).
 */
export function sessionsInRule(text: string): { keys: SessionKey[]; overlap: boolean } | null {
  const t = text.toLowerCase();
  if (!/\bsession|\bopen\b|\boverlap\b|\bkill ?zone/.test(t) && !/\b(london|new york|ny|asian?|tokyo)\b/.test(t)) return null;
  const keys: SessionKey[] = [];
  if (/\blondon\b/.test(t)) keys.push("london");
  if (/\bnew york\b|\bny\b|\bnyc\b|\bus session\b/.test(t)) keys.push("newyork");
  if (/\basian?\b|\btokyo\b/.test(t)) keys.push("asian");
  if (keys.length === 0) return null;
  const overlap = /\boverlap\b/.test(t) && keys.includes("london") && keys.includes("newyork");
  return { keys, overlap };
}

/**
 * Words that change what a session rule means: a negation ("never during the
 * Asian session", "avoid London"), or a narrower window ("first hour of
 * London", "after the New York open", "before 10:00"). Edge only knows when a
 * whole session is open, so a rule with any of these is not checked from the
 * clock; the trader answers it instead (a failure is never a pass, REQ-GT-7).
 */
const SESSION_QUALIFIERS =
  /\b(not|no|never|don'?t|do not|avoid|avoiding|outside|except|excluding|unless|skip|stop|before|after|until|till|first|last|early|late|hours?|minutes?|mins?|between|opening|close[sd]?|closing|kill ?zones?|highs?|lows?|range|sweep|swept|liquidity|levels?|price|candles?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|n't\b|\d/;

/**
 * True only for a plain "during the X session" rule (or "the London / New
 * York overlap") that the clock can answer exactly. See SESSION_QUALIFIERS.
 */
export function isPlainSessionRule(text: string): boolean {
  const t = text.toLowerCase();
  if (!/\bsessions?\b|\boverlap\b/.test(t)) return false;
  if (SESSION_QUALIFIERS.test(t)) return false;
  return sessionsInRule(t) !== null;
}

/**
 * Pass when the named session is open now (or, for "overlap", when London and
 * New York are both open; for several sessions, when any is open). Plain-
 * language reason for the trader either way (PR-GT-2).
 */
export function checkSessionRule(text: string, date: Date, assetClass: string): { pass: boolean; reason: string } | null {
  // only plain session rules; anything else is Inconclusive, never a guessed pass
  if (!isPlainSessionRule(text)) return null;
  const found = sessionsInRule(text);
  if (!found) return null;
  if (weekendClosed(date, assetClass)) {
    return { pass: false, reason: "The market is closed for the weekend. It reopens Sunday 17:00 New York time." };
  }
  const states = found.keys.map((k) => sessionState(SESSIONS.find((d) => d.key === k)!, date, assetClass));
  if (found.overlap) {
    const both = states.every((s) => s.open);
    const ny = states.find((s) => s.def.key === "newyork")!;
    const ldn = states.find((s) => s.def.key === "london")!;
    return both
      ? { pass: true, reason: `London and New York are both open: the overlap ends in ${duration(Math.min(ldn.closesIn!, ny.closesIn!))}.` }
      : { pass: false, reason: `London and New York aren't both open: it's ${ldn.local.hm} in London and ${ny.local.hm} in New York.` };
  }
  const open = states.find((s) => s.open);
  if (open) {
    return {
      pass: true,
      reason: `The ${open.def.name} session is open: it's ${open.local.hm} ${open.def.city} time, and it closes at ${hh(open.def.close)} (in ${duration(open.closesIn!)}).`,
    };
  }
  const s = states[0];
  if (s.local.weekday === "Sat" || s.local.weekday === "Sun") {
    return { pass: false, reason: `The ${s.def.name} session is closed for the weekend. It opens Monday at ${hh(s.def.open)} ${s.def.city} time.` };
  }
  return {
    pass: false,
    reason: `The ${s.def.name} session is closed: it's ${s.local.hm} ${s.def.city} time. It opens at ${hh(s.def.open)} ${s.def.city} time${s.opensIn ? ` (in ${duration(s.opensIn)})` : ""}.`,
  };
}
