import { A, H2, LegalPage, List, Mail, OPERATOR, P, legalMetadata } from '@/components/Legal';

// How to do the few things there are to do: connect calendars, let an AI assistant read some of
// them, take either away, and reach us. Every step here is what the app does (docs/MCP.md,
// docs/CALENDAR_CONNECTIONS.md); if a step changes, this page changes in the same commit.

export const metadata = legalMetadata('Help', 'How to connect calendars and AI assistants to Koyomi, how to remove them, and how to reach us.', '/help');

const UPDATED = '10 November 2026';

/** Koyomi's address for AI assistants (docs/MCP.md). */
const MCP_ADDRESS = 'https://app.koyomi.guru/mcp';

export default function Help() {
  return (
    <LegalPage title="Help" updated={UPDATED}>
      <P>
        Koyomi is a calendar for planning your own time. The events you write in it stay on your device, and you can bring in calendars from
        elsewhere to see beside them. This page says how to do each thing there is to do. <A href="/privacy">Privacy</A> says exactly what is kept.
      </P>

      <H2>Connecting your calendars</H2>
      <P>
        Open Calendars in Koyomi (the Calendars button, or C on a keyboard), choose Add calendar account, and pick Google, Microsoft, Yahoo or
        Calendar link. You sign in with 6Away first. Every connection is read-only: Koyomi cannot change anything in your calendars.{' '}
        <A href="/open?calendars=open">Open Calendars</A>
      </P>
      <List>
        <li>Google: choose the account, then allow Koyomi to see your calendar list and your events. You can connect several Google accounts.</li>
        <li>Microsoft: a personal, work or school account. Work and school accounts may need an administrator’s approval (below).</li>
        <li>Yahoo: an app password you create in your Yahoo account’s security settings, never your Yahoo password itself.</li>
        <li>Calendar link: paste a calendar’s private link (an address ending in .ics, or starting with webcal://).</li>
      </List>

      <H2>Connecting Koyomi to an AI assistant</H2>
      <P>
        AI access is in a private beta, and not yet open to every Koyomi account. Where it is open to you, Calendars shows AI access, with
        Koyomi’s address for assistants: {MCP_ADDRESS}. Add that address to your assistant:
      </P>
      <List>
        <li>ChatGPT: in Plugins, add a custom MCP server with that address and OAuth sign-in, where your plan allows custom ones.</li>
        <li>Claude: in Customize, Connectors, add a custom connector with that address.</li>
        <li>Grok: in Connect Apps, add a new custom connector with that address.</li>
      </List>
      <P>
        The assistant then sends you to Koyomi to sign in and choose calendars. Those menus are the assistants’ own, and their names may change.
      </P>

      <H2>Choosing what an assistant can read</H2>
      <P>
        Koyomi’s page shows which assistant asked, the 6Away account you are signed in as, and your connected calendars, none of them ticked.
        Tick the ones it may read, then Allow read-only access. Each assistant has its own choice. To change it, connect Koyomi again from that
        assistant and choose again: the new choice replaces the old one. An assistant that registers itself anew each time it connects, as Grok
        does, is listed twice instead: revoke the older one. If you are signed in with the wrong account, choose Not you? Sign out, then connect
        again from the assistant.
      </P>
      <P>
        While its access is in place, the assistant can ask Koyomi for those calendars whenever it chooses. It receives each event’s title, its
        start and end, whether it lasts all day or is tentative, and the calendar’s name. It never receives descriptions, places or guests, your
        passwords or calendar links, or the events you write in Koyomi. What it receives is then kept by the company that runs it, under its
        own terms; check your assistant’s data settings, especially before you share a Google calendar.
      </P>

      <H2>Revoking an assistant’s access</H2>
      <P>
        In Koyomi, open Calendars, then AI access, and choose Revoke beside the assistant. Its access ends at once, and your calendars stay
        connected. It cannot take back what it has already received. AI access appears in Calendars once that device shows your connected
        calendars: if you do not see it, open Koyomi where you connected them.
      </P>

      <H2>Removing Koyomi inside the assistant</H2>
      <P>
        Removing or turning off Koyomi in ChatGPT, Claude or Grok may only stop that assistant using it: it does not always tell Koyomi. Koyomi’s
        permission stays in place until you revoke it in Koyomi, as above. An assistant that goes unused for 30 days can no longer read, but its
        permission is only removed when you revoke it.
      </P>

      <H2>Removing connected calendars</H2>
      <P>
        In Calendars, each account has Disconnect, and each calendar link has Remove calendar. Either one deletes Koyomi’s record of it from our
        server and the device’s copy of its calendars, and takes its calendars out of every assistant’s access.
      </P>
      <List>
        <li>Google: Koyomi also asks Google to withdraw its access.</li>
        <li>
          Microsoft: Microsoft goes on listing Koyomi until you remove it there, in your account’s privacy settings, or for a work or school
          account in My Apps.
        </li>
        <li>Yahoo: the app password keeps working at Yahoo until you delete it there, under External connections.</li>
        <li>Calendar link: the link keeps working until you stop publishing the calendar where it lives.</li>
      </List>

      <H2>Your data, and deleting it</H2>
      <P>
        The events you write in Koyomi stay in your browser, on that device: delete them in Koyomi, or clear the site’s data in your browser.
        Our server keeps only a record of each account you connect and of each assistant you allow, never your events. Disconnecting an account
        or revoking an assistant deletes its record. You can also write to us to ask what we hold about you, or to have it deleted.
      </P>

      <H2>Microsoft work and school accounts</H2>
      <P>
        Many organisations let their people use only apps an administrator has approved. If yours does, Microsoft asks for that approval when
        you connect, and Koyomi tells you so. Ask your IT administrator to approve Koyomi: it asks Microsoft only to read your own calendars.
        Personal Microsoft accounts need no approval.
      </P>

      <H2>Contact</H2>
      <P>
        Write to <Mail /> with any question, problem or request. Koyomi is run by {OPERATOR}, United Arab Emirates.
      </P>
    </LegalPage>
  );
}
