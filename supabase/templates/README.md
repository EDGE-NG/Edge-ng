# Edge email templates (Supabase Auth)

Branded emails for sign-up, password reset and the other account emails. A calm, ordinary email look: light background, white card, an Edge-green button, a plain-link fallback, and a footer with Privacy, Terms and the contact email.

Local Supabase uses these files automatically (`supabase/config.toml`, `[auth.email.template.*]`). **The live project doesn't read them from the repo:** paste them into Supabase by hand after any change.

| Supabase template | Subject | File |
|---|---|---|
| Confirm signup | Confirm your Edge account | `confirmation.html` |
| Reset password | Reset your Edge password | `recovery.html` |
| Magic link | Your Edge sign-in link | `magic_link.html` |
| Change email address | Confirm your new email for Edge | `email_change.html` |
| Invite user | You're invited to Edge | `invite.html` |
| Reauthentication | Your Edge verification code | `reauthentication.html` |

**To update the live project:** Supabase → **Authentication** → **Emails** → **Templates** → pick the template → set the **Subject** → replace the **Body** with the whole file → **Save**.

Notes for editing:
- Email apps ignore most modern CSS, so keep the table layout and inline styles.
- Write special characters as HTML entities (`&#183;` for ·), or some mail systems garble them.
- Keep Supabase's placeholders exactly as they are: `{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`, `{{ .Token }}`.
- Edge never predicts: no "good trade", "will win" or similar wording here either.
- **Logo:** the green "E" square at the top is a placeholder made of table cells (it shows in every email app). When the real logo is ready, export it as a 72×72 PNG, put it in `web/public/email-logo.png` (live at `https://edge-ng.vercel.app/email-logo.png`), and replace the green "E" cell in each file with the `<img>` shown in the comment above it (36×36 on screen, so export at 72×72 for sharp phones). Email apps don't show SVG logos, so it must be PNG.
