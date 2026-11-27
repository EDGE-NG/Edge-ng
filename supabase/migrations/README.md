# Database migrations

SQL migrations for the Supabase (PostgreSQL) database. Owner: Sheyi.

Tables, rules and indexes follow PRD section 9 (9.2 design rules, 9.3 tables, 9.5 integrity rules). Files run in order: `0001_core_loop.sql`, `0002_...sql`. **Never edit a migration that has already been applied; add a new one.**

## What `0001_core_loop.sql` creates

The Phase 1 core loop: profiles (created automatically for each Supabase Auth user), chats and messages, checklists, versions and rules, evidence images and rule cards, instruments, workspace sessions, chart frames, rule checks, trade intents, gate decisions, overrides, trades, journal entries, LLM runs, audit log, and two private storage buckets (`evidence`, `frames`).

Rules enforced by the database itself:

- Approved checklist versions and their rules can't be changed (PR-CL-3).
- Every rule must quote the trader's own words (REQ-LLM-3).
- At most 6 evidence images per rule; png, jpeg or webp up to 10 MB (PR-EV-1, REQ-DT-2).
- An image is only "confirmed" after the trader confirms Edge's reading (PR-EV-3).
- A gate decision can be "approved" only when hard gates passed, a failed hard gate forces "denied", and approvals must expire (PRD 9.5, REQ-GT-3).
- Gate decisions, rule checks, overrides, LLM runs and the audit log are append-only.
- An override can only exist for a denied decision.
- Row-level security: each trader sees only their own rows and their own storage folder (`<user_id>/...`). Gate decisions, rule checks and LLM runs are written by the server only.
- Deleting an account purges all its data (flow F13); the audit log is kept.
- `checklist_version_gate_ready(version_id)` says whether a version can be used at the gate (every non-manual rule has a confirmed image).

## What `0002_web_app_fields.sql` adds

Additive only (nothing dropped or renamed), for the web app moving off its temporary SQLite file: profile settings, chat message kinds and payloads, Edge's structured image readings, the candles behind each chart frame, ticket fields (account size, risk amount and percent), the decision's reference price, "placed" as a Phase 1 outcome, and "transcribe" as an AI job. It also lets an overridden decision be marked placed or cancelled, and lets a trader override a "needs evidence" decision as well as a denial (PRD F6: when Edge can't check, the trader can still proceed and it's recorded).

## What `0003_checklist_alerts.sql` adds (draft by Daniel, for Sheyi to review)

Checklist alerts: `checklist_monitors` (markets a trader asked Edge to watch with a checklist), `alert_events` (each time the chart rules started passing; append-only except `read_at` and `deliveries`), `push_subscriptions` (browser and phone devices for Web Push), and `workspace_sessions.kind` (`trade` or `monitor`), so a monitor's background checks keep the same audit trail without touching the trader's own workspace session. **Apply it before deploying the web code that uses it**: the workspace now filters sessions by `kind`.

## What `0005_rate_limits.sql` adds

`rate_limits`, one counter per key for the sign-in, sign-up, password reset, upload and voice limits, plus `rate_limit_hit(key, window_ms)`, which counts one attempt atomically. The limits used to live in each server's memory, so on Vercel every server copy counted on its own. Keys are SHA-256 hashes, never an email or IP. Server only (row-level security on, no policies). Expired rows are removed by the daily job. **Apply it before deploying the web code that uses it**; until then the web code falls back to the old per-server counter.
## What `0006_audit_log_retention.sql` adds

Audit log retention of 24 months, as the schema and the Privacy Policy say. The log stays append-only; the only exception is `purge_old_audit_log(limit)`, which deletes rows older than 24 months (oldest first) and is called by the daily job. Updates, and deleting anything younger than 24 months, are still refused by the database. Server only.

## What `0007_ai_usage_views.sql` adds

Read-only AI usage and cost summaries of `llm_runs`, in a private `ops` schema (not exposed through the API; browsers can't read it):

- `ops.ai_usage_daily`: per day, job, provider and model: runs, timeouts, errors, average and p95 time, tokens, voice seconds, users, estimated cost.
- `ops.ai_usage_monthly`: the same per month, provider and model.
- `ops.ai_usage_top_users`: the 50 heaviest users over the last 30 days (to spot abuse or a runaway loop).
- `ops.llm_prices`: one row per provider and model, in US dollar micros (1 USD = 1,000,000) per million tokens, or per audio hour for speech-to-text. **Fill it in from each provider's pricing page**; a summary row shows no cost until every model in it has a price. For a free tier, enter 0.

To read: Supabase → **SQL Editor**, e.g. `select * from ops.ai_usage_daily limit 50;`, or **Table Editor** → schema `ops`.

To add a price (example: $0.10 in and $0.40 out per million tokens):

```sql
insert into ops.llm_prices (provider, model, usd_micros_per_mtok_in, usd_micros_per_mtok_out, note)
values ('google', 'gemini-3.1-flash-lite', 100000, 400000, 'pricing page, 2026-11')
on conflict (provider, model) do update
  set usd_micros_per_mtok_in = excluded.usd_micros_per_mtok_in,
      usd_micros_per_mtok_out = excluded.usd_micros_per_mtok_out,
      note = excluded.note, updated_at = now();
```

## What `0008_market_cache.sql` adds

`market_cache`: the latest candles per instrument and timeframe for keyed market data (Twelve Data), shared by every server so Edge stays inside the plan's request limits (`web/lib/market-cache.ts`). Public market data only, no user data; server only (row-level security on, no policies). The per-minute and per-day request counts use `rate_limit_hit` from `0005`. **Apply it before deploying the web code that uses it**; until then, candles are fetched directly as before.

## How to apply

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the whole file and click **Run**. It should finish with "Success. No rows returned".
3. Check **Table Editor**: the new tables appear under `public`. Check **Storage**: buckets `evidence` and `frames`.

Apply each migration **once**, after its pull request is merged.
