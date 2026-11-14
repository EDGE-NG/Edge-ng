import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { MarketError, TIMEFRAMES, type Timeframe } from "@/lib/market";
import { getSession, processFrame, sessionView } from "@/lib/workspace-session";

const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/**
 * POST { timeframe, image (PNG data URL from Edge's own chart), visibleFrom?, visibleTo? }
 * -> the frame is stored with the server's candles and the chart rules this
 * view can answer are re-checked (PR-TW-3, PRD 5.5). The trader never uploads
 * a screenshot: Edge's chart captures itself.
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
  };
  const tf = body.timeframe as Timeframe;
  if (!TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "Unknown timeframe." }, { status: 400 });

  let image: Buffer | null = null;
  if (typeof body.image === "string" && body.image.startsWith("data:image/png;base64,")) {
    image = Buffer.from(body.image.slice("data:image/png;base64,".length), "base64");
    if (image.length > MAX_FRAME_BYTES) return NextResponse.json({ error: "Chart frame too large." }, { status: 413 });
  }

  try {
    const r = await processFrame(s, {
      timeframe: tf,
      image,
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
