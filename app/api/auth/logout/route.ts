import { NextResponse } from "next/server";
import { SESSION_COOKIE, destroySession, sessionCookie } from "@/lib/auth";

/** POST -> sign out (kills the session row and clears the cookie). */
export async function POST(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  destroySession(match?.[1]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookie, maxAge: 0 });
  return res;
}
