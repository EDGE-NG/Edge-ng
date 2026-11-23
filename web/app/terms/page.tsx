import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { Section } from "../_components/legal-page";
import { LEGAL } from "@/lib/legal-contact";

export const metadata: Metadata = { title: "Terms of Service – Edge" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="23 November 2026">
      <p>
        These terms are the agreement between you and {LEGAL.operator} for using Edge. By creating an account or
        using Edge, you agree to them. If you don&apos;t agree, please don&apos;t use Edge.
      </p>

      <Section id="risk" title="1. Edge is not financial advice">
        <p>
          Edge is a discipline tool. You write your own trading plan; Edge turns it into a checklist you approve and,
          before a trade, tells you whether the chart passes or fails <em>your</em> checklist.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Edge gives no trading signals, recommendations or advice, and never predicts what a market will do.</li>
          <li>
            &quot;Approved&quot; only means the trade passes the rules you wrote. It doesn&apos;t mean the trade will
            make money.
          </li>
          <li>Every trade is your own decision and your own responsibility. You can always override Edge.</li>
          <li>
            Trading is risky and you can lose money, including more than you expect. Only trade with money you can
            afford to lose.
          </li>
        </ul>
      </Section>

      <Section title="2. How Edge checks charts">
        <p>
          Edge uses AI to read charts and plain code to make the final decision. AI can misread a chart, and price
          data can be late or wrong. When Edge can&apos;t check a rule, it says &quot;Needs evidence&quot; instead of
          passing it, but it can still make mistakes. Always look at the chart yourself before you trade. Alerts tell
          you when your rules seem to pass; they are not an approval.
        </p>
      </Section>

      <Section title="3. Your account">
        <ul className="list-disc space-y-2 pl-5">
          <li>You must be at least 18 and allowed to use a service like Edge where you live.</li>
          <li>Give accurate details, keep your password safe, and tell us if you think someone else is using your account.</li>
          <li>One person per account.</li>
        </ul>
      </Section>

      <Section title="4. Your content">
        <p>
          Your plan, checklists, example charts and journal stay yours. You give us permission to store and process
          them only to run Edge for you, as described in our <Link href="/privacy">Privacy Policy</Link>. Only upload
          charts and images you have the right to use, and don&apos;t upload other people&apos;s personal
          information.
        </p>
      </Section>

      <Section title="5. Fair use">
        <p>Don&apos;t:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>break the law, or use Edge to mislead or harm others;</li>
          <li>try to get into other people&apos;s accounts or data, or get around Edge&apos;s security or limits;</li>
          <li>overload Edge, scrape it, or use bots to run it at scale;</li>
          <li>copy or resell Edge, or present its results as investment advice to others.</li>
        </ul>
        <p>We may limit, suspend or close accounts that break these rules.</p>
      </Section>

      <Section title="6. The service">
        <p>
          Edge is in early development. Features may change, pause or stop, and Edge may sometimes be unavailable.
          Edge is provided &quot;as is&quot;, without promises that it will be error-free or always available.
        </p>
      </Section>

      <Section title="7. Responsibility">
        <p>
          As far as the law allows, we are not responsible for trading losses or for decisions you make using Edge,
          and our total responsibility for anything else connected with Edge is limited to the amount you paid us in
          the 12 months before the claim (if you use Edge for free, that amount is zero). Nothing in these terms
          removes rights you have by law that can&apos;t be removed.
        </p>
      </Section>

      <Section title="8. Ending">
        <p>
          You can stop using Edge and delete your account at any time in Settings. It is deleted 14 days later
          unless you sign in again before then. We may end your access if you
          break these terms, with notice where reasonable.
        </p>
      </Section>

      <Section title="9. Changes and law">
        <p>
          We may update these terms. We will change the date at the top and, for important changes, tell you in Edge
          or by email. If you keep using Edge after that, the new terms apply. These terms are governed by the laws of{" "}
          {LEGAL.country}.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          Questions about these terms: <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
        </p>
      </Section>
    </LegalPage>
  );
}
