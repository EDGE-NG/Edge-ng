/**
 * Which ticket a platform gets (decision, Daniel, 2026-11-26): crypto
 * exchanges get the spot ticket, everything else the lot ticket. Shared by
 * the workspace and the server.
 */
export function ticketStyle(platform: string): "spot" | "lots" {
  return platform === "Binance" || platform === "Bybit" || platform === "OKX" ? "spot" : "lots";
}
