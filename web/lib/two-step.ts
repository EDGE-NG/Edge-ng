import type { SupabaseClient } from "@supabase/supabase-js";
import { db, json } from "./db";
import type { TwoStepSettings } from "./totp";

/**
 * Checks whether a user has two-step login enabled (via profiles.settings or Supabase MFA factors).
 */
export async function getUserTwoStepConfig(
  userId: string,
  supabase?: SupabaseClient
): Promise<{ enabled: boolean; factorId: string | null; twoStep: TwoStepSettings }> {
  const profile = await db.one<{ settings: unknown }>(
    "SELECT settings FROM profiles WHERE user_id = ?",
    userId
  );
  const settings = json(profile?.settings, {}) as { two_step?: TwoStepSettings };
  const twoStep = settings.two_step ?? {};

  let factorId: string | null = twoStep.factorId ?? null;
  let supabaseEnabled = false;

  if (supabase) {
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      const verifiedTotp = data?.totp?.find((f) => f.status === "verified");
      if (verifiedTotp) {
        supabaseEnabled = true;
        factorId = verifiedTotp.id;
      }
    } catch {
      /* Supabase MFA factor listing unavailable */
    }
  }

  const enabled = Boolean(twoStep.enabled || supabaseEnabled);
  return { enabled, factorId, twoStep };
}
