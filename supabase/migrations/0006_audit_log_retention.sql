-- =============================================================================
-- Edge: audit log retention (24 months).
--
-- audit_log is append-only (0001_core_loop.sql). Nothing ever removed old
-- rows, but the schema and the Privacy Policy say records such as "this
-- account was deleted" (with its email) are kept for up to 24 months.
--
-- This migration keeps the log append-only and adds one exception: rows older
-- than 24 months may be deleted, and only through purge_old_audit_log(), which
-- the daily job (/api/account/purge) calls. Updates stay forbidden, and so
-- does deleting any row younger than 24 months, even by the purge function.
-- Additive; safe to apply on the live database.
-- =============================================================================

-- The retention period, in one place.
create or replace function public.audit_log_retention()
returns interval language sql immutable as $$
  select interval '24 months';
$$;

-- Guard for audit_log: like forbid_change(), but a DELETE is allowed when the
-- purge function is running in this transaction AND the row is past retention.
create or replace function public.audit_log_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE'
     and current_setting('edge.audit_purge', true) = 'on'
     and old.created_at < now() - public.audit_log_retention() then
    return old;
  end if;
  raise exception 'audit_log is append-only: % is not allowed', tg_op
    using errcode = 'check_violation';
end $$;

drop trigger audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.audit_log_guard();

create index if not exists audit_log_created_at on public.audit_log (created_at);

-- Delete up to p_limit rows past retention, oldest first. Returns how many.
-- The setting is local to this transaction, so it never leaks to other queries.
create or replace function public.purge_old_audit_log(p_limit integer default 5000)
returns integer language plpgsql set search_path = '' as $$
declare
  n integer;
begin
  perform set_config('edge.audit_purge', 'on', true);
  delete from public.audit_log
  where id in (
    select id from public.audit_log
    where created_at < now() - public.audit_log_retention()
    order by created_at
    limit greatest(p_limit, 0)
  );
  get diagnostics n = row_count;
  perform set_config('edge.audit_purge', 'off', true);
  return n;
end $$;

revoke all on function public.purge_old_audit_log(integer) from public, anon, authenticated;
