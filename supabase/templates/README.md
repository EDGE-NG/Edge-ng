# Edge email templates (Supabase Auth)

Branded emails for sign-up, password reset and the other account emails. A calm, ordinary email look: light background, white card, an Edge-green button, a plain-link fallback, and a footer with Privacy, Terms and the contact email.

Local Supabase uses these files automatically (`supabase/config.toml`, `[auth.email.template.*]`). **The live project doesn't read them from the repo:** paste them into Supabase by hand after any change.

| Supabase template | Subject | File |
|---|---|---|
| Confirm signup | Confirm your Edge account | `confirmation.html` |
| Reset password | Reset your Edge password | `recovery.html` |
| Magic link | Your Edge sign-in link | `magic_link.html` |
| Change email address | Confirm your Edge email change | `email_change.html` |
| Invite user | You're invited to Edge | `invite.html` |
| Reauthentication | Your Edge verification code | `reauthentication.html` |

**To update the live project:** Supabase → **Authentication** → **Emails** → **Templates** → pick the template → set the **Subject** → replace the **Body** with the whole file → **Save**.

Notes for editing:
- Email apps ignore most modern CSS, so keep the table layout and inline styles.
- Write special characters as HTML entities (`&#183;` for ·), or some mail systems garble them.
- **Confirm signup** and **Change email address** show the 6-digit code (`{{ .Token }}`) first and the button as a second option, for the code screens (`/verify-email` and the change-email dialog).
- **Paste them into the live project only after #34 (`/verify-email`) and #40 (change-email dialog) are on `main`.** Until then there's nowhere in Edge to type the code.
- **Live project settings these emails depend on** (Supabase → Authentication; the live project ignores `config.toml`):
  - **Email OTP length: 6.** The code screens accept exactly 6 digits.
  - **Email OTP expiration: 3600 seconds.** The emails say codes "expire within an hour".
  - **Secure email change: on** (`double_confirm_changes`). Supabase sends **Change email address** to both the old and the new address, each with its own code, so the change-email dialog asks for both. The email itself says "you may get a code at each address", so it stays true if this is ever turned off.
- **Testing locally:** `enable_confirmations` is on in `config.toml`, so sign-up sends the confirmation email. Open it in Mailpit at http://localhost:54324.
- Keep Supabase's placeholders exactly as they are: `{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`, `{{ .Token }}`.
- Edge never predicts: no "good trade", "will win" or similar wording here either.
- **Logo:** the green "E" square at the top is a placeholder made of table cells (it shows in every email app). When the real logo is ready, export it as a 72×72 PNG, put it in `web/public/email-logo.png` (live at `https://edge-ng.vercel.app/email-logo.png`), and replace the green "E" cell in each file with the `<img>` shown in the comment above it (36×36 on screen, so export at 72×72 for sharp phones). Email apps don't show SVG logos, so it must be PNG.
