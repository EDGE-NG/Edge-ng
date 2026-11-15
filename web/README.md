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
