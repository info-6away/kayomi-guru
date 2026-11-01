import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { EVENT_FIELDS, MICROSOFT_EVENT_FIELDS } from '../../lib/calendars/normalize';
import { AHEAD_DAYS, BACK_DAYS } from '../../lib/calendars/window';
import { SCOPES } from '../../lib/server/google';
import { MICROSOFT_SCOPES } from '../../lib/server/microsoft';
import { read } from './contrast';

// The landing page (koyomi.guru) and the calendar (app.koyomi.guru) come from one build.
// On any other host, such as this test server, the landing page is at /home and the calendar at /.

test.describe('landing page', () => {
  test('shows the design and leads to the calendar', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));

    await page.goto('/home');
    await expect(page).toHaveTitle('Koyomi — Calendar, simplified.');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendar, simplified.');
    await expect(page.getByRole('main').locator('section').first().locator('p')).toHaveText('All your calendars. One quiet place.');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'All your calendars. One quiet place.');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Things with a time.', 'The ones you already have.', 'Nothing else.']);
    await expect(page.getByText('Your day should have space in it.')).toBeVisible();
    // Koyomi is a calendar and nothing beside it: no list of things to do, anywhere on the page.
    await expect(page.getByText(/\bPlan\b|waiting|to-do|task list/i)).toHaveCount(0);
    // What it says of connected calendars is what is so: Google, several accounts, read only.
    await expect(page.getByText('Connect your Google accounts and see their events beside your own. Koyomi only reads them.')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/koyomi\.guru\/?$/);

    // Three ways in, all to the same place, and the footer's two quiet links. Nothing else.
    await expect(page.getByRole('link')).toHaveCount(5);
    await expect(page.locator('a[href="/open"]')).toHaveCount(3);
    await expect(page.getByRole('contentinfo').getByRole('link')).toHaveText(['Privacy', 'Terms']);

    // The landing page is a page, not the app: nothing to install, no worker.
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect(problems).toEqual([]);

    await page.getByRole('link', { name: /Begin/ }).click();
    await expect(page.locator('[data-day]')).toHaveCount(7);
    await expect(page).toHaveTitle('Koyomi');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  });

  test('ink mode works and is remembered', async ({ page }) => {
    await page.goto('/home');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Toggle ink mode' }).click();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(29, 29, 27)');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the whole week on a desktop, three days on a phone', async ({ page }) => {
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/home');
    for (const day of ['MON', 'WED', 'THU', 'SUN']) await expect(page.getByText(day, { exact: true })).toBeVisible();
    expect(await sideways()).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const day of ['MON', 'TUE', 'WED']) await expect(page.getByText(day, { exact: true })).toBeVisible();
    for (const day of ['THU', 'SUN']) await expect(page.getByText(day, { exact: true })).toBeHidden();
    expect(await sideways()).toBe(false);
    // No label in the sample week is cut short.
    const clipped = await page.locator('section[aria-label="A sample week"] .truncate').evaluateAll((els) =>
      els.filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth).map((el) => el.textContent),
    );
    expect(clipped).toEqual([]);
  });
});

