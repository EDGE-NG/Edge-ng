# Edge (edge.ng)

**Define your edge. Prove it with charts. Trade only when your plan says yes.**

Edge is a pre-trade discipline tool for traders. A trader writes or speaks their trading plan, Edge turns it into a checklist they approve, the trader teaches each rule with 1 to 6 example chart images, and before every trade Edge checks the chart against those rules and returns **Approved**, **Denied** or **Needs evidence**. The trader can always override, and every decision goes into a journal and dashboard.

Edge gives no signals, makes no predictions and is not financial advice.

The full product is described in the PRD: *Edge (edge.ng) Product Requirements Document, v2.1, 11 November 2026*.

---

## What is in this repo right now

| File | What it is |
|---|---|
| `index.html` | The landing page. This single file is the whole live site: HTML, CSS and JavaScript are all inside it. |
| `README.md` | This file. |

Live site: https://edge-rust-seven.vercel.app/

The product itself (chat, checklist, evidence library, trade workspace, gate, journal, dashboard) **has not been built yet**. That is the work ahead, following the PRD.

## Run the landing page locally

No install is needed. Either:

- Open `index.html` in your browser, or
- Serve the folder, for example: `npx serve .` and open the address it prints.

## Landing page: sections

1. Header with navigation and "Get early access"
2. Hero ("Trade your plan") with an animated demo review card
3. What it is: sample rule review (Pass, Fail, Inconclusive)
4. How it works: four steps (describe your edge, show examples, review before you trade, learn from every trade)
5. Why Edge: four feature cards
6. Scrolling slogan ("Define it. Check it. Follow it.")
7. FAQ
8. Final call to action
9. Footer

## Known issues on the landing page

- "Get early access" opens an email to `hello@example.com` (a placeholder). It should lead into sign-up (PRD flow F1).
- The scrolling slogan does not move: its `tick` animation is never defined in the CSS.
- Risk notice, Privacy and Terms links point to `#`.
- Large empty gaps between sections; the hero demo card is cut off on shorter laptop screens.
- Not yet checked on phone screens.

## Team and areas

Owners: **Sheyi** and **Daniel**. The full split, with PRD section numbers and requirement IDs per person, is in the *Edge Team Work Split* PDF shared in the group.

| Person | Area |
|---|---|
| Sheyi | All backend |
| Daniel | Product decisions, AI and chart vision, frontend (with Mayokun) |
| Mayokun | Frontend (with Daniel) |
| Eileen | Product design |
| Belle Afrique | AI testing (with Daniel) |
| Moses | Research, legal, business and testing |

## Working in this repo

- Create a branch for your work; don't commit straight to `main`.
- Stage files by name (`git add path/to/file`), not `git add .`.
- Never commit secrets, API keys or `.env` files.
- Open a pull request and ask Sheyi or Daniel to review before merging.
