/**
 * Login emails via Mailgun (email-code login: request a code, receive it by
 * email, verify to get a session cookie).
 *
 * When MAILGUN_API_KEY / MAILGUN_DOMAIN are not configured (local dev), the
 * code is returned in the API response so the flow is testable end to end.
 */
export interface SendResult {
  sent: boolean;
  devCode?: string; // only present when Mailgun is not configured
}

function mailgunConfigured(): boolean {
  return Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
}

/** Send a 6-digit login code. Returns { sent:false, devCode } in dev mode. */
export async function sendLoginCode(email: string, code: string): Promise<SendResult> {
  if (!mailgunConfigured()) {
    return { sent: false, devCode: code };
  }

  const region = process.env.MAILGUN_REGION === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
  const domain = process.env.MAILGUN_DOMAIN as string;
  const from = process.env.MAILGUN_FROM || `Edge <postmaster@${domain}>`;

  const body = new URLSearchParams({
    from,
    to: email,
    subject: "Your Edge login code",
    text: [
      `Your Edge login code: ${code}`,
      ``,
      `It expires in 15 minutes and can only be used once.`,
      `If you did not request this, you can ignore this email.`,
    ].join("\n"),
    html: [
      `<div style="font-family:sans-serif;background:#000;color:#fff;padding:32px">`,
      `<h2 style="margin:0 0 8px">Your Edge login code</h2>`,
      `<p style="font-size:32px;letter-spacing:6px;font-weight:600">${code}</p>`,
      `<p style="color:#9a9a9a;font-size:13px">Expires in 15 minutes. One use only.</p>`,
      `</div>`,
    ].join(""),
  });

  const res = await fetch(`https://${region}/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mailgun ${res.status}: ${text.slice(0, 300)}`);
  }
  return { sent: true };
}
