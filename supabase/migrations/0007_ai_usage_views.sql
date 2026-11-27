-- =============================================================================
-- Edge: AI usage and cost views (PRD 5.7 cost control).
--
-- Every AI call is already logged in public.llm_runs (job, provider, model,
-- status, latency, tokens). This adds read-only summaries of it, for the
-- team, in a private `ops` schema:
--
--   ops.llm_prices          price per model, filled in by hand (see below)
--   ops.ai_usage_daily      per UTC day, job, provider and model
--   ops.ai_usage_monthly    per UTC month, provider and model
--   ops.ai_usage_top_users  the 50 heaviest users over the last 30 days
--
-- Read them in Supabase: Table Editor (pick the `ops` schema) or SQL Editor,
-- e.g.  select * from ops.ai_usage_daily limit 50;
--
-- `ops` is not exposed through the Supabase API, and anon / authenticated
-- have no access to it, so browsers can never read these numbers.
--
-- Costs are estimates: est_cost_usd is NULL for a row until every model in it
-- has a price in ops.llm_prices. For speech-to-text (job 'transcribe'),
-- tokens_in holds the audio length in seconds, so it is priced per audio hour.
-- Additive only; safe to apply on the live database.
-- =============================================================================

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

-- Prices in US dollar micros (1 USD = 1,000,000), so they stay integers
-- (PRD 9.2: money as integer minor units plus a currency).
create table ops.llm_prices (
  provider                   text not null,   -- as in llm_runs.provider: groq, google, openrouter, openai, ...
  model                      text not null,   -- as in llm_runs.model
  usd_micros_per_mtok_in     bigint not null default 0 check (usd_micros_per_mtok_in >= 0),   -- per 1M input tokens
  usd_micros_per_mtok_out    bigint not null default 0 check (usd_micros_per_mtok_out >= 0),  -- per 1M output tokens
  usd_micros_per_audio_hour  bigint not null default 0 check (usd_micros_per_audio_hour >= 0), -- speech-to-text
  note                       text,            -- e.g. "free tier" or the pricing page date
  updated_at                 timestamptz not null default now(),
  primary key (provider, model)
);

-- One run's estimated cost in USD, or NULL when the model has no price.
create view ops.llm_run_costs with (security_invoker = true) as
select
  r.*,
  case
    when p.provider is null then null
    when r.job = 'transcribe' then coalesce(r.tokens_in, 0) / 3600.0 * p.usd_micros_per_audio_hour / 1e6
    else (coalesce(r.tokens_in, 0) * p.usd_micros_per_mtok_in
        + coalesce(r.tokens_out, 0) * p.usd_micros_per_mtok_out) / 1e12
  end as est_cost_usd,
  p.provider is not null as priced
from public.llm_runs r
left join ops.llm_prices p on p.provider = r.provider and p.model = r.model;

create view ops.ai_usage_daily with (security_invoker = true) as
select
  (created_at at time zone 'UTC')::date                         as day,
  job,
  provider,
  model,
  count(*)                                                      as runs,
  count(*) filter (where status = 'ok')                         as ok,
  count(*) filter (where status = 'timeout')                    as timeouts,
  count(*) filter (where status in ('error', 'invalid_output')) as errors,
  round(avg(latency_ms))::integer                               as avg_ms,
  percentile_cont(0.95) within group (order by latency_ms)::integer as p95_ms,
  sum(tokens_in) filter (where job <> 'transcribe')             as tokens_in,
  sum(tokens_out)                                               as tokens_out,
  sum(tokens_in) filter (where job = 'transcribe')              as audio_seconds,
  count(distinct user_id)                                       as users,
  case when bool_and(priced) then round(sum(est_cost_usd)::numeric, 4) end as est_cost_usd
from ops.llm_run_costs
group by 1, 2, 3, 4
order by day desc, runs desc;

create view ops.ai_usage_monthly with (security_invoker = true) as
select
  to_char(created_at at time zone 'UTC', 'YYYY-MM')              as month,
  provider,
  model,
  count(*)                                                      as runs,
  count(*) filter (where status <> 'ok')                        as failed,
  sum(tokens_in) filter (where job <> 'transcribe')             as tokens_in,
  sum(tokens_out)                                               as tokens_out,
  sum(tokens_in) filter (where job = 'transcribe')              as audio_seconds,
  count(distinct user_id)                                       as users,
  case when bool_and(priced) then round(sum(est_cost_usd)::numeric, 2) end as est_cost_usd
from ops.llm_run_costs
group by 1, 2, 3
order by month desc, runs desc;

-- Heaviest users, to spot abuse or a runaway loop. User id only: look the
-- account up in Authentication if needed.
create view ops.ai_usage_top_users with (security_invoker = true) as
select
  user_id,
  count(*)                                                      as runs_30d,
  count(*) filter (where job = 'rule_check')                    as rule_checks,
  count(*) filter (where job = 'image_interpret')               as image_reads,
  count(*) filter (where job in ('plan_extract', 'plan_patch')) as plan_runs,
  count(*) filter (where job = 'transcribe')                    as voice_notes,
  count(*) filter (where status <> 'ok')                        as failed,
  case when bool_and(priced) then round(sum(est_cost_usd)::numeric, 2) end as est_cost_usd
from ops.llm_run_costs
where created_at > now() - interval '30 days'
group by user_id
order by runs_30d desc
limit 50;

revoke all on all tables in schema ops from public, anon, authenticated;

-- Speeds up the daily and monthly summaries as llm_runs grows.
create index if not exists llm_runs_created_at on public.llm_runs (created_at);
