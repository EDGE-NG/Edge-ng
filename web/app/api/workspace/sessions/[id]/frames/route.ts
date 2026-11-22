import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { MarketError, TIMEFRAMES, type Timeframe } from "@/lib/market";
import type { Ticket } from "@/lib/workspace";
import { getSession, processFrame, refreshForGate, sessionView, WARM_REUSE_MS } from "@/lib/workspace-session";

const MAX_FRAME_BYTES = 4 * 1024 * 1024;

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

/** The ticket as the trader is filling it in (may be incomplete). */
function draftTicket(t: unknown): Ticket | null {
  if (!t || typeof t !== "object") return null;
  const d = t as Record<string, unknown>;
  const side = d.side === "buy" || d.side === "sell" ? d.side : null;
  const entry = num(d.entry);
  if (!side || entry == null || entry <= 0) return null;
  return { side, entry, stop: num(d.stop), target: num(d.target), accountSize: null, riskAmount: null };
}

/**
 * POST { timeframe, image (PNG data URL from Edge's own chart), visibleFrom?, visibleTo?, ticket?, pending?, warm? }
 * -> the frame is stored with the server's candles and the chart rules this
 * view can answer are re-checked (PR-TW-3, PRD 5.5). The trader never uploads
 * a screenshot: Edge's chart captures itself.
 *
 * `ticket` is the trade being filled in, so the checks match what the trader
 * will submit. `warm: true` also refreshes hard-gate rules on other
 * timeframes, so that Buy / Sell can reuse fresh checks and answer in about a
 * second (REQ-LLM-5 still applies at the gate).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const s = await getSession(id, user.id);
  if (!s) return NextResponse.json({ error: "This workspace session has ended. Pick the instrument again." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    timeframe?: string;
    image?: string;
    visibleFrom?: number;
    visibleTo?: number;
    ticket?: unknown;
    pending?: boolean;
    warm?: boolean;
  };
  const tf = body.timeframe as Timeframe;
  if (!TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "Unknown timeframe." }, { status: 400 });

  let image: Buffer | null = null;
  if (typeof body.image === "string" && body.image.startsWith("data:image/png;base64,")) {
    image = Buffer.from(body.image.slice("data:image/png;base64,".length), "base64");
    if (image.length > MAX_FRAME_BYTES) return NextResponse.json({ error: "Chart frame too large." }, { status: 413 });
  }
  const ticket = draftTicket(body.ticket);
  const pending = body.pending === true;

  try {
    if (body.warm) {
      const r = await refreshForGate(s, { timeframe: tf, image, ticket, pending, reuseMs: WARM_REUSE_MS });
      return NextResponse.json({ ...(await sessionView(s)), failed: r.failed });
    }
    const r = await processFrame(s, {
      timeframe: tf,
      image,
      ticket,
      pending,
      visibleFrom: Number(body.visibleFrom) || undefined,
      visibleTo: Number(body.visibleTo) || undefined,
    });
    return NextResponse.json({ ...(await sessionView(s)), frame: r });
  } catch (err) {
    if (err instanceof MarketError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
