/** The trader's time zone if the runtime knows it, else UTC. Safe to pass to SQL `AT TIME ZONE ?`. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}
