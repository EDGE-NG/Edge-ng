import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, uuid } from "@/lib/db";
import { allowedEndpoint } from "@/lib/push";

/** POST { subscription: PushSubscriptionJSON } -> remember this device for alerts. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  };
  const sub = b.subscription;
  const endpoint = String(sub?.endpoint ?? "");
  const p256dh = String(sub?.keys?.p256dh ?? "");
  const auth = String(sub?.keys?.auth ?? "");
  if (!allowedEndpoint(endpoint) || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return NextResponse.json({ error: "This browser's notification subscription isn't valid." }, { status: 400 });
  }
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300);
  // a device belongs to one account: signing in as someone else moves it
  await db.run(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth = excluded.auth, user_agent = excluded.user_agent`,
    uuid(),
    user.id,
    endpoint,
    p256dh,
    auth,
    ua
  );
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** DELETE { endpoint } -> stop sending alerts to this device. */
export async function DELETE(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  await db.run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", String(b.endpoint ?? ""), user.id);
  return NextResponse.json({ ok: true });
}
