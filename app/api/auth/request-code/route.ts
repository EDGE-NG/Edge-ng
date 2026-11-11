import { NextResponse } from "next/server";
import { createLoginCode } from "@/lib/auth";
import { sendLoginCode } from "@/lib/email";

/**
 * POST { email } -> emails a 6-digit login code.
 * Without Mailgun configured (local dev), the code comes back in the
 * response as dev_code so the flow stays testable.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const code = createLoginCode(email);
  try {
    const result = await sendLoginCode(email, code);
    return NextResponse.json({
      ok: true,
      email,
      sent: result.sent,
      dev_code: result.devCode ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not send the email" },
      { status: 502 }
    );
  }
}
