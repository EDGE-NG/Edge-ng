# web: Edge frontend

Next.js 16 (App Router) + Tailwind CSS. See the root [README](../README.md) for setup and [AGENTS.md](../AGENTS.md) for project rules. Next.js-specific notes are in [AGENTS.md](AGENTS.md) in this folder.

- `public/landing.html`: the current landing page, served at `/` (rewrite in `next.config.ts`).
- `src/app/(app)/`: app screens with the side navigation (PR-CH-6).
- `src/app/signup/`: sign-up (flow F1).
- `src/components/`: shared UI components.
- Design tokens (colours, fonts) from the landing page are in `src/app/globals.css`.

Run from the repo root: `npm run dev:web`.
