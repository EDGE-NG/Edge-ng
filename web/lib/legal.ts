/**
 * Legal documents the trader accepts (PRD F1 step 3).
 * Bump the version when the disclaimer wording changes; acceptances are
 * stored per version in legal_acceptances.
 */
export const DISCLAIMER_VERSION = "2026-11-12";

/** The disclaimer as shown next to the sign-up checkbox and the Google button. */
export const DISCLAIMER_TEXT =
  "Edge is decision support, not financial advice. It gives no signals, and I make every trade.";

/**
 * Short-lived cookie set when "Continue with Google" starts, carrying what the
 * trader accepted and their time zone to /auth/callback.
 */
export const OAUTH_COOKIE = "edge_oauth";
