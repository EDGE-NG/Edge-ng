import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";

/** PATCH -> mark all of the trader's unread alerts as read. */
export async function PATCH() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const n = await db.run("UPDATE alert_events SET read_at = now() WHERE user_id = ? AND read_at IS NULL", user.id);
  return NextResponse.json({ updated: n });
}
