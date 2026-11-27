-- =============================================================================
-- Edge: shared market-data cache (PRD 5.7 cost control).
--
-- Forex, metals and index candles come from Twelve Data, whose free plan
-- allows about 8 requests a minute and 800 a day. The chart, the live
-- re-checks, checklist alerts and trade watching each asked for candles, and
-- every Vercel server copy kept its own short cache, so one trader on a forex
-- chart could use a few hundred requests an hour.
--
-- This table keeps the latest candles per instrument and timeframe for every
-- server (web/lib/market-cache.ts), so the number of requests depends on how
-- many markets are open, not on how many traders or servers there are.
-- Crypto (Binance, no key) is not stored here.
--
-- Public market data only, no user data. Server only: row-level security is
-- on with no policies. Additive; safe to apply on the live database.
-- =============================================================================

create table public.market_cache (
  key         text primary key,        -- "<provider>|<symbol>|<timeframe>|<limit>"
  fetched_at  timestamptz not null,
  candles     jsonb not null
);

alter table public.market_cache enable row level security;
