import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { pushConfigured, sendPush } from "@/lib/notify";

/** POST -> send a test notification to this trader's devices. */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Notifications aren't set up on this server yet." }, { status: 503 });
  }
  const r = await sendPush(user.id, {
    title: "Edge alerts are on",
    body: "This is how Edge will tell you when a market you watch passes your checklist's chart rules.",
    path: "/app/alerts",
    tag: "edge-test",
  });
  if (r.sent === 0) {
    return NextResponse.json({ error: "No device received it. Turn notifications on again." }, { status: 409 });
  }
  return NextResponse.json(r);
}
