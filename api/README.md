# api: Edge backend

NestJS 12 (ESM, Vitest). Owner: Sheyi. See the root [README](../README.md) for setup and [AGENTS.md](../AGENTS.md) for project rules. NestJS-specific notes are in [AGENTS.md](AGENTS.md) in this folder.

One module per PRD area (PRD 9.1), in `src/`:

| Module | PRD |
|---|---|
| `identity` | F1, 4.8, REQ-ID-1 |
| `edge` | 4.1 to 4.3, F2 to F4 |
| `workspace-gate` | 4.4, 4.5, F5 to F7, REQ-GT-1 to 8 (`decision-engine.ts`) |
| `llm` | Section 5, REQ-LLM-1 to 14 |
| `journal` | 4.6, 4.7, F8, F9 |
| `billing` | F12, REQ-BL-1 |
| `notifications` | PR-DB5, REQ-NT-1 |

Run from the repo root: `npm run dev:api` (port 4000, health check at `/health`), `npm test`.
