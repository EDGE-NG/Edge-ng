import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSession,
  ensureUser,
  sessionCookie,
  verifyLoginCode,
} from "@/lib/auth";

/** POST { email, code } -> verifies the code, creates a session cookie. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();

  if (!email || !code) {
    return NextResponse.json({ error: "Email and code are required" }, { status: 400 });
  }

  const matched = verifyLoginCode(email, code);
  if (!matched) {
    return NextResponse.json(
      { error: "That code is incorrect or has expired" },
      { status: 401 }
    );
  }

  const user = ensureUser(matched);
  const token = createSession(user.id);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, sessionCookie);
  return res;
}
