/**
 * Accounts: Supabase Auth (PRD F1, REQ-ID-1). Passwords, sessions, email
 * verification and password reset are handled by Supabase; the session lives
 * in httpOnly cookies set by @supabase/ssr. Profile details (name, timezone)
 * live in public.profiles.
 */
import { db, json } from "./db";
import { authClient } from "./supabase";

export const PASSWORD_MIN = 8;

/* ------------------------------------------------- attempt limiter ------ */
// Rate limits are shared by every server (lib/rate-limit.ts). Supabase Auth
// applies its own limits on top.
export { clearAttempts, tooManyAttempts } from "./rate-limit";

export interface User {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  created_at: string;
  avatarUrl?: string | null;
}

/**
 * The signed-in user for this request, or null. Checks the session with
 * Supabase Auth (not just the cookie), then reads the profile.
 */
export async function getUser(): Promise<User | null> {
  // Reading cookies is left outside the try: during `next build` it rejects on
  // purpose to mark the route as dynamic, and that signal must not be swallowed.
  const supabase = await authClient();
  let authUser;
  try {
    const { data } = await supabase.auth.getUser();
    authUser = data.user;
  } catch (err) {
    console.error("[auth] session check failed:", err);
    return null;
  }
  if (!authUser) return null;
  const p = await db.one<{ display_name: string | null; timezone: string; created_at: string; settings: unknown }>(
    "SELECT display_name, timezone, created_at, settings FROM profiles WHERE user_id = ?",
    authUser.id
  );
  const settings = json(p?.settings, {}) as { avatarUrl?: string };
  const meta = (authUser.user_metadata ?? {}) as { name?: string; avatarUrl?: string };
  return {
    id: authUser.id,
    email: authUser.email ?? "",
    name: p?.display_name ?? meta.name ?? null,
    timezone: p?.timezone ?? "UTC",
    created_at: p?.created_at ?? authUser.created_at,
    avatarUrl: settings.avatarUrl ?? meta.avatarUrl ?? null,
  };
}
