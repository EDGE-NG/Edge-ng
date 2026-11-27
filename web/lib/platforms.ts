/** Which ticket a platform gets (decision, Daniel, 2026-11-21). Shared by the workspace and the server. */
export function ticketStyle(platform: string): "mt" | "spot" | "edge" {
  // MT5-style New Order window: MetaTrader and the forex platforms that work in lots
  if (/^MetaTrader/.test(platform) || ["cTrader", "TradeLocker", "Match-Trader"].includes(platform)) return "mt";
  if (platform === "Binance" || platform === "Bybit" || platform === "OKX") return "spot";
  return "edge";
}
