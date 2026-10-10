import { A, H2, LegalPage, Mail, OPERATOR, P, legalMetadata } from '@/components/Legal';

// Short on purpose: Koyomi is a small personal planning calendar, and these terms say only
// what is true of it.

export const metadata = legalMetadata('Terms', 'The terms on which Koyomi is offered.', '/terms');

const UPDATED = '10 October 2026';

export default function Terms() {
  return (
    <LegalPage title="Terms" updated={UPDATED}>
      <P>
        These terms cover your use of Koyomi, at koyomi.guru and app.koyomi.guru. Koyomi is provided by {OPERATOR}, United Arab Emirates. By using
        Koyomi you agree to them.
      </P>

      <H2>What Koyomi is</H2>
      <P>Koyomi is a personal planning calendar that runs in your browser. It is free to use, and ordinary use needs no account.</P>

      <H2>Your calendar is on your device</H2>
      <P>
        The events and Plan items you write are kept in your browser, on your device. We keep no copy and there is no cloud backup, so we cannot
        restore them. If you clear the site’s data in your browser, or lose the device, they are lost. Keeping them safe is up to you.
      </P>

      <H2>Connected calendars</H2>
      <P>
        You may connect a Google calendar so that Koyomi shows it beside your own. The connection is read-only: Koyomi cannot change your Google
        Calendar. You can disconnect at any time in Koyomi.
      </P>
      <P>
        Connecting uses 6Away for sign-in and Google for your calendar. Those are services of their own, and your use of them is subject to their
        own terms.
      </P>

      <H2>As it is</H2>
      <P>
        Koyomi is provided as it is and as available. We do not promise that it will always be available or free of errors, or that what it shows
        of a connected calendar is complete or up to date.
      </P>

      <H2>Fair use</H2>
      <P>
        Use Koyomi lawfully and reasonably. Do not try to disrupt it, to get around its limits, or to reach data that is not yours. We may limit
        or stop access that harms the service or other people.
      </P>

      <H2>Changes</H2>
      <P>
        We may change, suspend or end Koyomi, or any part of it. We may also change these terms. The new version is published on this page with a
        new date, and continuing to use Koyomi after that means you accept it.
      </P>

      <H2>Liability</H2>
      <P>
        To the extent the law allows, we are not liable for indirect or consequential loss, or for loss of data, arising from your use of Koyomi.
        Nothing in these terms limits liability that cannot be limited by law.
      </P>

      <H2>Privacy</H2>
      <P>
        What Koyomi keeps, and what it does with it, is set out on the <A href="/privacy">Privacy</A> page. For privacy questions and requests,
        write to <Mail />.
      </P>

      <H2>Governing law</H2>
      <P>These terms are governed by the laws of the United Arab Emirates.</P>
    </LegalPage>
  );
}
