## What this PR does

<!-- One or two sentences. -->

**PRD references:** <!-- e.g. PR-CL-3, flow F2 -->
**Area:** <!-- Backend / Frontend / Design / AI / Legal / Tests -->

## Screenshots (for any screen change)

<!-- Paste before/after screenshots, desktop and phone width. -->

## Checklist (every box must be ticked before merging)

- [ ] It only builds what the PRD describes, in my own area of the work split
- [ ] I ran `npm run build`, `npm run lint` and `npm test` locally, and they pass
- [ ] I tested it myself in the browser (frontend) or with requests/tests (backend)
- [ ] No secrets, API keys or `.env` files are committed; new settings are added to the `.env.example` files without values
- [ ] Backend changes (`api/`, `supabase/`) were made or agreed by Sheyi
- [ ] Shared type changes (`shared/`) were agreed with Sheyi
- [ ] Wording follows the PRD: "passes your checklist" / "fails your checklist", never "good trade" (PR-GT-8)
- [ ] Pass, Fail and Inconclusive are never shown by colour alone (icon and text too)
- [ ] The AI never decides the gate; any AI error or invalid output becomes Inconclusive, never a pass
- [ ] Screens work at phone width and with the keyboard
- [ ] My branch is up to date with `main`
