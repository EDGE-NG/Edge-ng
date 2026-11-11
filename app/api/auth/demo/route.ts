import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSession, ensureDemoUser, sessionCookie } from "@/lib/auth";

/** POST -> sign in to the built-in demo account (holds the V1 test data). */
export async function POST() {
  const user = ensureDemoUser();
  const token = createSession(user.id);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, sessionCookie);
  return res;
}
