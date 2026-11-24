import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { Section } from "../_components/legal-page";
import { LEGAL } from "@/lib/legal-contact";

export const metadata: Metadata = { title: "Privacy Policy – Edge" };

/*
 * Written from what the app actually does (web/lib, supabase/migrations).
 * If you change what Edge collects or who processes it, update this page.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="23 November 2026">
      <p>
        Edge helps you follow your own trading plan. To do that it stores your plan, your example charts and your
        pre-trade decisions. This page explains what we collect, why, who helps us process it, and the choices you
        have. Edge is run by {LEGAL.operator}. Questions: <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>

      <Section title="1. What we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account details:</strong> your name, email address, password (stored only as a secure hash by our
            sign-in provider), time zone, preferred markets, theme and, if you add one, a profile photo. If you
            continue with Google, we receive your name and email address from Google.
          </li>
          <li>
            <strong>Your trading plan:</strong> what you type or say in the chat, the checklist built from it, and
            every version you approve.
          </li>
          <li>
            <strong>Example charts:</strong> the images you upload for each rule, your notes on them, and Edge&apos;s
            reading of each image.
          </li>
          <li>
            <strong>Trade checks:</strong> the chart captures and price data Edge checks, each rule&apos;s result,
            your trade tickets (side, entry, stop, target, size, risk), Edge&apos;s decision, your overrides and
            reasons, and your journal notes.
          </li>
          <li>
            <strong>Alerts:</strong> the markets you ask Edge to watch, the alerts it sends, and, if you allow
            notifications, a technical address for your browser or phone.
          </li>
          <li>
            <strong>Voice:</strong> if you speak your plan, the recording is sent to our speech-to-text provider (Groq) and turned into text. We keep the text, not the recording.
          </li>
          <li>
            <strong>Technical records:</strong> sign-in cookies, and a record of each AI request (which model, how
            long it took, whether it worked) so we can find faults and control costs.
          </li>
        </ul>
        <p>We don&apos;t collect your broker or exchange passwords, and Edge doesn&apos;t place trades for you.</p>
      </Section>

      <Section title="2. Why we use it">
        <ul className="list-disc space-y-2 pl-5">
          <li>To run Edge for you: build your checklist, check charts against it, and keep your journal.</li>
          <li>To send the alerts and emails you ask for.</li>
          <li>To keep Edge secure, prevent abuse, and fix problems.</li>
          <li>To keep a record of each decision exactly as it was made, so your journal is accurate.</li>
        </ul>
        <p>
          We don&apos;t sell your data, we don&apos;t show ads, and we don&apos;t use your plan or charts to give
          anyone else trading signals.
        </p>
      </Section>

      <Section title="3. Who processes it for us">
        <p>Edge uses these services to work. Each only gets what it needs for its job:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Supabase</strong>: accounts, database and private file storage.
          </li>
          <li>
            <strong>Vercel</strong>: hosts the Edge website and servers.
          </li>
          <li>
            <strong>AI providers (Groq, Google Gemini, and OpenRouter as a backup)</strong>: read your plan, your
            example charts and the charts you check, and return text. They receive the content of the request, not
            your name or email address.
          </li>
          <li>
            <strong>Google</strong>: &quot;Continue with Google&quot; sign-in, if you choose it.
          </li>
          <li>
            <strong>Resend</strong>: sends alert emails, if you turn them on.
          </li>
          <li>
            <strong>Browser push services (Google, Apple, Mozilla, Microsoft)</strong>: deliver alert notifications
            to your device, if you allow them.
          </li>
          <li>
            <strong>Market data (Binance, Twelve Data)</strong>: provide prices. We only ask them for prices; we send
            them nothing about you.
          </li>
        </ul>
        <p>These services may store data in countries other than yours.</p>
      </Section>

      <Section title="4. Cookies and storage on your device">
        <p>
          Edge uses cookies only to keep you signed in and to finish Google sign-in. Your browser also remembers a few
          display choices (such as light or dark theme). We use no advertising or tracking cookies.
        </p>
      </Section>

      <Section title="5. How long we keep it">
        <p>
          We keep your data while you have an account. When you delete your account, you are signed out and have 14
          days to change your mind: signing in again cancels the deletion. After 14 days we delete your account and
          all the data linked to it, including your uploaded images and chart captures. We keep a short record that
          an account was deleted (its email address and the date) for up to 24 months, for security and to handle
          disputes.
        </p>
      </Section>

      <Section title="6. Your choices">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Download your data:</strong> Settings → Export Your Data.
          </li>
          <li>
            <strong>Correct your details:</strong> Settings, or edit your checklist (approved versions are kept as
            they were, and edits create a new version).
          </li>
          <li>
            <strong>Delete your account:</strong> Settings → Delete Account &amp; Data (deleted after 14 days unless
            you sign in again).
          </li>
          <li>
            <strong>Turn off alerts, notifications or emails</strong> at any time on the Alerts page.
          </li>
          <li>
            For anything else, email <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
          </li>
        </ul>
      </Section>

      <Section title="7. Security">
        <p>
          Your files are stored privately, keys for outside services stay on our servers, and connections are
          encrypted. No system is perfectly secure; if we learn of a breach that affects you, we will tell you.
        </p>
      </Section>

      <Section title="8. Children">
        <p>Edge is not for anyone under 18.</p>
      </Section>

      <Section title="9. Changes">
        <p>
          If we change this policy, we update the date at the top and, for important changes, tell you in Edge or by
          email. See also our <Link href="/terms">Terms of Service</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
