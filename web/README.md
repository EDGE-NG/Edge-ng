# web: Edge frontend

Next.js 16 (App Router) + Tailwind CSS. Built by Daniel and Mayokun. See the root [README](../README.md) for setup and [AGENTS.md](../AGENTS.md) for project rules. Next.js-specific notes are in [AGENTS.md](AGENTS.md) in this folder.

## What is here

| Path | What it is |
|---|---|
| `app/page.tsx` | Landing page, built from `content/homepage.html` |
| `app/signup`, `app/login` | Sign up and sign in (flow F1) |
| `app/checklist/` | Chat-first edge builder: plan → checklist (4.1, 4.2, flow F2) |
| `app/app/evidence/` | Evidence library (4.3, flow F4) |
| `app/app/workspace/` | Trade workspace with chart and pre-trade gate (4.4, 4.5, flows F5 to F7) |
| `app/app/alerts/` | Checklist alerts: Edge watches markets with the trader's checklist and notifies them |
| `app/app/journal/`, `app/app/settings/` | Journal and settings |
| `app/api/` | Server routes for auth, chats, evidence, market data, transcription and the workspace |
| `lib/db.ts` | Database access (Supabase Postgres) |
| `lib/supabase.ts` | Supabase Auth (sign-in cookies) and Storage (private files) |
| `lib/` (other files) | Checklist building, evidence, AI providers, market data, workspace and gate logic |
| `proxy.ts` | Refreshes the Supabase session and sends signed-out visitors to `/login` |
| `scripts/build-homepage.mjs` | Rebuilds the landing page from `content/homepage.html` (`npm run homepage -w @edge/web`) |

## Where data lives

- **Accounts:** Supabase Auth (passwords, sessions, email confirmation, password reset).
- **Data:** Supabase Postgres, tables from `supabase/migrations/` (checklists, versions, rules, evidence, workspace sessions, rule checks, gate decisions, overrides, AI runs).
- **Files:** Supabase Storage, private buckets `evidence` (example charts) and `frames` (chart captures), one folder per user.
- **AI:** Groq for text; Google Gemini (free key from aistudio.google.com/apikey) for reading chart images and as a text fallback; OpenRouter last, optional (`lib/ai.ts`). Keys stay on the server.
- **Market data:** Binance for crypto (no key), Twelve Data for forex and indices (`lib/market.ts`).

The server connects to Postgres directly, which bypasses row-level security, so every query filters by the signed-in user's id.

## Settings (`web/.env.local`, never committed)

```
# Supabase (Project Settings → API, and Connect → Transaction pooler)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# AI and market data
GROQ_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
TWELVE_DATA_API_KEY=

# Optional
GROQ_MODEL=
GROQ_STT_MODEL=
GROQ_VISION_MODEL=
GEMINI_MODEL=
GEMINI_VISION_MODEL=
OPENROUTER_MODEL=
OPENROUTER_VISION_MODEL=
DATABASE_POOL_MAX=

# Checklist alerts (optional; see "Checklist alerts" below)
CRON_SECRET=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
RESEND_API_KEY=
ALERTS_EMAIL_FROM=
ALERTS_MAX_MONITORS=
APP_URL=
```

- `DATABASE_URL`: use the **Transaction pooler** connection string (port 6543) with the database password.
- `SUPABASE_SERVICE_ROLE_KEY` gives full access: server only, never in a `NEXT_PUBLIC_` variable, never shared in chat.
- Ask Sheyi for the Supabase values and Daniel for the AI and market-data keys.

## Local development with a local Supabase

With Docker running, from the repo root:

```
npx supabase start   # local Supabase; applies supabase/migrations/
```

It prints a local API URL, anon key, service role key and database URL to put in `web/.env.local`. Local sign-ups don't need email confirmation.

Run from the repo root: `npm run dev:web`.

## Continue with Google

The sign-in and sign-up pages have a **Continue with Google** button (PRD F1), handled by Supabase Auth:

- `app/api/auth/google/route.ts` starts it. The button is only active once the trader has accepted the disclaimer (the sign-up checkbox, or the "By continuing with Google…" line on the sign-in page); a 10-minute `edge_oauth` cookie carries that acceptance and the time zone.
- `app/auth/callback/route.ts` finishes it: swaps the code for a session, fills in the profile (name from Google) and stores the disclaimer acceptance for a new account. Google has verified the email, so there's no confirmation email.
- A Google account with the same email as an existing password account signs in to that same account.

