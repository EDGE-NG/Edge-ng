# Edge (edge.ng)

**Define your edge. Prove it with charts. Trade only when your plan says yes.**

Edge is a pre-trade discipline tool for traders. A trader writes or speaks their trading plan, Edge turns it into a checklist they approve, the trader teaches each rule with 1 to 6 example chart images, and before every trade Edge checks the chart against those rules and returns **Approved**, **Denied** or **Needs evidence**. The trader can always override, and every decision goes into a journal and dashboard.

Edge gives no signals, makes no predictions and is not financial advice.

The full product is described in the PRD: *Edge (edge.ng) Product Requirements Document, v2.1, 11 November 2026*. Each person's part is in the *Edge Team Work Split* PDF shared in the group.

> **Using an AI coding agent?** It should read [AGENTS.md](AGENTS.md) first. Give it the PRD and the work split PDF too.

---

## What is in this repo

| Folder | What it is | Stack |
|---|---|---|
| `web/` | Frontend: the landing page and the app screens | Next.js 16, React, Tailwind CSS |
| `api/` | Backend: one module per PRD area | NestJS 12 (Node.js) |
| `shared/` | Types used by both web and api (`@edge/shared`) | TypeScript |
| `supabase/` | Database migrations | Supabase (PostgreSQL) |

Everything is TypeScript.

**Built so far:**
- **Frontend (Daniel):** landing page, sign up and sign in, chat-first checklist builder, evidence library, trade workspace with chart and pre-trade gate, journal and settings. Its server routes (`web/app/api/`) store everything in Supabase: accounts in Supabase Auth, data in Postgres, chart images in private Storage. AI runs on Groq/OpenRouter; prices come from Binance and Twelve Data. See [web/README.md](web/README.md).
- **Database (Sheyi):** Supabase migrations in `supabase/migrations/`, with the PRD's integrity rules enforced in the database.
- Backend modules for identity, edge, workspace-gate, llm, journal, billing and notifications, plus a `/health` check.
- The gate's hard-gate roll-up in code (`api/src/workspace-gate/decision-engine.ts`), with tests (REQ-GT-1).

Everything else in the PRD is still to be built.

## Getting started

1. Install **Node.js LTS** from nodejs.org.
2. Clone the repo and, from its root folder, run:

```
npm install        # installs everything and builds shared/
npm run dev:web    # frontend: http://localhost:3000
npm run dev:api    # backend:  http://localhost:4000/health
```

Other commands: `npm test` (backend tests), `npm run build` (build everything), `npm run lint`.

## Settings (environment variables)

Create these files yourself. They are never committed. Ask Sheyi for the values.

**`web/.env.local`**: Supabase, AI and market-data settings, listed in [web/README.md](web/README.md). Ask Sheyi for the Supabase values and Daniel for the AI and market-data keys. Only `NEXT_PUBLIC_` values reach the browser, so never put secret keys in them.

**Local database instead:** with Docker running, `npx supabase start` runs Supabase on your computer with all migrations applied, and prints local keys to use.

**`api/.env`**
```
PORT=4000
WEB_ORIGIN=http://localhost:3000
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```
AI provider keys are added here (server only) once the AI provider is chosen.

## Known issues on the landing page

- The scrolling slogan does not move: its `tick` animation is never defined in the CSS.
- Risk notice, Privacy and Terms links point to `#`.
- Large empty gaps between sections; the hero demo card is cut off on shorter laptop screens.
- Not yet checked on phone screens.

## Team and areas

Owners: **Sheyi** and **Daniel**.

| Person | Area |
|---|---|
| Sheyi | All backend |
| Daniel | Product decisions, AI and chart vision, frontend (with Mayokun) |
| Mayokun | Frontend (with Daniel) |
| Helen | Product design |
| Belle Afrique | AI testing (with Daniel) |
| Moses | Research, legal, business and testing |

## Working in this repo

- Create a branch for your work, named `yourname/short-description`; don't commit straight to `main`.
- Stage files by name (`git add path/to/file`), not `git add .`.
- Never commit secrets, API keys or `.env` files.
- Mention the PRD IDs you worked on in commit messages, e.g. `Add checklist approval (PR-CL-3)`.
- Open a pull request and ask Sheyi or Daniel to review before merging.