// The two pages the landing page links to. They say what Koyomi keeps and on what terms it is
// offered, so what they say is held to what the code does.
test.describe('privacy and terms', () => {
  const OPERATOR = '6Away AI FZE LLC, United Arab Emirates';
  const CONTACT = 'privacy@6away.ai';
  const LIMITED_USE =
    'Koyomi’s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.';
  const text = async (page: Page) => (await page.getByRole('main').innerText()).replace(/\s+/g, ' ');

  test('the footer leads to both pages, and they lead back', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));

    await page.goto('/home');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page).toHaveTitle('Privacy — Koyomi');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://koyomi.guru/privacy');

    await page.getByRole('contentinfo').getByRole('link', { name: 'Terms' }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page).toHaveTitle('Terms — Koyomi');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://koyomi.guru/terms');
    // Terms points at Privacy for what is kept.
    await page.getByRole('main').getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy');

    // Like the landing page, these are pages and not the app: nothing to install, no worker.
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);

    // The wordmark goes home, and Open Koyomi to the calendar.
    await page.getByRole('link', { name: 'Koyomi, home' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendar, simplified.');
    await page.goto('/terms');
    await page.getByRole('link', { name: /Open Koyomi/ }).click();
    await expect(page.locator('[data-day]')).toHaveCount(7);
    expect(problems).toEqual([]);
  });

  test('the privacy page says what the code does', async ({ page }) => {
    await page.goto('/privacy');
    const said = await text(page);

    // Who runs Koyomi, and the one address to write to.
    expect(said).toContain(`It is run by ${OPERATOR}.`);
    const mail = await page.getByRole('main').locator('a[href^="mailto:"]').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(mail.length).toBeGreaterThanOrEqual(3);
    expect(new Set(mail)).toEqual(new Set([`mailto:${CONTACT}`]));

    // Exactly the permissions the code asks Google for, by name, and no other.
    const requested = SCOPES.map((scope) => scope.split('/').pop()!);
    expect(requested).toEqual(['calendar.calendarlist.readonly', 'calendar.events.readonly']);
    // (Not a host name such as Yahoo's caldav.calendar.yahoo.com: a permission's name stands on its own.)
    expect([...new Set(said.match(/(?<![\w.])calendar\.[a-z.]*[a-z]/g))].sort()).toEqual([...requested].sort());
    expect(said).toContain('It cannot create, change or delete anything in your Google Calendar.');

    // The span that is read, and the fields. If either changes in the code, this page changes with it.
    expect([BACK_DAYS / 7, AHEAD_DAYS / 7]).toEqual([5, 27]);
    expect(said).toContain('from five weeks back to twenty-seven weeks ahead');
    expect(EVENT_FIELDS).toBe('nextPageToken,nextSyncToken,items(id,status,summary,htmlLink,updated,eventType,start,end,attendees(self,responseStatus))');
    for (const part of ['its title, its start and end', 'confirmed, tentative or cancelled', 'when it last changed', 'a link to the event at Google', 'its type', 'your own reply to an invitation']) {
      expect(said, part).toContain(part);
    }
    expect(said).toContain('Koyomi does not ask Google for descriptions, locations, guest lists or meeting links');

    // What Koyomi itself keeps is events, and nothing else: there is no Plan to speak of any more.
    expect(said).toContain('The events you write in Koyomi are kept in your browser, on the device you write them on.');
    expect(said).toContain('To delete your Koyomi calendar, delete its events in the app, or clear the site’s data in your browser.');
    expect(said).not.toMatch(/\bPlan\b/);

    // More than one Google account, each told apart by its address, and how.
    for (const part of [
      'You can connect one Google account or several.',
      'Google then asks which account, and whether you allow Koyomi two things, both read-only',
      'The identifier of an account’s main calendar is that account’s address. Koyomi uses it to tell your connected accounts apart, and to show you which calendars belong to which.',
      'together with the address of each connected account',
      'The server stores one record for each Google account you connect.',
      'a keyed hash that stands for which Google account it is, so that the same account is not recorded twice. It is made from the account’s address and cannot be turned back into it',
    ]) {
      expect(said, part).toContain(part);
    }

    // Where it is kept, and how.
    for (const part of [
      'They are not sent to our servers and we cannot see them. Ordinary use needs no account.',
      'They are not stored there and are not written to its log.',
      'the refresh token Google issued, encrypted with AES-256-GCM',
      'It holds no email address, no calendar names and no events.',
      'Google’s tokens never reach your browser.',
      'It is an HttpOnly cookie, which page scripts cannot read.',
      'your 6Away identifier, your name, your email address and your sign-in credential',
      'for up to thirty days',
    ]) {
      expect(said, part).toContain(part);
    }

    // How it is protected, as Google's review asks a privacy policy to say: each one a fact of the code.
    for (const part of [
      'Koyomi protects your Google user data with these technical and organisational security measures',
      'Google’s refresh token is encrypted with AES-256-GCM before it is stored, and bound to your own record',
      'The encryption key is kept only in the server’s settings, separate from the database that holds the tokens.',
      'Everything is sent encrypted, over HTTPS (TLS)',
      'Each connection can be used only by the person who made it.',
      'neither tokens nor events are written to its log',
      'Koyomi holds read-only permission only',
      'Only the people who run Koyomi at 6Away can reach the production server’s settings and its database.',
    ]) {
      expect(said, part).toContain(part);
    }

    // What it is never used for, in Google's required words.
    expect(said).toContain('Your Google Calendar data is not sold.');
    expect(said).toContain('not used for advertising, not used for analytics or to build a profile of you, and not used to train artificial-intelligence or machine-learning models');
    expect(said).toContain(LIMITED_USE);
    // The policy it names is a link to Google's own page, inside that very sentence.
    const policy = page.locator('p', { hasText: 'Limited Use requirements' }).getByRole('link', { name: 'Google API Services User Data Policy', exact: true });
    await expect(policy).toBeVisible();
    await expect(policy).toHaveAttribute('href', 'https://developers.google.com/terms/api-services-user-data-policy');

    // Who else handles it: each of the three, and exactly what reaches it.
    expect(said).toContain('It is not given to anyone for purposes of their own.');
    for (const part of [
      'Vercel hosts the website and the server. Your Google Calendar events and calendar names pass through that server on their way from Google to your device. They are not stored there.',
      'Neon hosts the database, in the United States. It stores only the connection records described above. It receives no events and no calendar names.',
      '6Away provides sign-in. It learns that you signed in to Koyomi. It does not receive your Google Calendar events, your calendar names or Google’s tokens.',
    ]) {
      expect(said, part).toContain(part);
    }

    // How long things are kept, disconnecting, and deleting.
    for (const part of [
      'Our server keeps nothing of your Google data except the connection records described above.',
      'A connection record is kept until you disconnect that account or ask us to delete it.',
      'The copy on your device is kept until you hide that calendar, disconnect that account, or a different person signs in on that device.',
      'Each connected account has its own Disconnect, in Koyomi’s Calendars pane.',
      'It asks Google to revoke Koyomi’s access to that account, deletes that account’s record from our server and deletes the device’s copy of that account’s calendars.',
      'Your other connected accounts are not affected. Disconnecting the last one also signs that device out.',
      'Your Koyomi calendar is not touched.',
      'marked as needing reconnection, until you reconnect or disconnect',
      `You can also ask us to delete the record by writing to ${CONTACT}.`,
    ]) {
      expect(said, part).toContain(part);
    }
  });

  test('the privacy page says what the Microsoft connection does, beside Google’s and without changing what is said of Google', async ({ page }) => {
    await page.goto('/privacy');
    const said = await text(page);
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toContainText(['Connecting Google Calendar', 'What Koyomi reads from Google', 'Connecting a Microsoft calendar', 'What Koyomi reads from Microsoft']);

    // Exactly the permissions the code asks Microsoft for, by name, and what each is for.
    expect(MICROSOFT_SCOPES.map((scope) => scope.split('/').pop())).toEqual(['openid', 'offline_access', 'Calendars.Read']);
    for (const scope of ['(openid)', '(offline_access)', '(Calendars.Read)']) expect(said, scope).toContain(scope);
    expect(said).not.toMatch(/Calendars\.(ReadBasic|Read\.Shared|ReadWrite)|User\.Read|Mail\./);
    expect(said).toContain('Either way, Koyomi asks Microsoft only for the details listed below.');
    expect(said).toContain('not your profile, not your email address, and not calendars other people share with you');
    expect(said).toContain('It cannot create, change or delete anything in your Microsoft calendar.');
    expect(said).toContain('A work or school account may need its organisation to approve Koyomi first.');

    // The fields, and the span. If they change in the code, this page changes with them.
    expect(MICROSOFT_EVENT_FIELDS).toBe('id,subject,start,end,isAllDay,isCancelled,showAs,responseStatus,webLink,type,originalStartTimeZone');
    for (const part of [
      'its identifier at Microsoft, its title, its start and end, whether it lasts all day, and the time zone it was written in',
      'whether it is cancelled, shown as tentative, or one occurrence of a repeating event',
      'a link to the event in Outlook',
      'Koyomi does not ask Microsoft for bodies, locations, attendees, attachments or online-meeting details',
      'an identifier Microsoft gives that account for Koyomi alone, and the identifier of its organisation',
      'leaves out calendars that someone else owns',
    ]) {
      expect(said, part).toContain(part);
    }
    // On the server, and what Disconnect can and cannot do at Microsoft.
    for (const part of [
      'Each Microsoft account you connect has a record of the same kind',
      'the refresh token Microsoft issued, encrypted with AES-256-GCM',
      'Microsoft issues a new refresh token each time one is used, and the record keeps only the latest.',
      'The same is true of Microsoft’s.',
      'The same measures protect your Microsoft calendar data, and the calendars you subscribe to by link',
      'Microsoft gives apps no way to withdraw their own access',
      'My Apps (myapplications.microsoft.com)',
      '6Away receives none of them, and none of Microsoft’s tokens.',
      'once the short-lived access token it holds has expired, at most about an hour later',
    ]) {
      expect(said, part).toContain(part);
    }
    // What is said of Google is said exactly as before, Limited Use and all.
    expect(said).toContain(LIMITED_USE);
    expect(said).toContain('It asks Google to revoke Koyomi’s access to that account');
  });

  test('the privacy page says what the Yahoo connection does and keeps, beside Google’s and Microsoft’s, which are unchanged', async ({ page }) => {
    await page.goto('/privacy');
    const said = await text(page);
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toContainText(['Connecting Google Calendar', 'What Koyomi reads from Google', 'Connecting a Microsoft calendar', 'What Koyomi reads from Microsoft', 'Connecting a Yahoo calendar', 'What Koyomi reads from Yahoo']);
    for (const part of [
      // How it is connected, and what with.
      'A Yahoo calendar is read through Yahoo’s CalDAV service, at caldav.calendar.yahoo.com, with an app password',
      'Koyomi never asks for your normal Yahoo password.',
      'Koyomi checks them with Yahoo at once, and keeps them only if Yahoo accepts them.',
      // What the credential could do, said plainly, and what Koyomi does with it.
      'Yahoo does not limit an app password to your calendar: whoever holds one may also be able to open your Yahoo mail with it.',
      'It never reads your mail, your email content or anything else in your account, and it cannot create, change or delete anything in your Yahoo calendar.',
      // What is read, the span, and what is dropped.
      'from five weeks back to twenty-seven weeks ahead, and of repeating events that began up to five years before that',
      'its identifier at Yahoo, its title, its start and end or its length, whether it lasts all day, and the time zone it was written in',
      'Yahoo’s CalDAV service may send each event whole, whatever Koyomi asks for',
      'Koyomi drops all of that on our server the moment it reads it. None of it reaches your device, and none of it is kept or written to a log.',
      'Lists of tasks are left out.',
      // Where it is kept, and how.
      'it holds your Yahoo email and the app password, with where that account’s calendars are at Yahoo, all encrypted together with AES-256-GCM',
      'Your Yahoo app password reaches our server once, when you give it, and never comes back to your browser',
      'The same measures protect your Yahoo calendar data and app password.',
      'has no access to your Yahoo mail or email content',
      'Neon stores the connection records described above, with the app password encrypted',
      // What Disconnect can and cannot do.
      'Koyomi cannot cancel the app password at Yahoo: it goes on working there until you delete it',
      'until you reconnect with a new app password, or disconnect',
    ]) {
      expect(said, part).toContain(part);
    }
    // Google's and Microsoft's statements are as they were.
    expect(said).toContain(LIMITED_USE);
    expect(said).toContain('It asks Google to revoke Koyomi’s access to that account');
    expect(said).toContain('to read your calendars (Calendars.Read).');
    expect(said).toContain('The server stores one record for each Google account you connect.');
  });

  test('the privacy page says what a calendar link is, how it is kept, and what removing it can and cannot do', async ({ page }) => {
    await page.goto('/privacy');
    const said = await text(page);
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toContainText(['What Koyomi reads from Microsoft', 'Subscribing to a calendar link', 'What Koyomi reads from a calendar link', 'Where it is kept']);
    for (const part of [
      // Optional, a subscription, and read only.
      'Subscribing to a calendar by its link is optional too.',
      'It is a subscription, not a copy',
      'Koyomi only reads a calendar link. It cannot create, change or delete anything in the calendar it leads to.',
      // The link is a secret, kept on the server, encrypted, and nowhere else.
      'A calendar link works like a password: anyone who has it may be able to see that calendar, so keep it to yourself.',
      'It is never sent back to your browser, never kept on your device, and never written to a log or shown in an error.',
      'Our server fetches the calendar, never your browser, and keeps the link only if it gives a calendar.',
      'It fetches only from the public internet: never from a private network, and a redirect is checked the same way.',
      'the link itself and the name the calendar is shown by, encrypted together with AES-256-GCM and bound to that record',
      'a keyed hash made from the link, so that the same link is not recorded twice, which cannot be turned back into it',
      'For a calendar link, the device keeps the calendar’s name, never the link',
      'A calendar link is decrypted on our server only while that calendar is being read.',
      // What is read of it, and what is dropped.
      'it may include descriptions, locations, organisers, guests, contacts, comments, attachments, reminders, meeting links and other details',
      'Everything else in the calendar is dropped on our server as it is read. None of it reaches your device, and none of it is kept or written to a log.',
      'The calendar’s events pass through our server in the same way, and are not stored there or written to its log.',
      // Removing it, and what that does not do.
      'A calendar link’s Remove calendar deletes its record, with Koyomi’s only copy of the link, from our server',
      'It does not stop the link working: Koyomi cannot withdraw a published link, and does not claim to.',
      'turn off or reset that calendar’s publishing where it lives',
      'Neon stores only its record, with the link encrypted. 6Away receives none of it.',
    ]) {
      expect(said, part).toContain(part);
    }
    // What is said of Google is said exactly as before, Limited Use and all.
    expect(said).toContain(LIMITED_USE);
    expect(said).toContain('Koyomi does not ask Google for descriptions, locations, guest lists or meeting links');
  });

  test('the terms are short, and say on what terms Koyomi is offered', async ({ page }) => {
    await page.goto('/terms');
    const said = await text(page);
    expect(said).toContain(`Koyomi is provided by ${OPERATOR}.`);
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
      'What Koyomi is',
      'Your calendar is on your device',
      'Connected calendars',
      'As it is',
      'Fair use',
      'Changes',
      'Liability',
      'Privacy',
      'Governing law',
    ]);
    for (const part of [
      'We keep no copy and there is no cloud backup, so we cannot restore them.',
      'The events you write are kept in your browser, on your device.',
      'You may connect one or more Google accounts so that Koyomi shows their calendars beside your own.',
      'A connection is read-only: Koyomi cannot change your Google Calendar.',
      'You can disconnect each account at any time in Koyomi.',
      'Microsoft accounts can be connected in the same way, and the same is true of them.',
      'Google, Microsoft, Yahoo or the service that publishes a calendar link for your calendar',
      'Yahoo accounts can be connected too, with an app password you create at Yahoo, and the same is true of them.',
      'You may also subscribe to a published calendar by its private link: Koyomi only reads it, and you can remove it at any time.',
      'your use of them is subject to their own terms',
      'Koyomi is provided as it is and as available.',
      'Use Koyomi lawfully and reasonably.',
      'To the extent the law allows',
      'These terms are governed by the laws of the United Arab Emirates.',
    ]) {
      expect(said, part).toContain(part);
    }
    await expect(page.getByRole('main').locator('a[href^="mailto:"]')).toHaveAttribute('href', `mailto:${CONTACT}`);
    expect(said).not.toMatch(/\bPlan\b/);
    // Short: a page or two, not a contract.
    expect(said.split(' ').length).toBeLessThan(475);
  });

  for (const path of ['/privacy', '/terms']) {
    test(`${path} is built like a page: one title, sections in order, links that say where they go`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(5);
      // No heading level is skipped, and every heading is inside the page's main part.
      expect(await page.locator('h3, h4, h5, h6').count()).toBe(0);
      expect(await page.locator('h1, h2').count()).toBe(await page.getByRole('main').locator('h1, h2').count());
      // Every link and button has words or a label of its own.
      const unnamed = await page.locator('a, button').evaluateAll((els) => els.filter((el) => !(el.getAttribute('aria-label') || el.textContent || '').trim()).length);
      expect(unnamed).toBe(0);
      await expect(page.getByText(/^LAST UPDATED \d{1,2} [A-Z]+ 20\d\d$/)).toBeVisible();
      // The keyboard reaches the first link, and it shows.
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Koyomi, home' })).toBeFocused();
    });
  }
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    /** Reads the page a screen at a time, top to bottom: everything on it must be easy to read. */
    const readable = async (page: Page, name: string) => {
      await page.evaluate(() => document.fonts.ready);
      let pieces = 0;
      for (let screen = 0; screen < 40; screen++) {
        const readings = await read(page);
        pieces += readings.length;
        const hard = readings.filter((r) => r.ratio < (r.large ? 3 : 4.5)).map((r) => `"${r.text}" ${r.ratio}:1 at ${r.size}px`);
        expect(hard, `${name}, screen ${screen + 1}: text that is hard to read`).toEqual([]);
        expect(readings.filter((r) => r.faded).map((r) => r.text), `${name}, screen ${screen + 1}: text dimmed with opacity`).toEqual([]);
        const more = await page.evaluate(() => {
          const before = scrollY;
          scrollBy(0, Math.floor(innerHeight * 0.85));
          return scrollY > before;
        });
        if (!more) break;
      }
      expect(pieces, `${name}: text found`).toBeGreaterThan(20);
    };

    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      test(`privacy, terms and the landing page are easy to read from top to bottom on a ${width}×${height} screen`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        for (const path of ['/privacy', '/terms', '/home']) {
          await page.goto(path);
          await readable(page, `${path} at ${width}`);
          // Nothing runs off the side.
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `${path}: sideways scroll`).toBe(false);
        }

        // Two places by name. The landing page's last line, which gained its two links...
        await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
        const footer = (await read(page)).filter((r) => ['koyomi.guru', 'Privacy', 'Terms'].includes(r.text));
        expect(footer.map((r) => r.text).sort()).toEqual(['Privacy', 'Terms', 'koyomi.guru']);
        expect(footer.filter((r) => r.ratio < 4.5 || r.faded).map((r) => `"${r.text}" ${r.ratio}:1`)).toEqual([]);

        // ...and the sample week's times. The one on Sunday sits on a tinted event in the shaded
        // weekend, and at night it used to be 4.3:1.
        if (width >= 680) {
          await page.getByRole('region', { name: 'A sample week' }).scrollIntoViewIfNeeded();
          const times = (await read(page)).filter((r) => /^\d\d:\d\d$/.test(r.text));
          expect(times.map((r) => r.text)).toContain('18:00');
          expect(times.filter((r) => r.ratio < 4.5).map((r) => `"${r.text}" ${r.ratio}:1`)).toEqual([]);
        }
      });
    }
  });
}

