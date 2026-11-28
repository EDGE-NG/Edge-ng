-- =============================================================================
-- Edge: shared market-data cache and request budget (PRD 5.7 cost control).
--
-- Forex, metals and index candles come from Twelve Data, whose free plan
-- allows about 8 requests a minute and 800 a day. The chart, live re-checks,
-- checklist alerts and trade watching all ask for candles, on several Vercel
-- server copies (web/lib/market-cache.ts). These tables make them share:
--
--   market_cache   the latest candles per instrument and timeframe, plus who
--                  is refreshing them right now (one server at a time)
--   market_budget  per provider: the next free request slot (calls are spaced
--                  evenly, so no burst can pass the per-minute limit) and the
--                  number of calls made today (UTC)
--
-- Public market data only, no user data. Server only: row-level security is
-- on with no policies, and the functions can't be called by browsers.
-- Additive; safe to apply on the live database.
-- =============================================================================

create table public.market_cache (
  key               text primary key,   -- "<provider>|<symbol>|<timeframe>"
  fetched_at        timestamptz,         -- null until the first fetch lands
  candles           jsonb,
  refreshing_until  timestamptz          -- a server is fetching it until then
);

alter table public.market_cache enable row level security;

create table public.market_budget (
  provider      text primary key,
  next_slot_at  timestamptz not null default now(),
  day           date not null default (now() at time zone 'utc')::date,
  day_count     integer not null default 0 check (day_count >= 0)
);

alter table public.market_budget enable row level security;

-- Claim the refresh of one key for p_hold_ms. True for exactly one caller at a
-- time; the others wait for its result or use what's cached.
create function public.market_claim(p_key text, p_hold_ms integer)
returns boolean
language sql
set search_path = ''
as $$
  with claimed as (
    insert into public.market_cache as m (key, refreshing_until)
    values (p_key, now() + make_interval(secs => p_hold_ms / 1000.0))
    on conflict (key) do update
      set refreshing_until = excluded.refreshing_until
      where m.refreshing_until is null or m.refreshing_until < now()
    returning 1
  )
  select exists (select 1 from claimed);
$$;

-- Reserve one provider call. Calls are spaced p_spacing_ms apart for every
-- server together, and at most p_per_day are made per UTC day. Returns how
-- many milliseconds to wait before calling, or -1 when refused (the next
-- slot is more than p_max_wait_ms away, or today's calls are used up).
-- Only reserved calls are counted.
create function public.market_reserve(p_provider text, p_spacing_ms integer, p_max_wait_ms integer, p_per_day integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  b public.market_budget;
  today date := (now() at time zone 'utc')::date;
  slot timestamptz;
begin
  insert into public.market_budget (provider) values (p_provider) on conflict (provider) do nothing;
  select * into b from public.market_budget where provider = p_provider for update;

  if b.day <> today then
    b.day := today;
    b.day_count := 0;
  end if;
  if b.day_count >= p_per_day then
    update public.market_budget set day = b.day, day_count = b.day_count where provider = p_provider;
    return -1;
  end if;

  slot := greatest(b.next_slot_at, now());
  if slot > now() + make_interval(secs => p_max_wait_ms / 1000.0) then
    return -1;
  end if;

  update public.market_budget
  set next_slot_at = slot + make_interval(secs => p_spacing_ms / 1000.0),
      day = b.day,
      day_count = b.day_count + 1
  where provider = p_provider;
  return greatest(0, ceil(extract(epoch from (slot - now())) * 1000))::integer;
end $$;

revoke all on function public.market_claim(text, integer) from public, anon, authenticated;
revoke all on function public.market_reserve(text, integer, integer, integer) from public, anon, authenticated;
