-- =============================================================================
-- Edge: checklist alerts (DRAFT, written by Daniel for Sheyi to review).
--
-- A trader asks Edge to watch instruments (e.g. Gold, Nasdaq 100) with an
-- approved checklist. On each new candle the server checks the checklist's
-- chart rules from price data (PRD 5.4 source B) and, when every hard-gate
-- chart rule passes, notifies the trader (web push, email). The alert never
-- approves a trade: the trader still opens the workspace and the gate decides.
--
-- Additive only. Not yet in the PRD (product decision by Daniel, Nov 2026).
-- =============================================================================

-- A monitor runs its checks in its own workspace session, so its frames and
-- rule checks keep the same audit trail as the live workspace (PR-TW-6).
-- 'trade' sessions are the trader's own; 'monitor' sessions are background.
alter table public.workspace_sessions
  add column kind text not null default 'trade' check (kind in ('trade', 'monitor'));

-- What the trader asked Edge to watch.
create table public.checklist_monitors (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  checklist_id    uuid not null references public.checklists (id) on delete cascade,
  instrument      text not null,
  asset_class     text not null,
  -- the timeframe used for chart rules that don't name their own
  timeframe       text not null check (timeframe in ('1m', '5m', '15m', '30m', '1h', '4h', '1d')),
  status          text not null default 'active' check (status in ('active', 'paused')),
  -- the background session its checks are stored in (replaced when the checklist gets a new version)
  session_id      uuid references public.workspace_sessions (id) on delete set null,
  -- 'met' = every hard-gate chart rule passed on the last run
  last_state      text not null default 'unknown' check (last_state in ('unknown', 'met', 'not_met')),
  last_summary    jsonb,
  -- per timeframe, the candle period last checked (epoch seconds), so a timeframe is re-checked once per candle
  checked_periods jsonb not null default '{}',
  last_checked_at timestamptz,
  next_check_at   timestamptz not null default now(),
  last_alert_at   timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, checklist_id, instrument)
);
create index checklist_monitors_due  on public.checklist_monitors (status, next_check_at);
create index checklist_monitors_user on public.checklist_monitors (user_id, created_at);

-- Each time a monitor's conditions start passing. Append-only, except that
-- the trader can mark it read and the server records delivery results.
create table public.alert_events (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  monitor_id           uuid references public.checklist_monitors (id) on delete set null,
  checklist_id         uuid references public.checklists (id) on delete cascade,
  checklist_version_id uuid references public.checklist_versions (id),
  session_id           uuid references public.workspace_sessions (id) on delete set null,
  instrument           text not null,
  timeframe            text not null,
  last_price           numeric,
  -- rule-by-rule results at the moment of the alert (the evidence)
  summary              jsonb not null,
  -- { push: { sent, failed }, email: "sent" | "failed" | "off" }
  deliveries           jsonb not null default '{}',
  created_at           timestamptz not null default now(),
  read_at              timestamptz
);
create index alert_events_user_created on public.alert_events (user_id, created_at desc);

create or replace function public.guard_alert_event()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'read_at' - 'deliveries') is distinct from (to_jsonb(old) - 'read_at' - 'deliveries') then
    raise exception 'alert events are append-only; only read_at and deliveries can be set'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger alert_events_guard before update on public.alert_events
  for each row execute function public.guard_alert_event();

-- Browser / phone push subscriptions (Web Push, one row per device).
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

-- Row-level security: traders manage their own monitors and devices; alert
-- events are written by the server only.
alter table public.checklist_monitors enable row level security;
create policy "own rows" on public.checklist_monitors for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.push_subscriptions enable row level security;
create policy "own rows" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.alert_events enable row level security;
create policy "read own rows" on public.alert_events for select to authenticated
  using (user_id = (select auth.uid()));
