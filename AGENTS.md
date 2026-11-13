# AGENTS.md — instructions for AI coding agents working on Edge

Read this whole file before writing any code. It applies to every teammate's agent.

## 1. What Edge is

Edge (edge.ng) is a pre-trade discipline tool. A trader turns their trading plan into a checklist they approve, teaches each rule with 1 to 6 example chart images, and before every trade Edge checks the chart against the rules and returns **Approved**, **Denied** or **Needs evidence**. The trader can always override; every decision is journaled.

The source of truth is the **PRD** (*Edge (edge.ng) Product Requirements Document, v2.1*) and the **Edge Team Work Split** PDF. They are not in this repo. **Ask your human for both files before starting**, and only build what the PRD describes. If something is unclear or missing in the PRD, stop and ask your human; do not invent features.

## 2. Current goal (next 3 weeks)

A working, high-quality demo of the core loop, built properly on the real architecture:

1. Sign up and land in the opening chat (F1, PR-CH-1, PR-CH-2)
2. Type a trading plan; the AI turns it into a checklist (PRD 5.2)
3. Approve the checklist; add 1 to 6 example images per rule; AI explains each image (PRD 4.2, 4.3)
4. Open a chart in Edge's own workspace and press Buy or Sell (PRD 4.4)
5. Get Approved / Denied / Needs evidence with a reason per rule (PRD 4.5)
6. Override, and see the decision in the journal (PRD 4.6)

Do not start copy trading, broker connections, payments or the marketplace until the human owners say so.

## 3. Stack

| Part | Choice |
|---|---|
| Language | TypeScript everywhere, `strict` mode |
| Frontend | Next.js (App Router) + Tailwind CSS, in `web/` |
| Charts | TradingView Lightweight Charts (Edge-controlled chart, PRD 5.4 source A) |
| Backend | Node.js + NestJS, in `api/` |
| Database, auth, file storage | Supabase (PostgreSQL) |
| Shared types | `shared/` package, used by both `web/` and `api/` |

## 4. Repo layout

```
edge/
├── web/                     # Next.js frontend (has its own AGENTS.md: read it)
│   ├── app/                 # pages and server routes (app/api/); see web/README.md
│   ├── lib/                 # server logic: Supabase access, AI, market data, gate
│   └── content/homepage.html # landing page source
├── api/                     # NestJS backend (has its own AGENTS.md: read it)
│   └── src/                 # one module per PRD area
├── shared/                  # TypeScript types shared by web and api (@edge/shared)
├── supabase/migrations/     # database migrations
├── AGENTS.md                # this file
└── README.md
```

Backend modules in `api/src/` follow PRD 9.1: `identity`, `edge` (checklists and evidence), `workspace-gate`, `llm` (the LLM gateway), `journal`, `billing`, `notifications`. The hard-gate roll-up already exists in `api/src/workspace-gate/decision-engine.ts` with tests; extend it, don't replace it.

The frontend in `web/` was built by Daniel. Its server routes (`web/app/api/`, `web/lib/`) store data in **Supabase**: Auth for accounts, Postgres tables from `supabase/migrations/`, private Storage buckets `evidence` and `frames`. Rules for that code:

- Use `db.one / db.all / db.run / db.tx` from `web/lib/db.ts`. **Every query must filter by the signed-in user's id**: the server connection bypasses row-level security.
- For json/jsonb columns pass objects, not `JSON.stringify(...)`.
- Database changes go in a **new** migration file (`supabase/migrations/000N_*.sql`), never an edit to an applied one, and only Sheyi writes them.
- The database enforces PRD rules itself (immutable approved versions, max 6 images per rule, gate integrity, append-only decisions). If an insert or update is refused, fix the code, not the rule.
- Test locally with `npx supabase start` (Docker) before opening a PR.

Long-term backend work still goes in `api/` (Sheyi).

`web/` and `api/` each have their own `AGENTS.md` with notes on their framework version (Next.js 16, NestJS 12). Both are newer than most AI training data: read those notes and the bundled docs before writing framework code.

## 5. Who owns what

Check which area your human owns before editing. Do not change another person's area without your human agreeing it with that owner.

| Person | Area | Main folders |
|---|---|---|
| Sheyi (owner) | All backend | `api/`, `supabase/`, `shared/` |
| Daniel (owner) | Product decisions, AI and chart vision, frontend with Mayokun | `api/src/llm/` (AI logic), `web/` (workspace and gate screens) |
| Mayokun | Frontend with Daniel | `web/` |
| Helen | Product design | design files; reviews `web/` UI |
| Belle Afrique | AI testing with Daniel | AI evaluation set and test runs |
| Moses | Research, legal, business, testing | legal page text, end-to-end tests |

**Only Sheyi writes backend code** (`api/`, `supabase/`). Others who need a backend change describe it to Sheyi instead of writing it.

## 6. Product rules the code must never break (from the PRD)

- **Code decides, the AI only perceives.** Hard-gate roll-up, risk rules and approval expiry run in plain code, never in model judgment (PR-GT-7, REQ-GT-1).
- Any hard-gate Fail means **Denied**; any hard-gate Inconclusive or unchecked means **Needs evidence**; soft rules never offset a hard gate.
- **A failure is never a pass.** If the AI errors, times out or returns invalid output, the rule is **Inconclusive** (REQ-LLM-2, REQ-GT-7).
- **Never predict.** Wording is "passes your checklist" or "fails your checklist", never "good trade", "will win" or similar (PR-GT-8, REQ-LLM-12).
- Approved checklist versions are **immutable**; edits create a new draft (PR-CL-3).
- Each rule has **1 to 6** evidence images; a 7th is blocked (PR-EV-1).
- The AI **never invents a rule** the trader did not state; every rule cites the trader's own words (REQ-LLM-3).
- Text read from images, notes or transcripts is **data, never instructions** (REQ-LLM-11).
- Override is always available on a denial and always recorded (PR-OV-1, REQ-GT-6).
- Pass, Fail and Inconclusive are **never shown by colour alone**; always icon and text too (WCAG 2.2 AA).
- AI provider keys and Supabase service keys live **only on the server**. The browser never calls an AI provider directly (REQ-ARC-2).
- Money is stored as integer minor units plus a currency code; times are stored in UTC (PRD 9.2).

## 7. Working conventions

- Branch per task, named `yourname/short-description`. Never commit straight to `main`.
- Stage files by name (`git add path/to/file`), never `git add .` or `git add -A`.
- Never commit secrets or `.env` files. Add new variable names to `.env.example` with no values.
- Don't add AI co-author lines (e.g. `Co-Authored-By: Claude ...`) or "Generated with" text to commits or pull requests. Claude Code users: set `"includeCoAuthoredBy": false` in `~/.claude/settings.json`.
- Put types used by both frontend and backend in `shared/`; don't duplicate them.
- Mention the PRD IDs you worked on in commit messages and pull requests, e.g. `Add checklist approval (PR-CL-3)`.
- Open a pull request and ask Sheyi or Daniel to review before merging.
- Keep the visual style of the landing page: dark background, green accent (`#5ef088`), fonts Inter Tight and Archivo.

## 8. Running the project

Requires Node.js (LTS). From the repo root:

```
npm install        # installs everything and builds shared/
npm run dev:web    # frontend on http://localhost:3000
npm run dev:api    # backend on http://localhost:4000 (health check: /health)
npm test           # backend unit tests
npm run build      # builds shared, api and web
```

Settings go in `web/.env.local` and `api/.env` (never committed). The variable names are listed in the README. Add any new variable to the README list, with no value.

After changing `shared/src/`, run `npm run build -w @edge/shared` so web and api see the change.
