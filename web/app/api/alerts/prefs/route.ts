import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { alertPrefs, saveAlertPrefs } from "@/lib/notify";

/** PATCH { push?, email? } -> which channels alerts are sent on. */
export async function PATCH(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { push?: unknown; email?: unknown };
  const curr = await alertPrefs(user.id);
  const next = {
    push: typeof b.push === "boolean" ? b.push : curr.push,
    email: typeof b.email === "boolean" ? b.email : curr.email,
  };
  await saveAlertPrefs(user.id, next);
  return NextResponse.json({ prefs: next });
}
