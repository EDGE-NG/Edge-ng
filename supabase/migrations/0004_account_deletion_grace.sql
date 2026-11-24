-- =============================================================================
-- Edge: 14-day grace period for account deletion (PRD F13; decision by Daniel,
-- review of PR #18, 2026-11-24).
--
-- "Delete my account" no longer deletes at once. It sets deletion_due_at to 14
-- days ahead and signs the trader out everywhere. Signing in again before then
-- clears it (the deletion is cancelled). A daily job (/api/account/purge)
-- deletes the files and the account of every profile whose date has passed.
--
-- Additive only.
-- =============================================================================

alter table public.profiles
  add column deletion_due_at timestamptz;

-- the daily purge only looks at accounts waiting to be deleted
create index profiles_deletion_due on public.profiles (deletion_due_at)
  where deletion_due_at is not null;
