-- =============================================================================
-- Edge: core-loop database (Phase 1)
--
-- Tables from PRD section 9.3 needed for the core loop:
--   plan -> checklist -> evidence images -> workspace -> gate -> override -> journal.
-- Rules from PRD 9.2 and 9.5 are enforced here in the database, not only in code.
--
-- Supabase specifics:
--   - Users come from Supabase Auth (auth.users). `profiles` holds user_settings.
--   - Row-level security: each trader can only see and change their own rows.
--   - Server code that must bypass RLS (AI runs, audit log) uses the service role.
--
-- Apply: paste into Supabase SQL Editor and Run, or `supabase db push`.
-- Owner: Sheyi. Never edit this file after it has been applied; add 0002_*.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- True while a row's owner is being deleted (account deletion, flow F13): the
-- auth.users row is already gone when the cascade reaches child tables.
create or replace function public.owner_is_gone(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
     and not exists (select 1 from auth.users where id = p_user_id);
$$;

-- Blocks UPDATE and DELETE on append-only tables (PRD 9.2).
-- The only exception is account deletion, which purges everything (F13).
create or replace function public.forbid_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and public.owner_is_gone((to_jsonb(old) ->> 'user_id')::uuid) then
    return old;
  end if;
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'check_violation';
end $$;

-- -----------------------------------------------------------------------------
-- Identity and settings
-- -----------------------------------------------------------------------------

create table public.profiles (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  display_name      text,
  timezone          text not null default 'UTC',
  preferred_markets text[] not null default '{}',
  theme             text not null default 'dark',
  locale            text not null default 'en',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Every new Supabase Auth user gets a profile row automatically.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- F1 step 3: disclaimer acceptance, stored per version.
create table public.legal_acceptances (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  document_type    text not null check (document_type in ('disclaimer', 'terms', 'privacy', 'risk_notice')),
  document_version text not null,
  accepted_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- LLM runs (PRD 5.6, REQ-LLM-1): every model call is recorded. Append-only.
-- -----------------------------------------------------------------------------

create table public.llm_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users (id) on delete cascade,
  job            text not null check (job in ('plan_extract', 'plan_patch', 'image_interpret', 'rule_check', 'journal', 'digest')),
  provider       text not null,
  model          text not null,
  prompt_version text,
  schema_version text,
  input_manifest jsonb,
  output         jsonb,
  status         text not null check (status in ('ok', 'invalid_output', 'error', 'timeout')),
  error_code     text,
  latency_ms     integer,
  tokens_in      integer,
  tokens_out     integer,
  cost_minor     bigint,
  created_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Chat and plan (PRD 4.1, 4.2)
-- -----------------------------------------------------------------------------

create table public.checklists (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  market_tag        text,
  active_version_id uuid,  -- FK added below, after checklist_versions exists
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table public.chats (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  purpose      text not null check (purpose in ('build_edge', 'update_edge', 'review_trade')),  -- PR-CH-5
  checklist_id uuid references public.checklists (id) on delete set null,
  title        text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  chat_id           uuid not null references public.chats (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  role              text not null check (role in ('trader', 'edge')),
  content           text,
  audio_object_key  text,
  transcript        text,
  transcript_status text check (transcript_status in ('pending', 'ready', 'confirmed', 'failed')),
  llm_run_id        uuid references public.llm_runs (id),
  created_at        timestamptz not null default now()
);

-- PR-CL-3: approved versions are immutable; edits create a new draft.
create table public.checklist_versions (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null references public.checklists (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status         text not null default 'draft' check (status in ('draft', 'approved', 'superseded', 'archived')),
  source_chat_id uuid references public.chats (id),  -- chats are soft-deleted (deleted_at)
  approved_at    timestamptz,
  change_note    text,
  content_hash   text,
  created_at     timestamptz not null default now(),
  unique (checklist_id, version_number),
  check (status = 'draft' or approved_at is not null)
);

alter table public.checklists
  add constraint checklists_active_version_fk
  foreign key (active_version_id) references public.checklist_versions (id) on delete set null;

create table public.checklist_items (
  id                  uuid primary key default gen_random_uuid(),
  version_id          uuid not null references public.checklist_versions (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  item_key            text not null,  -- stable across versions; links evidence images to the rule
  position            integer not null,
  category            text not null check (category in ('entry', 'context', 'confirmation', 'invalidation', 'risk', 'note')),  -- PR-CL-1
  title               text not null,
  description         text,
  severity            text not null check (severity in ('hard_gate', 'soft')),
  assessability       text not null check (assessability in ('chart', 'context_needed', 'manual')),
  required_timeframe  text,
  source_span         text not null check (length(trim(source_span)) > 0),  -- REQ-LLM-3: no rule without the trader's own words
  created_at          timestamptz not null default now(),
  unique (version_id, item_key)
);

create table public.item_clarifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  chat_id    uuid references public.chats (id) on delete cascade,
  item_id    uuid references public.checklist_items (id) on delete cascade,
  question   text not null,
  answer     text,
  resolution text check (resolution in ('answered', 'judgment_call', 'dismissed')),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Evidence (PRD 4.3, 5.3)
-- -----------------------------------------------------------------------------

create table public.evidence_images (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users (id) on delete cascade,
  checklist_id                uuid not null references public.checklists (id) on delete cascade,
  item_key                    text not null,
  slot                        smallint not null check (slot between 1 and 6),        -- PR-EV-1
  polarity                    text not null check (polarity in ('valid', 'invalid')),  -- PR-EV-2
  status                      text not null default 'uploaded'
                                check (status in ('uploaded', 'interpreted', 'confirmed', 'replaced', 'archived', 'do_not_use')),
  object_key                  text not null,
  mime_type                   text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),  -- REQ-DT-2
  bytes                       integer not null check (bytes > 0 and bytes <= 10485760),                      -- 10 MB
  width                       integer,
  height                      integer,
  sha256                      text,
  scan_status                 text not null default 'pending' check (scan_status in ('pending', 'clean', 'rejected')),
  trader_note                 text,
  annotations                 jsonb,
  interpretation_text         text,
  interpretation_confirmed_at timestamptz,
  supersedes_id               uuid references public.evidence_images (id),
  created_at                  timestamptz not null default now(),
  archived_at                 timestamptz,
  -- PR-EV-3: an image is only "confirmed" once the trader confirmed Edge's reading
  check (status <> 'confirmed' or interpretation_confirmed_at is not null)
);

-- One active image per slot.
create unique index evidence_images_active_slot
  on public.evidence_images (checklist_id, item_key, slot)
  where status not in ('replaced', 'archived', 'do_not_use');

create table public.rule_cards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  checklist_id     uuid not null references public.checklists (id) on delete cascade,
  item_key         text not null,
  card_version     integer not null default 1,
  valid_summary    text,
  invalid_summary  text,
  coverage         jsonb,  -- timeframes, instruments
  source_image_ids uuid[] not null default '{}',
  llm_run_id       uuid references public.llm_runs (id),
  built_at         timestamptz not null default now(),
  unique (checklist_id, item_key, card_version)
);

-- -----------------------------------------------------------------------------
-- Workspace and gate (PRD 4.4, 4.5)
-- -----------------------------------------------------------------------------

-- Shared reference list of instruments; readable by every signed-in trader.
create table public.instruments (
  id               uuid primary key default gen_random_uuid(),
  symbol           text not null,
  asset_class      text not null check (asset_class in ('forex', 'stock', 'crypto', 'index', 'futures', 'commodity')),
  venue            text not null default '',
  display_name     text,
  provider_symbols jsonb,
  unique (symbol, venue)
);

create table public.workspace_sessions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  checklist_version_id uuid not null references public.checklist_versions (id),
  instrument_id        uuid references public.instruments (id),
  platform             text,
  started_at           timestamptz not null default now(),
  ended_at             timestamptz
);

create table public.chart_frames (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_id    uuid not null references public.workspace_sessions (id) on delete cascade,
  instrument_id uuid references public.instruments (id),
  timeframe     text not null,
  visible_from  timestamptz,
  visible_to    timestamptz,
  indicators    jsonb,
  source        text not null check (source in ('edge_chart', 'data_render', 'tab_capture', 'user_capture')),  -- PRD 5.4 A to D
  object_key    text,
  sha256        text,
  captured_at   timestamptz not null default now()
);

-- Append-only: every comparison keeps its evidence (PR-TW-6).
create table public.rule_checks (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  session_id              uuid not null references public.workspace_sessions (id) on delete cascade,
  item_key                text not null,
  frame_id                uuid references public.chart_frames (id),
  llm_run_id              uuid references public.llm_runs (id),
  result                  text not null check (result in ('pass', 'fail', 'inconclusive')),
  observed_facts          jsonb,
  inferred_interpretation text,
  reasoning               text,
  confidence_band         text check (confidence_band in ('low', 'medium', 'high')),
  evidence                jsonb,  -- frame ID, candle range, reference image IDs
  missing_evidence        text,
  is_hard_gate            boolean not null,
  checked_at              timestamptz not null default now(),
  stale_after             timestamptz
);

create table public.trade_intents (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  session_id         uuid not null references public.workspace_sessions (id),
  instrument_id      uuid references public.instruments (id),
  side               text not null check (side in ('buy', 'sell')),
  order_type         text not null default 'market' check (order_type in ('market', 'limit', 'stop')),
  size               numeric not null check (size > 0),
  entry_price        numeric,
  stop_price         numeric,
  target_price       numeric,
  risk_amount_minor  bigint,   -- money as integer minor units (PRD 9.2)
  currency           text,
  risk_reward        numeric,
  status             text not null default 'created'
                       check (status in ('created', 'checking', 'decided', 'expired', 'cancelled', 'sent')),
  idempotency_key    text unique,  -- EC-G8: a double click creates one intent
  expires_at         timestamptz,
  created_at         timestamptz not null default now()
);

-- Append-only except the resolution fields (PRD 9.2).
create table public.gate_decisions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  intent_id            uuid not null references public.trade_intents (id),
  checklist_version_id uuid not null references public.checklist_versions (id),
  result               text not null check (result in ('approved', 'denied', 'needs_evidence')),
  hard_gate_status     text not null check (hard_gate_status in ('passed', 'failed', 'unresolved')),
  rollup               jsonb,
  reasons              jsonb,
  rule_check_ids       uuid[] not null default '{}',
  valid_until          timestamptz,     -- REQ-GT-3: approvals expire
  price_tolerance      numeric,
  snapshot             jsonb not null,  -- REQ-GT-5: checklist, checks, frames, ticket, model versions
  snapshot_hash        text,
  decided_at           timestamptz not null default now(),
  resolution           text check (resolution in ('accepted_denial', 'overridden', 'expired', 'executed', 'cancelled')),
  resolved_at          timestamptz,
  -- PRD 9.5 gate integrity: approved only when hard gates passed; a failed hard gate forces denied.
  check ((result = 'approved') = (hard_gate_status = 'passed')),
  check (hard_gate_status <> 'failed' or result = 'denied'),
  check (hard_gate_status <> 'unresolved' or result = 'needs_evidence'),
  check (result <> 'approved' or valid_until is not null)
);

-- PR-OV-1, REQ-GT-6: an override is always recorded with the failed rules.
create table public.overrides (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  decision_id       uuid not null unique references public.gate_decisions (id),
  rules_overridden  jsonb not null,
  reason_code       text,
  reason_text       text,
  created_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Trades and journal (PRD 4.6, 4.7)
-- -----------------------------------------------------------------------------

create table public.trades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  decision_id   uuid references public.gate_decisions (id),  -- null = "no pre-trade check" (EC-J1)
  instrument_id uuid references public.instruments (id),
  side          text not null check (side in ('buy', 'sell')),
  status        text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  opened_at     timestamptz,
  closed_at     timestamptz,
  entry_price   numeric,
  stop_price    numeric,
  target_price  numeric,
  exit_price    numeric,
  size          numeric,
  risk_pct      numeric,
  outcome_r     numeric,
  pnl_minor     bigint,
  currency      text,
  source        text not null default 'manual' check (source in ('manual', 'edge_order', 'import', 'outside_gate')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.journal_entries (
  id                            uuid primary key default gen_random_uuid(),
  user_id                       uuid not null references auth.users (id) on delete cascade,
  trade_id                      uuid references public.trades (id) on delete set null,
  decision_id                   uuid references public.gate_decisions (id),
  status                        text not null default 'pending' check (status in ('pending', 'generated', 'edited', 'completed')),
  summary                       text,
  compliance                    jsonb,
  edge_result                   text check (edge_result in ('approved', 'denied', 'needs_evidence')),
  trader_decision               text check (trader_decision in ('followed', 'accepted_denial', 'overridden', 'no_check')),
  override_id                   uuid references public.overrides (id),
  execution_quality             text,  -- kept separate from profit (PR-OV-3)
  execution_quality_explanation text,
  strengths                     text,
  deviations                    text,
  lessons                       text,
  user_notes                    text,
  llm_run_id                    uuid references public.llm_runs (id),
  generated_at                  timestamptz,
  completed_at                  timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Governance
-- -----------------------------------------------------------------------------

create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid,  -- no foreign key on purpose: the audit log outlives deleted accounts (kept 24 months)
  actor_type    text not null check (actor_type in ('trader', 'system', 'support')),
  action        text not null,
  object_type   text,
  object_id     uuid,
  ip_hash       text,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Integrity rules (PRD 9.2, 9.5)
-- -----------------------------------------------------------------------------

-- Append-only tables.
create trigger llm_runs_append_only    before update or delete on public.llm_runs    for each row execute function public.forbid_change();
create trigger rule_checks_append_only before update or delete on public.rule_checks for each row execute function public.forbid_change();
create trigger overrides_append_only   before update or delete on public.overrides   for each row execute function public.forbid_change();
create trigger audit_log_append_only   before update or delete on public.audit_log   for each row execute function public.forbid_change();

-- PR-CL-3: an approved version cannot be changed in place.
-- Allowed: draft -> approved (once), approved -> superseded/archived, superseded -> archived.
create or replace function public.guard_checklist_version()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and not public.owner_is_gone(old.user_id) then
      raise exception 'approved checklist versions cannot be deleted; archive the checklist instead (EC-P11)'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status <> 'draft' then
    if new.checklist_id is distinct from old.checklist_id
       or new.version_number is distinct from old.version_number
       or new.approved_at is distinct from old.approved_at
       or new.content_hash is distinct from old.content_hash
       or new.change_note is distinct from old.change_note
       or new.source_chat_id is distinct from old.source_chat_id then
      raise exception 'approved checklist versions are immutable; create a new draft instead (PR-CL-3)'
        using errcode = 'check_violation';
    end if;
    if not ((old.status = 'approved'   and new.status in ('approved', 'superseded', 'archived'))
         or (old.status = 'superseded' and new.status in ('superseded', 'archived'))
         or (old.status = 'archived'   and new.status = 'archived')) then
      raise exception 'invalid checklist version status change: % -> %', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger checklist_versions_guard
  before update or delete on public.checklist_versions
  for each row execute function public.guard_checklist_version();

-- Items can only be added, changed or removed while their version is a draft.
create or replace function public.guard_checklist_item()
returns trigger language plpgsql as $$
declare
  v_status text;
begin
  select status into v_status
  from public.checklist_versions
  where id = coalesce(new.version_id, old.version_id);

  -- The version itself is being deleted (cascade) only when it is a draft.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'rules of an approved checklist version cannot be changed (PR-CL-3)'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

create trigger checklist_items_guard
  before insert or update or delete on public.checklist_items
  for each row execute function public.guard_checklist_item();

-- REQ-DT-1 / PR-EV-1: at most 6 active evidence images per rule.
create or replace function public.guard_evidence_limit()
returns trigger language plpgsql as $$
declare
  v_active integer;
begin
  if new.status in ('replaced', 'archived', 'do_not_use') then
    return new;
  end if;

  -- Serialise uploads for the same rule so two parallel uploads cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended(new.checklist_id::text || ':' || new.item_key, 0));

  select count(*) into v_active
  from public.evidence_images
  where checklist_id = new.checklist_id
    and item_key = new.item_key
    and status not in ('replaced', 'archived', 'do_not_use')
    and id <> new.id;

  if v_active >= 6 then
    raise exception 'a rule can have at most 6 evidence images; replace one instead (PR-EV-1)'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger evidence_images_limit
  before insert or update of status, checklist_id, item_key on public.evidence_images
  for each row execute function public.guard_evidence_limit();

-- Gate decisions: only the resolution fields may change, and only once.
create or replace function public.guard_gate_decision()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if public.owner_is_gone(old.user_id) then
      return old;
    end if;
    raise exception 'gate decisions cannot be deleted' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'resolution' - 'resolved_at') is distinct from (to_jsonb(old) - 'resolution' - 'resolved_at') then
    raise exception 'gate decisions are append-only; only resolution and resolved_at can be set'
      using errcode = 'check_violation';
  end if;
  if old.resolution is not null and new.resolution is distinct from old.resolution then
    raise exception 'gate decision is already resolved as %', old.resolution using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger gate_decisions_guard
  before update or delete on public.gate_decisions
  for each row execute function public.guard_gate_decision();

-- An override only exists for a denied decision (PR-GT-4, PR-OV-1).
create or replace function public.guard_override()
returns trigger language plpgsql as $$
declare
  v_result text;
begin
  select result into v_result from public.gate_decisions where id = new.decision_id;
  if v_result is distinct from 'denied' then
    raise exception 'only a denied decision can be overridden (got %)', coalesce(v_result, 'no decision')
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger overrides_only_denied
  before insert on public.overrides
  for each row execute function public.guard_override();

-- PRD 9.5: a checklist version can be used at the gate only when every rule that
-- is not manual has at least one confirmed evidence image.
create or replace function public.checklist_version_gate_ready(p_version_id uuid)
returns boolean language sql stable as $$
  select exists (
           select 1 from public.checklist_versions v
           where v.id = p_version_id and v.status = 'approved'
         )
     and not exists (
           select 1
           from public.checklist_items i
           join public.checklist_versions v on v.id = i.version_id
           where i.version_id = p_version_id
             and i.assessability <> 'manual'
             and not exists (
               select 1 from public.evidence_images e
               where e.checklist_id = v.checklist_id
                 and e.item_key = i.item_key
                 and e.status = 'confirmed'
             )
         );
$$;

-- updated_at
create trigger profiles_updated_at        before update on public.profiles        for each row execute function public.set_updated_at();
create trigger checklists_updated_at      before update on public.checklists      for each row execute function public.set_updated_at();
create trigger trades_updated_at          before update on public.trades          for each row execute function public.set_updated_at();
create trigger journal_entries_updated_at before update on public.journal_entries for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Indexes (PRD 9.5)
-- -----------------------------------------------------------------------------

create index chats_user_created           on public.chats (user_id, created_at desc);
create index chat_messages_chat_created   on public.chat_messages (chat_id, created_at);
create index checklists_user              on public.checklists (user_id);
create index checklist_items_version      on public.checklist_items (version_id, position);
create index evidence_images_rule         on public.evidence_images (checklist_id, item_key);
create index chart_frames_session_tf      on public.chart_frames (session_id, timeframe, captured_at desc);
create index rule_checks_session_item     on public.rule_checks (session_id, item_key, checked_at desc);
create index trade_intents_session        on public.trade_intents (session_id, created_at desc);
create index gate_decisions_intent        on public.gate_decisions (intent_id, decided_at desc);
create index trades_user_created          on public.trades (user_id, created_at desc);
create index journal_entries_user_created on public.journal_entries (user_id, created_at desc);
create index llm_runs_user_created        on public.llm_runs (user_id, created_at desc);
create index audit_log_object             on public.audit_log (object_type, object_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Row-level security: a trader sees and changes only their own rows (PRD 9.2).
-- The service role (server only) bypasses RLS.
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'legal_acceptances', 'chats', 'chat_messages', 'checklists',
    'checklist_versions', 'checklist_items', 'item_clarifications', 'evidence_images',
    'rule_cards', 'workspace_sessions', 'chart_frames', 'trade_intents', 'trades',
    'journal_entries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;

  -- Written only by the server (service role); traders can read their own.
  foreach t in array array['llm_runs', 'rule_checks', 'gate_decisions', 'overrides'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "read own rows" on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;  -- server only, no trader access

alter table public.instruments enable row level security;
create policy "signed-in traders can read instruments"
  on public.instruments for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- File storage: private buckets, one folder per user (PRD 9.5: object keys
-- namespaced by user, served by short-lived signed links).
-- Object names must start with the user's ID, e.g. "<user_id>/<file>.png".
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('evidence', 'evidence', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('frames',   'frames',   false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "evidence and frames: own folder only"
  on storage.objects for all to authenticated
  using (
    bucket_id in ('evidence', 'frames')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id in ('evidence', 'frames')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
