# Edge email templates (Supabase Auth)

Branded emails for sign-up, password reset and the other account emails. Dark Edge design, green button, plain-link fallback, and a footer with Privacy, Terms and the contact email.

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
