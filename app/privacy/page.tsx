import { A, H2, LegalPage, List, Mail, OPERATOR, P, legalMetadata } from '@/components/Legal';

// What Koyomi keeps, where, and what it is used for. Every sentence here describes what the code
// does (docs/CALENDAR_CONNECTIONS.md says the same at more length): if what Koyomi reads, keeps
// or sends ever changes, this page changes in the same commit, with a new date.

export const metadata = legalMetadata('Privacy', 'What Koyomi keeps, where it keeps it, and what it is used for.', '/privacy');

const UPDATED = '10 October 2026';

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated={UPDATED}>
      <P>
        Koyomi is a calendar for planning your own time. It is run by {OPERATOR}, United Arab Emirates. This page says what Koyomi keeps, where it
        keeps it and what it is used for. For any question or request, write to <Mail />.
      </P>

      <H2>Your Koyomi calendar stays on your device</H2>
      <P>
        The events and Plan items you write in Koyomi are kept in your browser, on the device you write them on. They are not sent to our servers
        and we cannot see them. Ordinary use needs no account.
      </P>
      <P>There is no cloud copy. If you clear the site’s data in your browser, or remove the installed app’s data, they are gone.</P>
      <P>
        Two more things are kept on the device: whether you chose the light or the dark appearance, and a copy of Koyomi’s own files, so that it
        opens without a connection.
      </P>

      <H2>Connecting Google Calendar</H2>
      <P>
        Connecting a Google calendar is optional. If you connect one, Koyomi shows its events beside your own, so that you can see which hours are
        already taken. That is the only thing your Google Calendar data is used for.
      </P>
      <P>To connect, you first sign in with 6Away. Google then asks whether you allow Koyomi two things, both read-only:</P>
      <List>
        <li>see the list of your Google calendars (calendar.calendarlist.readonly);</li>
        <li>view the events on them (calendar.events.readonly).</li>
      </List>
      <P>Koyomi asks for no other permission. It cannot create, change or delete anything in your Google Calendar.</P>

      <H2>What Koyomi reads from Google</H2>
      <P>
        Koyomi reads the names and identifiers of your calendars, and whether each is your main one, is shown in Google Calendar, or has been
        deleted. A calendar’s identifier can be an email address.
      </P>
      <P>For the calendars you choose to show in Koyomi, it reads these details of each event, from five weeks back to twenty-seven weeks ahead:</P>
      <List>
        <li>its identifier at Google, its title, its start and end, and the time zone it was written in;</li>
        <li>whether it is confirmed, tentative or cancelled, and when it last changed;</li>
        <li>a link to the event at Google;</li>
        <li>its type, used only to leave out working-location entries;</li>
        <li>your own reply to an invitation, used only to leave out events you declined.</li>
      </List>
      <P>Koyomi does not ask Google for descriptions, locations, guest lists or meeting links, so Google does not send them.</P>

      <H2>Where it is kept</H2>
      <P>
        On your device. The calendar names and identifiers and the event details above are kept in your browser, apart from your Koyomi calendar, so
        that they can be shown when you are offline, together with which calendars you chose to show and a note that a calendar is connected.
        They are removed from the device when you hide a calendar, when you disconnect, or when a different person signs in on that device.
      </P>
      <P>
        On our server. Events pass through our server on their way from Google to your device. They are not stored there and are not written to
        its log. The server stores one record for each person who has connected. It holds:
      </P>
      <List>
        <li>your 6Away identifier;</li>
        <li>the refresh token Google issued, encrypted with AES-256-GCM;</li>
        <li>the permissions Google granted, and whether the connection is working;</li>
        <li>when the record was made and last changed;</li>
        <li>a count of recent requests, used to limit how often Google is asked.</li>
      </List>
      <P>It holds no email address, no calendar names and no events.</P>
      <P>
        Google’s tokens never reach your browser. The short-lived access token used to read your calendar is held only in the server’s memory.
      </P>

      <H2>Signing in with 6Away</H2>
      <P>Koyomi asks you to sign in only when you connect a calendar. Sign-in is provided by 6Away.</P>
      <P>
        To keep you signed in, Koyomi sets a sign-in cookie in your browser, for up to thirty days. It is an HttpOnly cookie, which page scripts
        cannot read. The session it carries can contain your 6Away identifier, your name, your email address and your sign-in credential. Of
        these, our database keeps only the identifier.
      </P>

      <H2>What your Google data is never used for</H2>
      <P>
        Your Google Calendar data is not sold. It is not used for advertising, not used for analytics or to build a profile of you, and not used
        to train artificial-intelligence or machine-learning models. It is not given to anyone for purposes of their own. The only companies
        that handle any of it are the three named below, and each handles only what is said there.
      </P>
      <P>
        Koyomi’s use of information received from Google APIs adheres to the{' '}
        <A href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</A>, including the
        Limited Use requirements.
      </P>

      <H2>Who helps us run Koyomi</H2>
      <P>Koyomi runs on services from three companies. What each one handles is different:</P>
      <List>
        <li>
          Vercel hosts the website and the server. Your Google Calendar events and calendar names pass through that server on their way from
          Google to your device. They are not stored there.
        </li>
        <li>
          Neon hosts the database, in the United States. It stores only the connection record described above. It receives no events and no
          calendar names.
        </li>
        <li>
          6Away provides sign-in. It learns that you signed in to Koyomi. It does not receive your Google Calendar events, your calendar names
          or Google’s tokens.
        </li>
      </List>
      <P>
        As infrastructure providers they process technical information, such as IP addresses and request logs, in order to deliver and protect the
        service, under their own terms and privacy policies. Your calendar itself comes from Google, under Google’s own terms.
      </P>

      <H2>Disconnecting, and deleting</H2>
      <P>The connection record is kept until you disconnect or ask us to delete it.</P>
      <P>
        Disconnect, in Koyomi’s Calendars pane, asks Google to revoke Koyomi’s access, deletes the record from our server, signs that device out
        and deletes its copy of your Google calendars. Another device on which you had connected removes its own copy the next time it is signed
        in and checks. Your Koyomi calendar is not touched.
      </P>
      <P>
        If you remove Koyomi’s access in your Google Account instead, Koyomi can read nothing further. The record stays on our server, marked as
        needing reconnection, until you reconnect or disconnect.
      </P>
      <P>
        You can also ask us to delete the record by writing to <Mail />.
      </P>
      <P>To delete your Koyomi calendar, delete its events and Plan items in the app, or clear the site’s data in your browser.</P>

      <H2>Questions and requests</H2>
      <P>
        Write to <Mail /> to ask what we hold about you, to have it deleted, or with any question about this page.
      </P>

      <H2>Changes to this page</H2>
      <P>If this page changes, the new version is published here with a new date.</P>
    </LegalPage>
  );
}
