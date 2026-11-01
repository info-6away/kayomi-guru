import { A, H2, LegalPage, List, Mail, OPERATOR, P, legalMetadata } from '@/components/Legal';

// What Koyomi keeps, where, and what it is used for. Every sentence here describes what the code
// does (docs/CALENDAR_CONNECTIONS.md says the same at more length): if what Koyomi reads, keeps
// or sends ever changes, this page changes in the same commit, with a new date.

export const metadata = legalMetadata('Privacy', 'What Koyomi keeps, where it keeps it, and what it is used for.', '/privacy');

const UPDATED = '1 November 2026';

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated={UPDATED}>
      <P>
        Koyomi is a calendar for planning your own time. It is run by {OPERATOR}, United Arab Emirates. This page says what Koyomi keeps, where it
        keeps it and what it is used for. For any question or request, write to <Mail />.
      </P>

      <H2>Your Koyomi calendar stays on your device</H2>
      <P>
        The events you write in Koyomi are kept in your browser, on the device you write them on. They are not sent to our servers and we cannot
        see them. Ordinary use needs no account.
      </P>
      <P>There is no cloud copy. If you clear the site’s data in your browser, or remove the installed app’s data, they are gone.</P>
      <P>
        Two more things are kept on the device: whether you chose the light or the dark appearance, and a copy of Koyomi’s own files, so that it
        opens without a connection.
      </P>

      <H2>Connecting Google Calendar</H2>
      <P>
        Connecting a Google calendar is optional. You can connect one Google account or several. Koyomi shows their events beside your own, so
        that you can see which hours are already taken. That is the only thing your Google Calendar data is used for.
      </P>
      <P>
        To connect an account, you first sign in with 6Away. Google then asks which account, and whether you allow Koyomi two things, both
        read-only:
      </P>
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
      <P>
        The identifier of an account’s main calendar is that account’s address. Koyomi uses it to tell your connected accounts apart, and to
        show you which calendars belong to which.
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

      <H2>Connecting a Microsoft calendar</H2>
      <P>
        Connecting a Microsoft calendar is optional too. You can connect one Microsoft account or several, personal or work and school, beside
        Google accounts or without them. Koyomi shows their events beside your own, and uses them for nothing else.
      </P>
      <P>To connect an account, you first sign in with 6Away. Microsoft then asks which account, and whether you allow Koyomi three things:</P>
      <List>
        <li>to sign you in, which tells Koyomi which Microsoft account it is (openid);</li>
        <li>to go on reading what you allow until you disconnect, without asking each time (offline_access);</li>
        <li>to read your calendars (Calendars.Read).</li>
      </List>
      <P>
        Koyomi asks Microsoft for no other permission: not your profile, not your email address, and not calendars other people share with you.
        It cannot create, change or delete anything in your Microsoft calendar. A work or school account may need its organisation to approve
        Koyomi first.
      </P>
      <P>
        Microsoft also has a narrower permission that leaves out an event’s body and attachments, but it does not let a personal Microsoft
        account’s calendar be read at all, so Koyomi asks for this one. Either way, Koyomi asks Microsoft only for the details listed below.
      </P>

      <H2>What Koyomi reads from Microsoft</H2>
      <P>
        Koyomi reads the names and identifiers of the account’s calendars, and for each whether it is the account’s main one, whether you can
        change it, and who owns it. The owner of the main calendar is the account’s address: Koyomi shows it to you beside that account’s
        calendars, and leaves out calendars that someone else owns.
      </P>
      <P>
        When you connect an account, Microsoft also tells Koyomi which account it is: an identifier Microsoft gives that account for Koyomi
        alone, and the identifier of its organisation. Koyomi uses them to tell your connected accounts apart.
      </P>
      <P>For the calendars you choose to show in Koyomi, it reads these details of each event, from five weeks back to twenty-seven weeks ahead:</P>
      <List>
        <li>its identifier at Microsoft, its title, its start and end, whether it lasts all day, and the time zone it was written in;</li>
        <li>whether it is cancelled, shown as tentative, or one occurrence of a repeating event;</li>
        <li>a link to the event in Outlook;</li>
        <li>your own reply to an invitation, used only to leave out events you declined.</li>
      </List>
      <P>Koyomi does not ask Microsoft for bodies, locations, attendees, attachments or online-meeting details, so Microsoft does not send them.</P>

      <H2>Connecting a Yahoo calendar</H2>
      <P>
        Connecting a Yahoo calendar is optional too. You can connect one Yahoo account or several, beside your other accounts or without them.
        Koyomi shows their events beside your own, and uses them for nothing else.
      </P>
      <P>
        A Yahoo calendar is read through Yahoo’s CalDAV service, at caldav.calendar.yahoo.com, with an app password: a password you create for
        Koyomi yourself, in your Yahoo account’s security settings (Account Security, then External connections). Koyomi never asks for your
        normal Yahoo password. To connect an account, you first sign in with 6Away, then give Koyomi your Yahoo email and that app password.
        Koyomi checks them with Yahoo at once, and keeps them only if Yahoo accepts them.
      </P>
      <P>
        Yahoo does not limit an app password to your calendar: whoever holds one may also be able to open your Yahoo mail with it. Koyomi uses
        it only to read your calendars through CalDAV, and for nothing else. It never reads your mail, your email content or anything else in
        your account, and it cannot create, change or delete anything in your Yahoo calendar.
      </P>

      <H2>What Koyomi reads from Yahoo</H2>
      <P>
        Koyomi reads the names and addresses at Yahoo of the account’s calendars, and for each whether it holds events and whether you can
        change it. Lists of tasks are left out.
      </P>
      <P>
        For the calendars you choose to show in Koyomi, it asks Yahoo for these details of each event, from five weeks back to twenty-seven
        weeks ahead, and of repeating events that began up to five years before that:
      </P>
      <List>
        <li>its identifier at Yahoo, its title, its start and end or its length, whether it lasts all day, and the time zone it was written in;</li>
        <li>whether it repeats, and how: its rule, the dates added to it or left out, and any occurrence that was changed;</li>
        <li>whether it is cancelled or tentative, and when it last changed.</li>
      </List>
      <P>
        Yahoo’s CalDAV service may send each event whole, whatever Koyomi asks for, and if it sends none of the details Koyomi names, Koyomi
        asks for the events whole: with their description, location, organiser, guests, alarms and attachments. Either way, Koyomi drops all
        of that on our server the moment it reads it. None of it reaches your device, and none of it is
        kept or written to a log. Yahoo has no address for a single event, so Koyomi links to none.
      </P>

      <H2>Subscribing to a calendar link</H2>
      <P>
        Subscribing to a calendar by its link is optional too. Some calendars, Outlook’s among them, can be published as a private, read-only
        link (an .ics or webcal address). You can give Koyomi one such link or several, beside your accounts or without them. Koyomi shows that
        calendar’s events beside your own, and uses them for nothing else. It is a subscription, not a copy: Koyomi reads the calendar again
        from time to time, and shows it as it is.
      </P>
      <P>
        To subscribe, you first sign in with 6Away, then paste the link. A calendar link works like a password: anyone who has it may be able to
        see that calendar, so keep it to yourself. Koyomi sends it to our server once, over HTTPS, when you add it. It is never sent back to your
        browser, never kept on your device, and never written to a log or shown in an error. Our server fetches the calendar, never your
        browser, and keeps the link only if it gives a calendar. It fetches only from the public internet: never from a private network, and a
        redirect is checked the same way.
      </P>
      <P>Koyomi only reads a calendar link. It cannot create, change or delete anything in the calendar it leads to.</P>

      <H2>What Koyomi reads from a calendar link</H2>
      <P>
        A calendar link gives the whole calendar, whatever Koyomi would rather have: it may include descriptions, locations, organisers, guests,
        contacts, comments, attachments, reminders, meeting links and other details. Of each event from five weeks back to twenty-seven weeks
        ahead, Koyomi reads only:
      </P>
      <List>
        <li>its identifier in that calendar, its title, its start and end or its length, whether it lasts all day, and the time zone it was written in;</li>
        <li>whether it repeats, and how: its rule, the dates added to it or left out, and any occurrence that was changed;</li>
        <li>whether it is cancelled or tentative, which version of it this is, and when it last changed.</li>
      </List>
      <P>
        Everything else in the calendar is dropped on our server as it is read. None of it reaches your device, and none of it is kept or written
        to a log. Koyomi also reads the name the calendar gives itself, if you give it no name of your own. A calendar link has no address for a
        single event, so Koyomi links to none.
      </P>

      <H2>Where it is kept</H2>
      <P>
        On your device. The calendar names and identifiers and the event details above are kept in your browser, apart from your Koyomi calendar, so
        that they can be shown when you are offline, together with the address of each connected account, which calendars you chose to show and a
        note that a calendar is connected. For a calendar link, the device keeps the calendar’s name, never the link, and what the calendar’s
        server said of the version last read (its ETag and Last-Modified date), so that Koyomi can ask whether it has changed since. They are
        removed from the device when you hide a calendar, when you disconnect that account or remove that calendar, or when a different person
        signs in on that device.
      </P>
      <P>
        On our server. Events pass through our server on their way from Google to your device. They are not stored there and are not written to
        its log. The server stores one record for each Google account you connect. It holds:
      </P>
      <List>
        <li>your 6Away identifier;</li>
        <li>
          a keyed hash that stands for which Google account it is, so that the same account is not recorded twice. It is made from the
          account’s address and cannot be turned back into it;
        </li>
        <li>the refresh token Google issued, encrypted with AES-256-GCM;</li>
        <li>the permissions Google granted, and whether the connection is working;</li>
        <li>when the record was made and last changed;</li>
        <li>a count of recent requests, used to limit how often Google is asked.</li>
      </List>
      <P>It holds no email address, no calendar names and no events.</P>
      <P>
        Each Microsoft account you connect has a record of the same kind: your 6Away identifier; a keyed hash made from the identifiers
        Microsoft gives that account, which cannot be turned back into them; the refresh token Microsoft issued, encrypted with AES-256-GCM;
        the permissions Microsoft granted and whether the connection is working; when the record was made and last changed; and a count of
        recent requests. Microsoft issues a new refresh token each time one is used, and the record keeps only the latest. Microsoft’s events
        pass through our server in the same way, and are not stored there or written to its log.
      </P>
      <P>
        Each Yahoo account you connect has a record of the same kind, with one difference: in place of a refresh token, it holds your Yahoo
        email and the app password, with where that account’s calendars are at Yahoo, all encrypted together with AES-256-GCM, because Yahoo
        needs the email and the app password with every request. Its keyed hash is made from the account’s identifier at Yahoo. Yahoo’s events
        pass through our server in the same way, and are not stored there or written to its log.
      </P>
      <P>
        Each calendar link you subscribe to has a record of the same kind: your 6Away identifier; a keyed hash made from the link, so that the
        same link is not recorded twice, which cannot be turned back into it; the link itself and the name the calendar is shown by, encrypted
        together with AES-256-GCM and bound to that record; whether the link is working; when the record was made and last changed; and a count
        of recent requests. The calendar’s events pass through our server in the same way, and are not stored there or written to its log.
      </P>
      <P>
        Google’s tokens never reach your browser. The short-lived access token used to read your calendar is held only in the server’s memory.
        The same is true of Microsoft’s. A calendar link is decrypted on our server only while that calendar is being read.
      </P>
      <P>
        Your Yahoo app password reaches our server once, when you give it, and never comes back to your browser: it is not shown again, not
        sent back in any answer, and not kept on your device. While it is in use it is held in the server’s memory for a few minutes at a time.
        Your browser or password manager may offer to save it for you; whether it does is between you and them, and Koyomi has no part in it.
      </P>

      <H2>Signing in with 6Away</H2>
      <P>Koyomi asks you to sign in only when you connect a calendar. Sign-in is provided by 6Away.</P>
      <P>
        To keep you signed in, Koyomi sets a sign-in cookie in your browser, for up to thirty days. It is an HttpOnly cookie, which page scripts
        cannot read. The session it carries can contain your 6Away identifier, your name, your email address and your sign-in credential. Of
        these, our database keeps only the identifier.
      </P>

      <H2>How your Google data is protected</H2>
      <P>Koyomi protects your Google user data with these technical and organisational security measures:</P>
      <List>
        <li>
          Google’s refresh token is encrypted with AES-256-GCM before it is stored, and bound to your own record, so that a copy moved to another
          record cannot be decrypted. The encryption key is kept only in the server’s settings, separate from the database that holds the tokens.
        </li>
        <li>
          Everything is sent encrypted, over HTTPS (TLS): between your browser and Koyomi, and between Koyomi’s server and Google, 6Away and the
          database. A visit over plain HTTP is redirected to HTTPS, and browsers are told to use only HTTPS for Koyomi.
        </li>
        <li>
          Each connection can be used only by the person who made it. The server knows who is asking only from their sign-in cookie, and looks
          for a connection only among that person’s own. Asking for anyone else’s finds nothing.
        </li>
        <li>Google’s tokens never reach your browser. Your events are not stored on our server, and neither tokens nor events are written to its log.</li>
        <li>Koyomi holds read-only permission only, so nothing it does can change your Google Calendar.</li>
        <li>On your device, the copy of your Google calendars and events is kept in your browser’s storage for Koyomi, which other websites cannot read.</li>
        <li>Only the people who run Koyomi at 6Away can reach the production server’s settings and its database.</li>
      </List>
      <P>Disconnecting an account removes what Koyomi holds of it, as described below.</P>
      <P>The same measures protect your Microsoft calendar data, and the calendars you subscribe to by link, with their links.</P>
      <P>The same measures protect your Yahoo calendar data and app password.</P>

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
      <P>
        The same is true of your Microsoft calendar data, and of calendars you subscribe to by link: they are used only to show your events beside
        your own, and for nothing else.
      </P>
      <P>
        The same is true of your Yahoo calendar data. Koyomi does not use your Yahoo app password for anything but reading your calendars, and has
        no access to your Yahoo mail or email content.
      </P>

      <H2>Who helps us run Koyomi</H2>
      <P>Koyomi runs on services from three companies. What each one handles is different:</P>
      <List>
        <li>
          Vercel hosts the website and the server. Your Google Calendar events and calendar names pass through that server on their way from
          Google to your device. They are not stored there.
        </li>
        <li>
          Neon hosts the database, in the United States. It stores only the connection records described above. It receives no events and no
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
      <P>
        A Microsoft calendar comes from Microsoft, under Microsoft’s own terms. Its events and calendar names pass through Vercel’s server in
        the same way, and are not stored there. Neon stores only the connection records described above, and receives no events and no
        calendar names. 6Away receives none of them, and none of Microsoft’s tokens.
      </P>
      <P>
        A Yahoo calendar comes from Yahoo, under Yahoo’s own terms. Its events and calendar names pass through Vercel’s server in the same way,
        and are not stored there. Neon stores the connection records described above, with the app password encrypted, and receives no events
        and no calendar names. 6Away receives none of them, and never your app password.
      </P>
      <P>
        A calendar you subscribe to by link comes from wherever it is published, under that service’s own terms. Our server fetches it from
        there; its events and name pass through Vercel’s server in the same way, and are not stored there. Neon stores only its record, with
        the link encrypted. 6Away receives none of it.
      </P>

      <H2>How long things are kept, and deleting them</H2>
      <P>
        Our server keeps nothing of your Google data except the connection records described above. A connection record is kept until you
        disconnect that account or ask us to delete it. The copy on your device is kept until you hide that calendar, disconnect that account,
        or a different person signs in on that device.
      </P>
      <P>
        Each connected account has its own Disconnect, in Koyomi’s Calendars pane. It asks Google to revoke Koyomi’s access to that account,
        deletes that account’s record from our server and deletes the device’s copy of that account’s calendars. Your other connected accounts
        are not affected. Disconnecting the last one also signs that device out. Another device on which you had connected removes its own copy
        the next time it is signed in and checks. Your Koyomi calendar is not touched.
      </P>
      <P>
        If you remove Koyomi’s access in your Google Account instead, Koyomi can read nothing further from that account. Its record stays on our
        server, marked as needing reconnection, until you reconnect or disconnect.
      </P>
      <P>
        A Microsoft account’s Disconnect deletes its record, with the only copy of Microsoft’s refresh token, from our server, and deletes the
        device’s copy of that account’s calendars. Microsoft gives apps no way to withdraw their own access, so Microsoft goes on listing Koyomi
        among the apps that account has allowed until you remove it there: for a personal account, among the apps and services in your
        Microsoft account’s privacy settings; for a work or school account, in My Apps (myapplications.microsoft.com). Without the token, that
        access cannot be used. If you remove Koyomi there first, Koyomi can read nothing further from that account once the short-lived
        access token it holds has expired, at most about an hour later, and its record is then marked as needing reconnection.
      </P>
      <P>
        A Yahoo account’s Disconnect deletes its record, with Koyomi’s only copy of the app password, from our server, and deletes the device’s
        copy of that account’s calendars. Koyomi cannot cancel the app password at Yahoo: it goes on working there until you delete it, in your
        Yahoo account’s security settings, under External connections. If you delete it there first, Koyomi can read nothing further from that
        account, and its record is marked as needing reconnection until you reconnect with a new app password, or disconnect.
      </P>
      <P>
        A calendar link’s Remove calendar deletes its record, with Koyomi’s only copy of the link, from our server, and deletes the device’s
        copy of that calendar. It does not stop the link working: Koyomi cannot withdraw a published link, and does not claim to. To stop the
        link itself working, turn off or reset that calendar’s publishing where it lives (for Outlook, in its calendar sharing settings). If a
        link stops giving a calendar, Koyomi marks it as needing an update and keeps what it read until you update or remove it.
      </P>
      <P>
        You can also ask us to delete the record by writing to <Mail />.
      </P>
      <P>To delete your Koyomi calendar, delete its events in the app, or clear the site’s data in your browser.</P>

      <H2>Questions and requests</H2>
      <P>
        Write to <Mail /> to ask what we hold about you, to have it deleted, or with any question about this page.
      </P>

      <H2>Changes to this page</H2>
      <P>If this page changes, the new version is published here with a new date.</P>
    </LegalPage>
  );
}
