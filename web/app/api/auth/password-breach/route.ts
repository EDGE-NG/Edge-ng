import { NextResponse } from "next/server";
import { checkPasswordBreached } from "@/lib/password-breach";

/**
 * POST /api/auth/password-breach
 * Checks whether a candidate password appears in known data breaches (Task M4, Figma 1b).
 * Uses k-Anonymity so the raw password never leaves the server.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const password = typeof body.password === "string" ? body.password : "";

  if (password.length < 8) {
    return NextResponse.json({ breached: false });
  }

  const breached = await checkPasswordBreached(password);
  return NextResponse.json({ breached });
}
