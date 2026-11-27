-- =============================================================================
-- Edge: shared rate limits (sign-in, sign-up, password reset, uploads, voice).
--
-- The limits used to live in each server's memory, so on Vercel every server
-- copy counted on its own and a guesser could spread attempts across them.
-- This table holds one counter per key for every server (web/lib/rate-limit.ts).
--
-- Keys are SHA-256 hashes (e.g. of "login:<email>"), never the email or IP
-- itself. Expired rows are removed by the daily job (/api/account/purge).
-- Server only: row-level security is on with no policies, so browsers can't
-- read or write it. Additive only; safe to apply on the live database.
-- =============================================================================

create table public.rate_limits (
  key       text primary key,         -- sha256 hex of the limit's name and subject
  count     integer not null default 1 check (count > 0),
  reset_at  timestamptz not null
);

create index rate_limits_reset_at on public.rate_limits (reset_at);

alter table public.rate_limits enable row level security;

-- One attempt: start a new window if the old one ended, otherwise add one.
-- Returns the count in the current window. Atomic, so two servers counting at
-- the same moment both see the right number.
create function public.rate_limit_hit(p_key text, p_window_ms integer)
returns integer
language sql
security invoker
set search_path = ''
as $$
  insert into public.rate_limits as r (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update
    set count    = case when r.reset_at <= now() then 1 else r.count + 1 end,
        reset_at = case when r.reset_at <= now() then excluded.reset_at else r.reset_at end
  returning count;
$$;

revoke all on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
