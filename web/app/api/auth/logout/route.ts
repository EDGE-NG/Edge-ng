import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authClient } from "@/lib/supabase";
import { TWO_STEP_PENDING_COOKIE } from "@/lib/totp";

/**
 * POST -> sign out (PRD REQ-ID-1).
 * Supports scopes:
 * - 'local' (default): ends the Supabase session on this device and clears its cookies.
 * - 'others': revokes all other active sessions for this account, keeping this device signed in.
 * - 'global': revokes all active sessions across all devices and clears this device's cookies.
 */
export async function POST(req: Request) {
  try {
    let scope: "local" | "global" | "others" = "local";
    try {
      const body = await req.json();
      if (body?.scope === "others" || body?.scope === "global" || body?.scope === "local") {
        scope = body.scope;
      }
    } catch {
      // Body may be empty (e.g. from existing sidebar logout calls)
    }

    const supabase = await authClient();

    if (scope === "others") {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
      }

      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) {
        console.error("[logout] failed to sign out other devices:", error);
        return NextResponse.json(
          { ok: false, error: "Couldn't sign out other devices. Try again." },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, scope: "others" });
    }

    const { error } = await supabase.auth.signOut({ scope });
    if (error && scope === "global") {
      console.warn("[logout] global signOut had an error, falling back to local:", error);
      await supabase.auth.signOut({ scope: "local" });
    }

    const store = await cookies();
    store.delete(TWO_STEP_PENDING_COOKIE);

    return NextResponse.json({ ok: true, scope });
  } catch (err) {
    console.error("[logout]", err);
    return NextResponse.json({ ok: false, error: "Logout failed" }, { status: 500 });
  }
}
