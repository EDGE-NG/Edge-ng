import { NextResponse } from "next/server";
import { GRACE_DAYS, scheduleDeletion } from "@/lib/account-deletion";
import { getUser } from "@/lib/auth";
import { authClient } from "@/lib/supabase";

/**
 * POST { confirmation: "DELETE" } -> schedule the account for deletion
 * (PRD F13). Nothing is deleted now: the account is deleted GRACE_DAYS later
 * by the daily purge (/api/account/purge), files and all. Signing in before
 * then cancels it (see lib/account-deletion.ts). The trader is signed out on
 * every device straight away.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { confirmation?: string };
  if (body.confirmation !== "DELETE") {
    return NextResponse.json({ error: "Type DELETE to confirm account deletion." }, { status: 400 });
  }

  let dueAt: string;
  try {
    dueAt = await scheduleDeletion(user.id, user.email ?? null);
  } catch (err) {
    console.error("[delete-account] could not schedule deletion:", err);
    return NextResponse.json({ error: "We couldn't delete your account just now. Please try again." }, { status: 500 });
  }

  // sign out everywhere: other devices must not keep using an account that is being deleted
  try {
    const supabase = await authClient();
    await supabase.auth.signOut({ scope: "global" });
  } catch (err) {
    console.error("[delete-account] sign-out failed:", err);
  }

  return NextResponse.json({ ok: true, dueAt, graceDays: GRACE_DAYS });
}
