import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { authClient } from "@/lib/supabase";
import { parseUserAgent } from "@/lib/user-agent";

function extractSessionId(token?: string | null): string | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

export interface SessionRecord {
  id: string;
  isCurrent: boolean;
  device: string;
  browser: string;
  os: string;
  isMobile: boolean;
  lastActive: string;
  createdAt: string;
  ip: string | null;
}

/**
 * GET /api/auth/sessions -> lists active devices/sessions for the signed-in user (PRD REQ-ID-1, 4.8).
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const supabase = await authClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const currentSessionId = extractSessionId(session?.access_token);

  try {
    const rows = await db.all<{
      id: string;
      created_at: string;
      updated_at: string;
      user_agent: string | null;
      ip: string | null;
    }>(
      `SELECT id, created_at, updated_at, user_agent, ip
       FROM auth.sessions
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
      user.id
    );

    const sessions: SessionRecord[] = (rows ?? []).map((row) => {
      const parsed = parseUserAgent(row.user_agent);
      const isCurrent = Boolean(currentSessionId && row.id === currentSessionId);
      return {
        id: row.id,
        isCurrent,
        device: parsed.device,
        browser: parsed.browser,
        os: parsed.os,
        isMobile: parsed.isMobile,
        lastActive: row.updated_at || row.created_at,
        createdAt: row.created_at,
        ip: row.ip,
      };
    });

    // If current session exists but not found in rows (or direct DB table unreachable)
    if (currentSessionId && !sessions.some((s) => s.isCurrent)) {
      sessions.unshift({
        id: currentSessionId,
        isCurrent: true,
        device: "Current device",
        browser: "Web Browser",
        os: "Current OS",
        isMobile: false,
        lastActive: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        ip: null,
      });
    }

    return NextResponse.json({ ok: true, sessions });
  } catch (err) {
    console.error("[sessions] Failed to list sessions:", err);
    // Graceful fallback for UI: return current session
    const fallbackSession: SessionRecord = {
      id: currentSessionId || "current",
      isCurrent: true,
      device: "Current device",
      browser: "Web Browser",
      os: "Current OS",
      isMobile: false,
      lastActive: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      ip: null,
    };
    return NextResponse.json({ ok: true, sessions: [fallbackSession] });
  }
}

/**
 * DELETE /api/auth/sessions -> revokes a specific device session (PRD REQ-ID-1, 4.8).
 */
export async function DELETE(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  const sessionId = String(body.sessionId ?? "").trim();

  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "Session ID required" }, { status: 400 });
  }

  const supabase = await authClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const currentSessionId = extractSessionId(session?.access_token);

  try {
    // Delete the specific session row; cascades to refresh_tokens in Supabase Auth
    await db.run("DELETE FROM auth.sessions WHERE id = ? AND user_id = ?", sessionId, user.id);

    // If user asked to revoke their own current session, clear local cookies
    if (currentSessionId && sessionId === currentSessionId) {
      await supabase.auth.signOut({ scope: "local" });
    }

    return NextResponse.json({ ok: true, sessionId, isCurrent: sessionId === currentSessionId });
  } catch (err) {
    console.error("[sessions] Failed to revoke session:", err);
    return NextResponse.json({ ok: false, error: "Failed to revoke session" }, { status: 500 });
  }
}
