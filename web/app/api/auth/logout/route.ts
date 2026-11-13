import { NextResponse } from "next/server";
import { authClient } from "@/lib/supabase";

/** POST -> sign out (ends the Supabase session and clears its cookies). */
export async function POST() {
  try {
    const supabase = await authClient();
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[logout]", err);
  }
  return NextResponse.json({ ok: true });
}
