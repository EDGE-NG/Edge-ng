/**
 * Notifications for checklist alerts: Web Push (browser / phone pop-ups) and
 * email (Resend's HTTP API). Server only: the VAPID private key and the
 * Resend key never reach the browser.
 *
 * Both channels are optional. Without their settings they report themselves
 * as not configured and the alert is still kept in the app.
 */
import webpush from "web-push";
import { db, json, now } from "./db";
import { adminClient } from "./supabase";

export interface AlertPrefs {
  push: boolean;
  email: boolean;
}

export interface NotifyMessage {
  title: string;
  body: string;
  /** Path inside the app, e.g. /app/alerts?event=... */
  path: string;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
  email?: { subject: string; text: string; html: string };
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERTS_EMAIL_FROM);
}

/** Public key the browser subscribes with (safe to send to the client). */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/** Absolute app URL for links in emails and notifications. */
export function appUrl(path = ""): string {
  const base =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "http://localhost:3000";
  return base.replace(/\/$/, "") + path;
}

export async function alertPrefs(userId: string): Promise<AlertPrefs> {
  const p = await db.one<{ settings: unknown }>("SELECT settings FROM profiles WHERE user_id = ?", userId);
  const a = (json(p?.settings, {}) as { alerts?: Partial<AlertPrefs> }).alerts ?? {};
  return { push: a.push !== false, email: a.email !== false };
}

export async function saveAlertPrefs(userId: string, prefs: AlertPrefs): Promise<void> {
  await db.run(
    `UPDATE profiles SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('alerts', ?::jsonb), updated_at = now()
     WHERE user_id = ?`,
    prefs,
    userId
  );
}

/* --------------------------------------------------------------- push --- */

let vapidSet = false;
function ensureVapid() {
  if (vapidSet) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || appUrl(),
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  vapidSet = true;
}

export async function sendPush(userId: string, msg: NotifyMessage): Promise<{ sent: number; failed: number }> {
  if (!pushConfigured()) return { sent: 0, failed: 0 };
  ensureVapid();
  const subs = await db.all<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    userId
  );
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.path, tag: msg.tag });
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 15 * 60, // an alert older than 15 minutes isn't worth showing
          urgency: "high",
          timeout: 8000,
        });
        sent++;
        await db.run("UPDATE push_subscriptions SET last_used_at = ? WHERE id = ? AND user_id = ?", now(), s.id, userId);
      } catch (err) {
        failed++;
        const code = (err as { statusCode?: number }).statusCode;
        // the browser unsubscribed or the subscription expired: forget this device
        if (code === 404 || code === 410) {
          await db.run("DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?", s.id, userId);
        } else {
          console.error("[notify] push failed:", code ?? err);
        }
      }
    })
  );
  return { sent, failed };
}

/* -------------------------------------------------------------- email --- */

async function emailFor(userId: string): Promise<string | null> {
  try {
    const { data } = await adminClient().auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch (err) {
    console.error("[notify] could not read the account email:", err);
    return null;
  }
}

export async function sendEmail(userId: string, msg: NotifyMessage): Promise<"sent" | "failed" | "off"> {
  if (!emailConfigured() || !msg.email) return "off";
  const to = await emailFor(userId);
  if (!to) return "failed";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ALERTS_EMAIL_FROM,
        to: [to],
        subject: msg.email.subject,
        text: msg.email.text,
        html: msg.email.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[notify] email failed:", res.status, await res.text().catch(() => ""));
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("[notify] email failed:", err);
    return "failed";
  }
}

/** Send on every channel the trader has switched on. */
export async function notifyUser(
  userId: string,
  msg: NotifyMessage
): Promise<{ push: { sent: number; failed: number } | "off"; email: "sent" | "failed" | "off" }> {
  const prefs = await alertPrefs(userId);
  const [push, email] = await Promise.all([
    prefs.push ? sendPush(userId, msg) : Promise.resolve("off" as const),
    prefs.email ? sendEmail(userId, msg) : Promise.resolve("off" as const),
  ]);
  return { push, email };
}