**Setup (once, by the Supabase owner).** No new settings in `web/.env.local` or Vercel are needed.

1. **Google Cloud Console** (console.cloud.google.com), in a project for Edge:
   - **APIs & Services → OAuth consent screen**: app name `Edge`, support email, then publish it (External).
   - **Credentials → Create credentials → OAuth client ID → Web application**:
     - **Authorized JavaScript origins:** `https://edge-ng.vercel.app`, `http://localhost:3000`
     - **Authorized redirect URIs:** `https://<project-ref>.supabase.co/auth/v1/callback` (shown in Supabase on the Google provider page)
   - Copy the **Client ID** and **Client secret**.
2. **Supabase → Authentication → Sign In / Providers → Google**: enable it and paste the Client ID and secret.
3. **Supabase → Authentication → URL Configuration**:
   - **Site URL:** `https://edge-ng.vercel.app`
   - **Redirect URLs:** add `https://edge-ng.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`.

Locally, Google is off by default (`supabase/config.toml`); email sign-up works without it.

## Account deletion (14-day grace period)

Settings → Delete Account & Data doesn't delete at once (PRD F13; `lib/account-deletion.ts`, migration `0004_account_deletion_grace.sql`):

1. The trader confirms. `profiles.deletion_due_at` is set 14 days ahead, they are signed out on every device, and it's recorded in `audit_log`.
2. Signing in again (password or Google) before that date cancels the deletion.
3. Once a day, `GET /api/account/purge` (header `Authorization: Bearer <CRON_SECRET>`, the same secret as the alerts) deletes each account whose date has passed: its files in Storage first, then the account, which removes all its data. If anything fails, the account stays and the next run tries again.

**Scheduler:** on cron-job.org, add a second job like the alerts one, but with the URL `https://edge-ng.vercel.app/api/account/purge` and the schedule **once a day**.

## Chart picture cleanup

Each chart check saves a PNG in the `frames` bucket. To keep storage small, the same daily job (`/api/account/purge`, `lib/frame-cleanup.ts`) deletes pictures no Buy / Sell decision used once they are **7 days** old, and every picture once it is **90 days** old. Only the picture is deleted: the frame's candles, the rule checks and the decision stay in the database, so the journal still shows what Edge saw. The job's reply includes `frames: { removed, failed }`.

## Checklist alerts

The trader picks markets (e.g. Gold, Nasdaq 100) for Edge to watch with an approved checklist (`/app/alerts`). On each new candle the server checks the checklist's hard-gate chart rules from its own price data, with the same rule check as the workspace (`lib/alerts.ts`). When they all pass, Edge stores an alert and sends a browser/phone notification and an email. An alert is not an approval: the trader checks the trade in the workspace and the gate decides. Tables: `supabase/migrations/0003_checklist_alerts.sql`.

**1. Scheduler.** Something must call `GET /api/alerts/run` every 5 minutes with the header `Authorization: Bearer <CRON_SECRET>`. Vercel's free plan only runs cron jobs once a day, so use one of:

- **Supabase pg_cron** (Database → Extensions: enable `pg_cron` and `pg_net`), then in the SQL editor:
  ```sql
  select cron.schedule('edge-alerts', '*/5 * * * *', $$
    select net.http_get(
      url := 'https://edge-ng.vercel.app/api/alerts/run',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
    ) $$);
  ```
- an outside cron service (e.g. cron-job.org) with the same URL and header;
- Vercel Cron, on a paid plan, with a `crons` entry in `vercel.json` (Vercel sends `CRON_SECRET` itself).

Without a scheduler, alerts only run when the trader presses **Check now**.

**2. Browser and phone notifications (Web Push).** Generate keys once with `npx web-push generate-vapid-keys` and set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. `VAPID_SUBJECT` is a contact URL or `mailto:` address (defaults to the app URL). Works in Chrome, Edge, Firefox and Android; on iPhone only after the trader adds Edge to the Home Screen (iOS 16.4+).

**3. Email.** A [Resend](https://resend.com) API key in `RESEND_API_KEY`, and `ALERTS_EMAIL_FROM`, e.g. `Edge <alerts@edge.ng>` (the domain must be verified in Resend).

**Cost.** Each check is one AI call per chart rule on each timeframe that has a new candle, and one market-data request per timeframe. Checks stop at the first failing rule, skip closed markets, and higher timeframes are re-checked only when their candle closes. `ALERTS_MAX_MONITORS` (default 3) caps the markets per trader. Twelve Data's free plan allows 800 requests a day.
