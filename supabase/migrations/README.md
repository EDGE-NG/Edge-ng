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

## How to apply

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the whole file and click **Run**. It should finish with "Success. No rows returned".
3. Check **Table Editor**: the new tables appear under `public`. Check **Storage**: buckets `evidence` and `frames`.

Apply each migration **once**, after its pull request is merged.
