-- =============================================================================
-- Edge: fields the web app needs on top of 0001 (additive only).
--
-- The web app (web/) moves from its temporary SQLite file to these tables.
-- Nothing is dropped or renamed; existing rules stay, a few are widened
-- where the app's real flows need it. Safe to apply on the live database.
-- =============================================================================

-- Profiles: account settings (PRD 4.8).
alter table public.profiles add column settings jsonb not null default '{}';

-- Checklists ("edges" in the app): the plan description.
alter table public.checklists add column description text;

-- Versions keep the trader's words they were built from.
alter table public.checklist_versions add column source_text text;

-- Chats are listed by last activity.
alter table public.chats add column updated_at timestamptz not null default now();
create index chats_user_updated on public.chats (user_id, updated_at desc);

-- Chat messages: plain text, a checklist snapshot, or an error notice.
alter table public.chat_messages
  add column kind text not null default 'text' check (kind in ('text', 'checklist', 'error')),
  add column payload jsonb,
  add column via_voice boolean not null default false;

-- Evidence: Edge's structured reading, and whether the trader rewrote it.
alter table public.evidence_images
  add column interpretation_json jsonb,
  add column corrected boolean not null default false;

-- Workspace sessions run against one checklist on one instrument.
alter table public.workspace_sessions
  add column checklist_id uuid references public.checklists (id) on delete cascade,
  add column instrument   text,
  add column asset_class  text,
  add column risk_params  jsonb;

-- Chart frames keep the candles behind them (grounding snapshot, PRD 5.5).
alter table public.chart_frames
  add column instrument text,
  add column candles    jsonb,
  add column data_as_of bigint;

-- Rule checks: who decided (model, code or trader) and which model.
alter table public.rule_checks
  add column source text check (source in ('llm', 'code', 'trader')),
  add column model  text;

-- Trade intents: the app's ticket has no lot size yet; it sizes by risk.
alter table public.trade_intents alter column size drop not null;
alter table public.trade_intents
  add column instrument   text,
  add column account_size numeric,
  add column risk_amount  numeric,
  add column risk_pct     numeric;
alter table public.trade_intents drop constraint trade_intents_status_check;
alter table public.trade_intents add constraint trade_intents_status_check
  check (status in ('created', 'checking', 'decided', 'expired', 'cancelled', 'sent', 'placed'));

-- Gate decisions: the price the approval was given at (REQ-GT-3 tolerance),
-- and "placed" for Phase 1, where the trader places the trade themselves.
alter table public.gate_decisions add column reference_price numeric;
alter table public.gate_decisions drop constraint gate_decisions_resolution_check;
alter table public.gate_decisions add constraint gate_decisions_resolution_check
  check (resolution in ('accepted_denial', 'overridden', 'expired', 'executed', 'placed', 'cancelled'));

-- AI usage: speech-to-text calls are recorded too.
alter table public.llm_runs drop constraint llm_runs_job_check;
alter table public.llm_runs add constraint llm_runs_job_check
  check (job in ('plan_extract', 'plan_patch', 'image_interpret', 'rule_check', 'journal', 'digest', 'transcribe'));

-- Versions: the source text is part of an approved version, so it is locked too.
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
       or new.source_chat_id is distinct from old.source_chat_id
       or new.source_text is distinct from old.source_text then
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

-- Gate decisions: after an override the trader may still place or cancel the
-- trade (Phase 1). Every other resolution is final.
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
  if old.resolution is not null
     and new.resolution is distinct from old.resolution
     and not (old.resolution = 'overridden' and new.resolution in ('placed', 'executed', 'cancelled')) then
    raise exception 'gate decision is already resolved as %', old.resolution using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Overrides: a trader can also proceed when Edge could not check
-- ("needs evidence", e.g. the AI or data feed is down: PRD F6 alternates).
-- An approved trade has nothing to override.
create or replace function public.guard_override()
returns trigger language plpgsql as $$
declare
  v_result text;
begin
  select result into v_result from public.gate_decisions where id = new.decision_id;
  if v_result is null or v_result = 'approved' then
    raise exception 'only a denied or unchecked decision can be overridden (got %)', coalesce(v_result, 'no decision')
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
