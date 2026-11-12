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
| `lib/` | Server-side logic: database, auth, AI providers, market data, workspace and gate |
| `proxy.ts` | Sends signed-out visitors to `/login` (Next.js 16 renamed middleware to proxy) |
| `scripts/build-homepage.mjs` | Rebuilds the landing page from `content/homepage.html` (`npm run homepage -w @edge/web`) |

## Temporary demo backend

Until the NestJS backend in `api/` and Supabase are ready, this app has its own small server side in `app/api/` and `lib/`:

- **Data:** a local SQLite file (`lib/db.ts`). Data is not kept between Vercel deployments.
- **AI:** Groq first, OpenRouter as fallback (`lib/ai.ts`). Keys stay on the server.
- **Market data:** Twelve Data (`lib/market.ts`).

These parts are planned to move to Sheyi's backend in `api/` (PRD 9.1, PR-GT-7: the gate runs on the server).

## Settings (`web/.env.local`, never committed)

```
GROQ_API_KEY=
GROQ_MODEL=
GROQ_STT_MODEL=
GROQ_VISION_MODEL=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
OPENROUTER_VISION_MODEL=
TWELVE_DATA_API_KEY=
EDGE_DB_PATH=
EDGE_EVIDENCE_DIR=
```

Ask Daniel for the values. Model and path settings are optional; the code has defaults.

Run from the repo root: `npm run dev:web`.
