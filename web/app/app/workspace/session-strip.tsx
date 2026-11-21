"use client";

/** Which market sessions are open right now (lib/sessions.ts), refreshed every 30 s. */
import { useEffect, useState } from "react";
import { allSessions, duration, weekendClosed } from "@/lib/sessions";

export default function SessionStrip({ assetClass }: { assetClass: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const closed = weekendClosed(now, assetClass);
  const utc = now.toISOString().slice(11, 16);

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-[13px]"
      aria-label="Market sessions"
    >
      <span className="text-muted">Sessions</span>
      {closed ? (
        <span className="inline-flex items-center gap-2 text-muted">
          <i className="h-2 w-2 rounded-full border-[1.5px] border-current" aria-hidden />
          Market closed for the weekend <small className="text-xs">reopens Sunday 17:00 New York time</small>
        </span>
      ) : (
        allSessions(now, assetClass).map((s) => (
          <span key={s.def.key} className={`inline-flex items-center gap-2 ${s.open ? "text-ink" : "text-muted"}`}>
            <i
              className={`h-2 w-2 rounded-full ${s.open ? "bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]" : "border-[1.5px] border-current"}`}
              aria-hidden
            />
            {s.def.name}
            {s.open ? " open" : ""}
            <small className="text-xs text-muted">
              {s.open ? `closes in ${duration(s.closesIn!)}` : s.opensIn != null ? `opens in ${duration(s.opensIn)}` : "closed"}
            </small>
          </span>
        ))
      )}
      <span className="ml-auto text-muted tabular-nums">{utc} UTC</span>
    </div>
  );
}