test.describe('host names', () => {
  // Only the Host header tells the two sites apart, so that is all these requests change.
  const get = (request: APIRequestContext, host: string, path: string) => request.get(path, { headers: { host }, maxRedirects: 0 });
  // Something only the landing page says. (Its headline is also in the calendar's own description.)
  const LANDING = 'The ones you already have.';

  test('koyomi.guru shows the landing page at /', async ({ request }) => {
    const response = await get(request, 'koyomi.guru', '/');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(LANDING);
    expect(html).not.toContain('rel="manifest"');
  });

  test('app.koyomi.guru, and any other host, shows the calendar at /', async ({ request }) => {
    // The last two only look like the site's host.
    for (const host of ['app.koyomi.guru', 'kayomi-guru.vercel.app', 'notkoyomi.guru', 'koyomi.guru.example.com']) {
      const response = await get(request, host, '/');
      expect(response.status(), host).toBe(200);
      const html = await response.text();
      expect(html, host).not.toContain(LANDING);
      expect(html, host).toContain('rel="manifest"');
    }
  });

  test('www.koyomi.guru shows the landing page too; the code never redirects one to the other', async ({ request }) => {
    // Which of the two is the main address is set in Vercel. A redirect here as well once sent
    // visitors round in a loop, so both hosts must simply answer.
    for (const host of ['koyomi.guru', 'www.koyomi.guru']) {
      for (const path of ['/', '/anything']) {
        const response = await get(request, host, path);
        expect(response.headers().location, `${host}${path}`).toBeUndefined();
      }
      const home = await get(request, host, '/');
      expect(home.status(), host).toBe(200);
      expect(await home.text(), host).toContain(LANDING);
    }
  });

  test('/open goes to app.koyomi.guru from the site, and to / anywhere else', async ({ request }) => {
    for (const host of ['koyomi.guru', 'www.koyomi.guru']) {
      const fromSite = await get(request, host, '/open');
      expect([fromSite.status(), fromSite.headers().location], host).toEqual([307, 'https://app.koyomi.guru/']);
    }
    const elsewhere = await get(request, 'kayomi-guru.vercel.app', '/open');
    expect([elsewhere.status(), elsewhere.headers().location]).toEqual([307, '/']);
  });

  test('privacy and terms are pages of koyomi.guru, and the calendar’s host sends them there', async ({ request }) => {
    for (const [path, title] of [
      ['/privacy', 'Privacy'],
      ['/terms', 'Terms'],
    ]) {
      for (const host of ['koyomi.guru', 'www.koyomi.guru']) {
        const onSite = await get(request, host, path);
        expect([onSite.status(), onSite.headers().location], `${host}${path}`).toEqual([200, undefined]);
        const html = await onSite.text();
        expect(html, `${host}${path}`).toContain(`<title>${title} — Koyomi</title>`);
        expect(html, `${host}${path}`).toContain(`<link rel="canonical" href="https://koyomi.guru${path}"`);
        expect(html, `${host}${path}`).not.toContain('rel="manifest"');
      }
      // One canonical place: asked of the calendar's host, the page is on the site.
      const onApp = await get(request, 'app.koyomi.guru', path);
      expect([onApp.status(), onApp.headers().location], `app.koyomi.guru${path}`).toEqual([308, `https://koyomi.guru${path}`]);
      // A host with no domain of its own, and one that only looks like the calendar's, serve it.
      for (const host of ['kayomi-guru.vercel.app', 'notapp.koyomi.guru']) {
        const elsewhere = await get(request, host, path);
        expect([elsewhere.status(), elsewhere.headers().location], `${host}${path}`).toEqual([200, undefined]);
        expect(await elsewhere.text(), `${host}${path}`).toContain(`<title>${title} — Koyomi</title>`);
      }
    }
  });

  test('/home is only an address on hosts that have no domain of their own', async ({ request }) => {
    for (const host of ['koyomi.guru', 'www.koyomi.guru']) {
      const onSite = await get(request, host, '/home');
      expect([onSite.status(), onSite.headers().location], host).toEqual([308, '/']);
    }
    const onApp = await get(request, 'app.koyomi.guru', '/home');
    expect([onApp.status(), onApp.headers().location]).toEqual([308, 'https://koyomi.guru/']);
    const elsewhere = await get(request, 'kayomi-guru.vercel.app', '/home');
    expect(elsewhere.status()).toBe(200);
    expect(await elsewhere.text()).toContain(LANDING);
  });
});
