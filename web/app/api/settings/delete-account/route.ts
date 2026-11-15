import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db, uuid } from "@/lib/db";
import { adminClient, authClient } from "@/lib/supabase";

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { confirmation?: string };
  if (body.confirmation !== "DELETE") {
    return NextResponse.json({ error: "Type DELETE to confirm account deletion." }, { status: 400 });
  }

  try {
    // PRD REQ-GOV: the audit log outlives deleted accounts (kept 24 months, no foreign key on purpose)
    await db.run(
      `INSERT INTO audit_log (id, actor_user_id, actor_type, action, object_type, object_id, metadata)
       VALUES (?, ?, 'trader', 'account.deleted', 'user', ?, ?)`,
      uuid(),
      user.id,
      user.id,
      { email: user.email, deletedAt: new Date().toISOString() }
    );

    // Deleting from Supabase Auth cascades deletions in Postgres (ON DELETE CASCADE)
    const admin = adminClient();
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      console.error("[delete-account] admin delete failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Sign out from current session
    const supabase = await authClient();
    await supabase.auth.signOut();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[delete-account] error:", err);
    return NextResponse.json({ error: "Failed to delete account. Please try again." }, { status: 500 });
  }
}

