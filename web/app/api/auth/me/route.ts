import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

/** GET -> the signed-in user, or 401. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ user });
}
