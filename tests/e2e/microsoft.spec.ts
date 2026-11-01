import { expect, type Page } from '@playwright/test';
import {
  FAKE,
  ME,
  addAt,
  addButton,
  allDay,
  cached,
  choice,
  closeDrawer,
  connect,
  connectMicrosoft,
  disconnectButton,
  everythingStored,
  external,
  google,
  graphTime,
  group,
  microsoft,
  nothingConnected,
  openCalendars,
  pickMicrosoft,
  refresh,
  start,
  test,
  toggle,
  view,
} from './connected';
import { event, open, popover, reload, seed, stored } from './helpers';

// Microsoft accounts, beside Google's and beside each other: personal and work or school, read
// only, each its own connection. Everything runs against the stand-in for Microsoft's identity
// platform and Microsoft Graph (tests/fakes/providers.mjs); no real account is involved.

const APP = 'http://localhost:4310';
/** The two Microsoft accounts' addresses: the owners of their own calendars. */
const PAT = 'pat@outlook.test';
const WORKER = 'pat@contoso.test';
const BACK = { timeout: 15_000 };
test.describe.configure({ timeout: 90_000 });

/**
 * An event as Graph sends it, with what Koyomi does not ask for beside it, which the stand-in
 * leaves out unless it is asked for, as Graph does.
 */
const msEvent = (id: string, subject: string, day: string, from: string, to: string, over: Record<string, unknown> = {}) => ({
  id,
  subject,
  start: { dateTime: graphTime(day, from), timeZone: 'UTC' },
  end: { dateTime: graphTime(day, to), timeZone: 'UTC' },
  originalStartTimeZone: 'Turkey Standard Time',
  webLink: `https://outlook.live.com/owa/?itemid=${id}&exvsurl=1&path=/calendar/item`,
  showAs: 'busy',
  responseStatus: { response: 'organizer' },
  type: 'singleInstance',
  // Never to reach the browser, nor even be asked for.
  bodyPreview: 'PRIVATE NOTES',
  body: { content: 'PRIVATE BODY' },
  location: { displayName: 'PRIVATE PLACE' },
  attendees: [{ emailAddress: { address: 'someone@private.test' } }],
  onlineMeeting: { joinUrl: 'https://teams.example/PRIVATE' },
  ...over,
});
/** An all-day event written in Istanbul: Graph gives its midnights in UTC, at 21:00 the day before. */
const msAllDay = (id: string, subject: string, first: string, after: string) => ({
  id,
  subject,
  isAllDay: true,
  originalStartTimeZone: 'Turkey Standard Time',
  start: { dateTime: graphTime(first, '00:00'), timeZone: 'UTC' },
  end: { dateTime: graphTime(after, '00:00'), timeZone: 'UTC' },
  showAs: 'free',
  type: 'singleInstance',
});

/** A personal Microsoft account: its own calendar, a family one, birthdays it cannot change, and one someone else shared with it. */
const personal = () => ({
  kind: 'personal',
  address: PAT,
  calendars: [
    {
      id: 'AAMkADefault=',
      name: 'Calendar',
      isDefaultCalendar: true,
      events: [
        msEvent('standup', 'Standup', '2026-10-07', '10:00', '10:15'),
        // One repeating meeting, as Graph hands it over: an occurrence for each time it happens.
        msEvent('one-1', 'Weekly 1:1', '2026-10-07', '15:30', '16:00', { type: 'occurrence', seriesMasterId: 'series-1' }),
        msEvent('one-2', 'Weekly 1:1', '2026-10-14', '15:30', '16:00', { type: 'occurrence', seriesMasterId: 'series-1' }),
        msEvent('maybe', 'Maybe lunch', '2026-10-08', '12:00', '13:00', { responseStatus: { response: 'tentativelyAccepted' }, showAs: 'tentative' }),
        msEvent('declined', 'Declined sync', '2026-10-07', '11:00', '12:00', { responseStatus: { response: 'declined' } }),
        msEvent('cancelled', 'Cancelled call', '2026-10-07', '13:00', '14:00', { isCancelled: true }),
        msAllDay('holiday', 'Republic Day', '2026-10-09', '2026-10-10'),
      ],
    },
    { id: 'AAMkFamily=', name: 'Family', events: [msEvent('dinner', 'Family dinner', '2026-10-08', '19:00', '21:00')] },
    { id: 'AAMkBirthdays=', name: 'Birthdays', canEdit: false, events: [msAllDay('bday', 'Sam’s birthday', '2026-10-10', '2026-10-11')] },
    { id: 'AAMkShared=', name: 'Alex’s calendar', canEdit: false, owner: { name: 'Alex', address: 'alex@example.test' }, events: [msEvent('alex', 'Alex private', '2026-10-07', '09:00', '10:00')] },
  ],
});
/** A work or school account, in an organisation's tenant. */
const work = () => ({
  kind: 'work',
  address: WORKER,
  calendars: [
    { id: 'AAMkWorkDefault=', name: 'Calendar', isDefaultCalendar: true, events: [msEvent('board', 'Board review', '2026-10-07', '14:00', '15:00', { webLink: 'https://outlook.office365.com/owa/?itemid=board&exvsurl=1&path=/calendar/item' })] },
    { id: 'AAMkProjects=', name: 'Projects', events: [msEvent('launch', 'Launch prep', '2026-10-09', '11:00', '12:00')] },
  ],
});
/**
 * A Microsoft account whose calendars and events have the very ids the Google account's have
 * (tests/e2e/connected.ts), with different things in them.
 */
const lookalike = () => ({
  kind: 'personal',
  address: PAT,
  calendars: [
    { id: ME, name: 'Calendar', isDefaultCalendar: true, events: [msEvent('dentist', 'Osteopath', '2026-10-07', '17:00', '18:00')] },
    { id: 'work@example.test', name: 'Work', events: [msEvent('sync_1', 'Quarterly sync', '2026-10-07', '13:00', '14:00')] },
  ],
});

const PAT_EVENTS = ['Family dinner', 'Maybe lunch', 'Republic Day', 'Standup', 'Weekly 1:1', 'Weekly 1:1'];

/** This device's copy, account by account, by address and provider. */
async function copy(page: Page) {
  const { connections, calendars, events } = await cached(page);
  return Object.fromEntries(
    connections.map((connection) => [
      `${connection.provider} ${connection.account}`,
      {
        status: connection.status,
        calendars: calendars.filter((c) => c.connectionId === connection.id).map((c) => `${c.name}${c.visible ? '' : ' (hidden)'}`).sort(),
        events: events.filter((e) => e.connectionId === connection.id).map((e) => e.title).sort(),
      },
    ]),
  );
}
/**
 * One account's part of the copy, to the letter. A Microsoft calendar is read whole every time,
 * so when it was read is left out of a Microsoft account's part: everything else must not change.
 */
const part = async (page: Page, provider: string, address: string) => {
  const { connections, events } = await cached(page);
  const { id } = connections.find((connection) => connection.provider === provider && connection.account === address);
  const mine = events.filter((e) => e.connectionId === id).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(provider === 'microsoft' ? mine.map(({ fetchedAt: _, updatedAt: __, ...rest }) => rest) : mine);
};
/** An event on the calendar whose title begins with these words: another account's "Sam: Standup" is not "Standup". */
const titled = (page: Page, title: string) => page.locator('[data-event]', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
const listed = async (page: Page) => ((await (await page.request.get('/api/calendars')).json()) as { connections: { connectionId: string; provider: string; account: string; state: string }[] }).connections;
/** What Koyomi asked Microsoft for, by kind. */
const kinds = async (account: string) => (await microsoft.asked(account)).log.map((entry) => entry.type);
const heading = (page: Page, name: string) => view(page).getByText(name, { exact: true });

test.describe('adding a Microsoft account', () => {
  test('Add calendar account offers Google and Microsoft; Microsoft asks which account, for reading calendars and nothing more', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await pickMicrosoft(page, pat);
    await start(page);
    await openCalendars(page);
    await expect(view(page)).toContainText('Koyomi can show your Google, Microsoft and Yahoo calendars beside your own, to read only.');

    // Pressing Add calendar account asks where, quietly, and nothing more.
    await expect(choice(page, 'Microsoft')).toHaveCount(0);
    await addButton(page).click();
    await expect(addButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(choice(page, 'Google')).toBeVisible();
    await expect(choice(page, 'Microsoft')).toBeVisible();
    await addButton(page).click();
    await expect(choice(page, 'Microsoft')).toHaveCount(0);
    await addAt(page, 'Microsoft');
    await expect(group(page, PAT)).toBeVisible(BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    expect(new URL(page.url()).search).toBe('');

    // Microsoft was asked to show its list of accounts, for exactly three things, with PKCE and a nonce.
    const consent = (await microsoft.asked(pat)).log.find((entry) => entry.type === 'consent')!;
    expect(consent).toMatchObject({
      client_id: 'microsoft-test',
      response_type: 'code',
      response_mode: 'query',
      redirect_uri: `${APP}/api/microsoft/callback`,
      scope: 'openid offline_access https://graph.microsoft.com/Calendars.Read',
      prompt: 'select_account',
      code_challenge_method: 'S256',
    });
    expect(Buffer.from(consent.nonce!, 'base64url')).toHaveLength(16);
    expect((await microsoft.asked(pat)).log.find((entry) => entry.type === 'grant')).toMatchObject({ pkce: 'verified', redirect_uri: `${APP}/api/microsoft/callback`, asked: consent.scope });

    // Under its own heading and address: its own calendars, its own first; the shared one is not there.
    await expect(heading(page, 'MICROSOFT')).toBeVisible();
    await expect(heading(page, 'GOOGLE')).toHaveCount(0);
    await expect(group(page, PAT).getByRole('switch')).toHaveText(['Calendar✓', 'Birthdays', 'Family✓']);
    await expect(view(page).getByText('Alex’s calendar')).toHaveCount(0);
    await expect(disconnectButton(page, PAT)).toHaveAccessibleName(`Disconnect ${PAT}`);
    await expect(view(page)).toContainText('Read only. Koyomi never changes your Microsoft calendar.');

    // Graph was asked only for those fields, in UTC, for the span, and only for the calendars shown,
    // every page of each.
    const log = (await microsoft.asked(pat)).log;
    expect([...new Set(log.filter((entry) => entry.type === 'calendars').map((entry) => entry.select))]).toEqual(['id,name,isDefaultCalendar,canEdit,owner']);
    expect(log.filter((entry) => entry.type === 'calendars').map((entry) => entry.skip)).toContain(2);
    const reads = log.filter((entry) => entry.type === 'events');
    expect([...new Set(reads.map((entry) => entry.calendarId))].sort()).toEqual(['AAMkADefault=', 'AAMkFamily=']);
    for (const entry of reads) {
      expect(entry.select).toBe('id,subject,start,end,isAllDay,isCancelled,showAs,responseStatus,webLink,type,originalStartTimeZone');
      expect(entry.prefer).toBe('outlook.timezone="UTC"');
      expect(entry.top).toBe('500');
    }

    // On the server: one Microsoft connection, named by its address only on its way to this browser.
    expect((await listed(page)).map((entry) => [entry.provider, entry.account, entry.state])).toEqual([['microsoft', PAT, 'ok']]);
    // On the device: what Koyomi shows, and nothing it does not, and no credential of any kind.
    expect(await copy(page)).toEqual({ [`microsoft ${PAT}`]: { status: 'connected', calendars: ['Birthdays (hidden)', 'Calendar', 'Family'], events: PAT_EVENTS } });
    const everything = await everythingStored(page);
    for (const secret of ['PRIVATE', 'someone@private.test', 'teams.example', 'mrt.', 'mat.', 'eyJ', 'v1.', 'Alex private', 'alex@example.test']) expect(everything, secret).not.toContain(secret);
  });

  test('its timed, all-day and repeating events are on the calendar where they belong, read only', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    await closeDrawer(page);

    // Wednesday 7 October in Istanbul: the stand-up at ten, the first one-to-one at half past three.
    const wednesday = page.locator('[data-day="2026-10-07"]');
    await expect(wednesday.locator(external(page, 'Standup'))).toBeVisible();
    await expect(wednesday.locator(external(page, 'Weekly 1:1'))).toBeVisible();
    // Written in Istanbul, given in UTC as the evening before: it is on the Friday, all day.
    await expect(allDay(page, 'Republic Day')).toBeVisible();
    expect((await cached(page)).events.find((e) => e.title === 'Republic Day')).toMatchObject({ start: '2026-10-09', end: '2026-10-09', allDay: true });
    // Cancelled, declined, hidden and someone else's: not there.
    for (const title of ['Cancelled call', 'Declined sync', 'Sam’s birthday', 'Alex private']) await expect(event(page, title)).toHaveCount(0);

    // Looked at: what it is, when, and where it is from. Nothing to edit, delete or mark.
    await external(page, 'Standup').click();
    await expect(popover(page).locator('p')).toHaveText(['Standup', '10:00 – 10:15', `Microsoft · Calendar${PAT}`]);
    await expect(popover(page).getByRole('link', { name: 'Open in Outlook' })).toHaveAttribute('href', 'https://outlook.live.com/owa/?itemid=standup&exvsurl=1&path=/calendar/item');
    await expect(popover(page).getByRole('button')).toHaveCount(0);
    await expect(popover(page).getByText(/delete|edit|done|plan/i)).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The repeating meeting is each of its occurrences, the next one in next week.
    expect((await cached(page)).events.filter((e) => e.title === 'Weekly 1:1').map((e) => e.start).sort()).toEqual(['2026-10-07T12:30:00.000Z', '2026-10-14T12:30:00.000Z']);
    // Tentative is said so, as it is for Google.
    expect((await cached(page)).events.find((e) => e.title === 'Maybe lunch')!.status).toBe('tentative');
  });

  test.describe('on a device in New York', () => {
    test.use({ timezoneId: 'America/New_York' });
    test('the same events are at New York’s times, and the all-day one is on the same day', async ({ page, id }) => {
      const pat = `${id}m`;
      await microsoft.has(pat, personal());
      await start(page);
      await connectMicrosoft(page, pat, PAT);
      await closeDrawer(page);
      await external(page, 'Standup').click();
      // Ten in Istanbul is three in the morning in New York.
      await expect(popover(page).locator('p').nth(1)).toHaveText('03:00 – 03:15');
      await page.keyboard.press('Escape');
      await expect(allDay(page, 'Republic Day')).toBeVisible();
      expect((await cached(page)).events.find((e) => e.title === 'Republic Day')).toMatchObject({ start: '2026-10-09', end: '2026-10-09', allDay: true });
    });
  });

  test('a work or school account connects the same way, beside a personal one, and is an account of its own', async ({ page, id }) => {
    const pat = `${id}m`;
    const worker = `${id}w`;
    await microsoft.has(pat, personal());
    await microsoft.has(worker, work());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    const before = await part(page, 'microsoft', PAT);
    await connectMicrosoft(page, worker, WORKER);

    await expect(heading(page, 'MICROSOFT')).toHaveCount(1);
    await expect(view(page).getByRole('group')).toHaveCount(2);
    await expect(group(page, WORKER).getByRole('switch')).toHaveText(['Calendar✓', 'Projects✓']);
    // Two tenants, two connections; the first is exactly as it was.
    expect((await microsoft.asked(worker)).kind).toBe('work');
    expect((await microsoft.asked(worker)).tenant).not.toBe((await microsoft.asked(pat)).tenant);
    const now = await listed(page);
    expect(now.map((entry) => [entry.provider, entry.account])).toEqual([['microsoft', PAT], ['microsoft', WORKER]]);
    expect(now[0].connectionId).not.toBe(now[1].connectionId);
    expect(await part(page, 'microsoft', PAT)).toBe(before);
    expect((await microsoft.asked(worker)).log.find((entry) => entry.type === 'consent')!.prompt).toBe('select_account');
    // Microsoft wrote this tenant's grant with the resource's address in it: it was understood all the same.
    expect((await microsoft.asked(worker)).log.find((entry) => entry.type === 'grant')!.scope).toContain('https://graph.microsoft.com/Calendars.Read');
    await closeDrawer(page);
    await external(page, 'Board review').click();
    await expect(popover(page).locator('p').nth(2)).toHaveText(`Microsoft · Calendar${WORKER}`);
    await expect(popover(page).getByRole('link', { name: 'Open in Outlook' })).toHaveAttribute('href', /^https:\/\/outlook\.office365\.com\//);
  });

  test('a device that shows no account yet, choosing Microsoft, goes to Microsoft even where Google accounts are connected', async ({ page, browser, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connect(page);

    // The same person on a new device: it shows no account, so it does not say it is adding one.
    const fresh = await browser.newContext({ timezoneId: 'Europe/Istanbul' });
    await fresh.addCookies([
      { name: 'fake_user', value: `user-${id}`, url: FAKE },
      { name: 'fake_google', value: id, url: FAKE },
      { name: 'fake_microsoft', value: pat, url: FAKE },
    ]);
    const device = await fresh.newPage();
    await start(device);
    await openCalendars(device);
    await addAt(device, 'Microsoft');
    // To Microsoft, not merely home to read the Google account; and both are there.
    await expect(group(device, PAT)).toBeVisible(BACK);
    await expect(group(device, ME)).toBeVisible(BACK);
    expect((await microsoft.asked(pat)).log.filter((entry) => entry.type === 'consent')).toHaveLength(1);
    await fresh.close();
  });

  test('the same Microsoft account chosen again is the same connection, with its new token, not a second one', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    const [first] = await listed(page);
    await addAt(page, 'Microsoft');
    await expect(view(page).getByText(/^Read \d/)).toBeVisible(BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(view(page).getByRole('group')).toHaveCount(1);
    expect((await listed(page)).map((entry) => entry.connectionId)).toEqual([first.connectionId]);
    expect((await microsoft.asked(pat)).log.filter((entry) => entry.type === 'grant')).toHaveLength(2);
  });

  test('cancelling, an organisation that must approve first, its approval, or a sign-in without the calendar permission connects nothing, and says so', async ({ page, context, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    for (const [who, said] of [
      [`deny:${pat}`, 'Microsoft calendar was not connected.'],
      [`admin:${pat}`, 'Your organisation’s Microsoft administrator needs to approve Koyomi first.'],
      [`partial:${pat}`, 'Koyomi needs permission to read your calendars, so nothing was connected.'],
    ]) {
      await context.addCookies([{ name: 'fake_microsoft', value: who, url: FAKE }]);
      await openCalendars(page);
      await addAt(page, 'Microsoft');
      await expect(view(page).getByRole('status')).toHaveText(said, BACK);
      await expect(nothingConnected(page)).toBeVisible();
    }
    // An administrator back from approving Koyomi for everyone there, by Microsoft's admin consent
    // link: it is said, and nobody was connected by it.
    await page.goto('/api/microsoft/callback?admin_consent=True&tenant=00000000-0000-0000-0000-000000000001&scope=openid');
    await expect(view(page).getByRole('status')).toHaveText('Koyomi is approved for your organisation. Its people can now add their Microsoft calendars.', BACK);
    await expect(nothingConnected(page)).toBeVisible();
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();
    expect(await (await page.request.get('/api/calendars')).json()).toEqual({ connections: [] });
    expect(await kinds(pat)).toEqual(['consent', 'consent', 'consent', 'grant']);
  });
});

test.describe('reading a Microsoft account', () => {
  test('showing and hiding one calendar reads that calendar alone, and keeps nothing of a hidden one', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    const asked = (await microsoft.asked(pat)).log.length;

    await toggle(page, 'Birthdays', PAT).click();
    await expect(toggle(page, 'Birthdays', PAT)).toHaveAttribute('aria-checked', 'true');
    await expect(allDay(page, 'Sam’s birthday')).toBeVisible(BACK);
    const since = (await microsoft.asked(pat)).log.slice(asked);
    expect(since.map((entry) => `${entry.type} ${entry.calendarId ?? ''}`.trim())).toEqual(['events AAMkBirthdays=']);

    await toggle(page, 'Family', PAT).click();
    await expect(toggle(page, 'Family', PAT)).toHaveAttribute('aria-checked', 'false');
    await expect(event(page, 'Family dinner')).toHaveCount(0);
    expect((await copy(page))[`microsoft ${PAT}`].events).not.toContain('Family dinner');
    await reload(page);
    await expect(event(page, 'Family dinner')).toHaveCount(0);
    await expect(allDay(page, 'Sam’s birthday')).toBeVisible();
  });

  test('a refresh reads each shown calendar whole, every page of it, and what changed at Microsoft is what is shown', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    // Added, renamed and removed at Microsoft.
    await microsoft.changes(pat, {
      calendarId: 'AAMkADefault=',
      upsert: [msEvent('standup', 'Standup (moved)', '2026-10-07', '10:30', '10:45'), msEvent('new', 'New planning', '2026-10-08', '09:00', '10:00')],
      cancel: ['maybe'],
    });
    await refresh(page);
    expect((await copy(page))[`microsoft ${PAT}`].events).toEqual(['Family dinner', 'New planning', 'Republic Day', 'Standup (moved)', 'Weekly 1:1', 'Weekly 1:1']);
    // Seven events in the account's own calendar, three a page: all three pages were read.
    const pages = (await microsoft.asked(pat)).log.filter((entry) => entry.type === 'events' && entry.calendarId === 'AAMkADefault=').slice(-3);
    expect(pages.map((entry) => entry.skip)).toEqual([0, 3, 6]);
  });

  test('read again with no network: everything that was read is there, and Refresh says it is offline', async ({ page, context, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    await closeDrawer(page);
    await page.evaluate(async () => void (await navigator.serviceWorker.ready));
    await context.setOffline(true);
    await reload(page);
    for (const title of ['Standup', 'Weekly 1:1', 'Maybe lunch']) await expect(external(page, title).first()).toBeVisible();
    await expect(allDay(page, 'Republic Day')).toBeVisible();
    await openCalendars(page);
    await expect(group(page, PAT).getByRole('switch')).toHaveCount(3);
    await refresh(page);
    await expect(view(page).getByRole('status')).toHaveText('You seem to be offline, so your calendars couldn’t be read. Try again once you’re back online.');
    await expect(page.getByText(/reconnect|sign in/i)).toHaveCount(0);
    await context.setOffline(false);
  });

  test('a permission withdrawn at Microsoft is said of that account; what was read stays; reconnecting mends it in place', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    const [first] = await listed(page);
    await microsoft.becomes(pat, { revoked: true });
    await refresh(page);
    // At once: the access token is refused, a new one is asked for, and that is refused too.
    await expect(group(page, PAT)).toContainText('Needs reconnecting');
    await closeDrawer(page);
    await expect(external(page, 'Standup')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Microsoft calendar needs reconnecting' })).toBeVisible();

    await microsoft.changes(pat, { calendarId: 'AAMkADefault=', cancel: ['standup'] });
    await page.getByRole('button', { name: 'Microsoft calendar needs reconnecting' }).click();
    // Reconnect goes straight to Microsoft, for this account: no choice of provider is asked.
    await group(page, PAT).getByRole('button', { name: 'Reconnect' }).click();
    await expect(view(page).getByText(/^Read \d/)).toBeVisible(BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(page.getByText(/needs reconnecting/i)).toHaveCount(0);
    await expect(event(page, 'Standup')).toHaveCount(0);
    expect((await listed(page)).map((entry) => [entry.connectionId, entry.state])).toEqual([[first.connectionId, 'ok']]);
  });

  test('Microsoft down, or asking to wait, keeps what was read and Refresh says so; while it waits it is not asked again', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    const kept = await part(page, 'microsoft', PAT);
    for (const fail of ['unavailable', 'throttled'] as const) {
      await microsoft.becomes(pat, { fail });
      await refresh(page);
      await expect(view(page).getByRole('status')).toHaveText(`Couldn’t read ${PAT} just now. Try again in a moment.`);
      await expect(page.getByText(/reconnect|doesn’t let/i)).toHaveCount(0);
      expect(await part(page, 'microsoft', PAT)).toBe(kept);
    }
    // Asked to wait thirty seconds: Microsoft is left alone until then, however often Refresh is pressed.
    await microsoft.becomes(pat, { fail: null });
    const asked = (await microsoft.asked(pat)).log.length;
    await refresh(page);
    await refresh(page);
    expect((await microsoft.asked(pat)).log.length).toBe(asked);
    expect(await part(page, 'microsoft', PAT)).toBe(kept);
  });

  test('an account Microsoft will not let be read says so of itself, with nothing to reconnect', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    await microsoft.becomes(pat, { fail: 'nomailbox' });
    await refresh(page);
    await expect(group(page, PAT)).toContainText('Microsoft doesn’t let Koyomi read this account’s calendar.');
    await expect(group(page, PAT).getByRole('button', { name: /Reconnect/ })).toHaveCount(0);
    await expect(disconnectButton(page, PAT)).toBeVisible();
    // What was read before is still there, and it is not the reconnecting kind of trouble.
    await expect(external(page, 'Standup')).toBeVisible();
    await closeDrawer(page);
    await expect(page.getByRole('button', { name: /needs reconnecting/ })).toHaveCount(0);
    await microsoft.becomes(pat, { fail: null });
    await refresh(page);
    await expect(group(page, PAT)).not.toContainText('doesn’t let');
  });

  test('one calendar that may not be read is passed over; the others are read as usual', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    await microsoft.becomes(pat, { deny: 'AAMkFamily=' });
    await microsoft.changes(pat, { calendarId: 'AAMkADefault=', cancel: ['standup'] });
    await microsoft.changes(pat, { calendarId: 'AAMkFamily=', cancel: ['dinner'] });
    await refresh(page);
    // The calendar it may read is up to date. The one it may not keeps what was read of it.
    await expect(event(page, 'Standup')).toHaveCount(0);
    await expect(external(page, 'Family dinner')).toBeVisible();
    await expect(page.getByText(/reconnect|couldn’t|doesn’t let/i)).toHaveCount(0);
    await expect(toggle(page, 'Family', PAT)).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('several Microsoft accounts', () => {
  /** Two personal accounts, with calendars of the very same ids. */
  async function two(page: Page, id: string) {
    const a = `${id}a`;
    const b = `${id}b`;
    await microsoft.has(a, personal());
    await microsoft.has(b, { ...personal(), address: 'sam@outlook.test', calendars: personal().calendars.map((c) => ({ ...c, events: c.events.map((e) => ({ ...e, subject: `Sam: ${e.subject}` })) })) });
    await start(page);
    await connectMicrosoft(page, a, PAT);
    await connectMicrosoft(page, b, 'sam@outlook.test');
    return { a, b };
  }

  test('two accounts with the same calendar and event ids are kept apart; one refreshed cannot alter the other', async ({ page, id }) => {
    const { a, b } = await two(page, id);
    expect(Object.keys(await copy(page)).sort()).toEqual([`microsoft ${PAT}`, 'microsoft sam@outlook.test']);
    expect((await copy(page))['microsoft sam@outlook.test'].events).toEqual(PAT_EVENTS.map((title) => `Sam: ${title}`).sort());
    const sams = await part(page, 'microsoft', 'sam@outlook.test');
    // Hidden in one account, the calendar of that id is still shown in the other.
    await toggle(page, 'Family', PAT).click();
    await expect(titled(page, 'Family dinner')).toHaveCount(0);
    await expect(external(page, 'Sam: Family dinner')).toBeVisible();
    // A change in the first account, refreshed, lands in the first account alone.
    await microsoft.changes(a, { calendarId: 'AAMkADefault=', cancel: ['standup'] });
    await refresh(page);
    await expect(titled(page, 'Standup')).toHaveCount(0);
    await expect(external(page, 'Sam: Standup')).toBeVisible();
    expect(await part(page, 'microsoft', 'sam@outlook.test')).toBe(sams);
    // And one failing does not stop the other being read.
    await microsoft.becomes(a, { fail: 'unavailable' });
    await microsoft.changes(b, { calendarId: 'AAMkADefault=', cancel: ['maybe'] });
    await refresh(page);
    await expect(event(page, 'Sam: Maybe lunch')).toHaveCount(0);
    await expect(titled(page, 'Maybe lunch')).toHaveCount(1);
  });

  test('disconnecting one leaves the other; reconnecting one leaves the other', async ({ page, context, id }) => {
    const { a, b } = await two(page, id);
    const sams = await part(page, 'microsoft', 'sam@outlook.test');
    const [, second] = await listed(page);

    // Reconnect the first: only it goes back to Microsoft.
    await microsoft.becomes(a, { revoked: true });
    await refresh(page);
    await expect(group(page, PAT)).toContainText('Needs reconnecting');
    await expect(group(page, 'sam@outlook.test')).not.toContainText('Needs reconnecting');
    await pickMicrosoft(page, a);
    await group(page, PAT).getByRole('button', { name: 'Reconnect' }).click();
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(page.getByText(/needs reconnecting/i)).toHaveCount(0, BACK);
    expect(await part(page, 'microsoft', 'sam@outlook.test')).toBe(sams);
    expect((await microsoft.asked(b)).log.filter((entry) => entry.type === 'consent')).toHaveLength(1);

    // Disconnect the first: Koyomi's token for it is gone; Microsoft has no way for an app to
    // hand a permission back, so it is not asked to.
    const answer = page.waitForResponse((response) => response.url().endsWith('/api/calendars/disconnect'));
    await disconnectButton(page, PAT).click();
    expect(await (await answer).json()).toEqual({ ok: true, revoked: false, signedOut: false });
    await expect(group(page, PAT)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    expect(await kinds(a)).not.toContain('revoke');
    expect((await listed(page)).map((entry) => entry.connectionId)).toEqual([second.connectionId]);
    expect(Object.keys(await copy(page))).toEqual(['microsoft sam@outlook.test']);
    expect(await part(page, 'microsoft', 'sam@outlook.test')).toBe(sams);
    expect((await context.cookies()).some((cookie) => cookie.name === 'koyomi_session')).toBe(true);
    await expect(external(page, 'Sam: Standup')).toBeVisible();

    // The last one: nothing is left, and the device is signed out.
    await disconnectButton(page, 'sam@outlook.test').click();
    await expect(nothingConnected(page)).toBeVisible(BACK);
    await expect.poll(() => page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    expect((await context.cookies()).some((cookie) => cookie.name === 'koyomi_session')).toBe(false);
  });
});

test.describe('Google and Microsoft together', () => {
  const OWN = {
    events: [{ id: 'mine', title: 'My own event', start: '2026-10-07T14:00:00.000Z', end: '2026-10-07T15:00:00.000Z', allDay: false, category: 'work' as const, recurrence: null, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' }],
  };
  /** The Google account of tests/e2e/connected.ts, and a Microsoft one whose calendar and event ids are the same. */
  async function both(page: Page, id: string) {
    const pat = `${id}m`;
    await microsoft.has(pat, lookalike());
    await seed(page, OWN);
    await start(page);
    await connect(page);
    await connectMicrosoft(page, pat, PAT);
    return pat;
  }

  test('are listed under their providers, and the same ids at each are two calendars and two events', async ({ page, id }) => {
    await both(page, id);
    await expect(heading(page, 'GOOGLE')).toBeVisible();
    await expect(heading(page, 'MICROSOFT')).toBeVisible();
    await expect(group(page, ME).getByRole('switch')).toHaveText(['Personal✓', 'Holidays', 'Work✓']);
    await expect(group(page, PAT).getByRole('switch')).toHaveText(['Calendar✓', 'Work✓']);
    await expect(view(page)).toContainText('Read only. Koyomi never changes your calendars.');
    // The address a copy of the app from before Microsoft used lists only what that copy knows how to show.
    expect((await listed(page)).map((entry) => entry.provider)).toEqual(['google', 'microsoft']);
    expect(((await (await page.request.get('/api/google/calendars')).json()) as { connections: { provider: string }[] }).connections.map((entry) => entry.provider)).toEqual(['google']);
    expect(await copy(page)).toEqual({
      [`google ${ME}`]: { status: 'connected', calendars: ['Holidays (hidden)', 'Personal', 'Work'], events: ['Dentist', 'Mum’s birthday', 'Trip to Izmir', 'Weekly sync', 'Weekly sync'] },
      [`microsoft ${PAT}`]: { status: 'connected', calendars: ['Calendar', 'Work'], events: ['Osteopath', 'Quarterly sync'] },
    });
    // The same calendar id, at two providers: hidden at one, still shown at the other.
    await toggle(page, 'Work', ME).click();
    await expect(event(page, 'Weekly sync')).toHaveCount(0);
    await expect(external(page, 'Quarterly sync')).toBeVisible();
    await closeDrawer(page);
    await external(page, 'Osteopath').click();
    await expect(popover(page).locator('p').nth(2)).toHaveText(`Microsoft · Calendar${PAT}`);
    await page.keyboard.press('Escape');
    await external(page, 'Dentist').click();
    await expect(popover(page).locator('p').nth(2)).toHaveText(`Google Calendar · Personal${ME}`);
  });

  test('a refresh at one provider cannot alter the other’s; one in trouble does not stop the other', async ({ page, id }) => {
    const pat = await both(page, id);
    const googles = await part(page, 'google', ME);
    const microsofts = await part(page, 'microsoft', PAT);
    // A change at Microsoft, under the id of Google's Dentist: it is Microsoft's Osteopath that goes.
    await microsoft.changes(pat, { calendarId: ME, cancel: ['dentist'] });
    await refresh(page);
    await expect(event(page, 'Osteopath')).toHaveCount(0);
    await expect(external(page, 'Dentist')).toBeVisible();
    expect(await part(page, 'google', ME)).toBe(googles);
    // And the other way round.
    const nowMicrosoft = await part(page, 'microsoft', PAT);
    await google.changes(id, { calendarId: 'work@example.test', cancel: ['sync_1'] });
    await refresh(page);
    await expect(external(page, 'Quarterly sync')).toBeVisible();
    expect(await part(page, 'microsoft', PAT)).toBe(nowMicrosoft);
    expect(microsofts).not.toBe(nowMicrosoft);
    // Google refusing its account is Google's account's trouble alone.
    await google.becomes(id, { revoked: true });
    await microsoft.changes(pat, { calendarId: 'work@example.test', upsert: [msEvent('extra', 'Extra review', '2026-10-08', '10:00', '11:00')] });
    await refresh(page);
    await expect(group(page, ME)).toContainText('Needs reconnecting');
    await expect(group(page, PAT)).not.toContainText('Needs reconnecting');
    await expect(external(page, 'Extra review')).toBeVisible();
    await closeDrawer(page);
    await expect(page.getByRole('button', { name: 'Google Calendar needs reconnecting' })).toBeVisible();
    // Microsoft refusing too: one line for both.
    await microsoft.becomes(pat, { revoked: true });
    await openCalendars(page);
    await refresh(page);
    await closeDrawer(page);
    await expect(page.getByRole('button', { name: 'Calendars need reconnecting' })).toBeVisible();
    await expect(event(page, 'My own event')).toBeVisible();
  });

  test('disconnecting either leaves the other, and Koyomi’s own calendar; offline, both are there', async ({ page, context, id }) => {
    const pat = await both(page, id);
    const own = JSON.stringify(await stored(page));
    const microsofts = await part(page, 'microsoft', PAT);

    // Offline: both providers' events, and Koyomi's own.
    await closeDrawer(page);
    await page.evaluate(async () => void (await navigator.serviceWorker.ready));
    await context.setOffline(true);
    await reload(page);
    for (const title of ['Dentist', 'Osteopath', 'Quarterly sync', 'My own event']) await expect(event(page, title).first()).toBeVisible();
    await context.setOffline(false);

    // Google disconnected: revoked at Google; Microsoft untouched, still read.
    await openCalendars(page);
    await disconnectButton(page, ME).click();
    await expect(group(page, ME)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    expect((await google.asked(id)).revoked).toBe(true);
    expect(await part(page, 'microsoft', PAT)).toBe(microsofts);
    await expect(heading(page, 'GOOGLE')).toHaveCount(0);
    await microsoft.changes(pat, { calendarId: ME, cancel: ['dentist'] });
    await refresh(page);
    await expect(event(page, 'Osteopath')).toHaveCount(0);

    // Google again, then Microsoft disconnected: Google untouched.
    await connect(page);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(external(page, 'Dentist')).toBeVisible(BACK);
    const googles = await part(page, 'google', ME);
    await disconnectButton(page, PAT).click();
    await expect(group(page, PAT)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    expect(await part(page, 'google', ME)).toBe(googles);
    expect((await listed(page)).map((entry) => entry.provider)).toEqual(['google']);
    await expect(external(page, 'Dentist')).toBeVisible();
    expect(JSON.stringify(await stored(page))).toBe(own);
  });
});

test.describe('while a Microsoft account is being read', () => {
  /** Presses Refresh with Microsoft keeping one account's events back, and returns once it has been asked. */
  async function holding(page: Page, account: string) {
    await openCalendars(page);
    await microsoft.becomes(account, { hold: 'events' });
    await view(page).getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(async () => (await microsoft.asked(account)).held, BACK).toBeGreaterThan(0);
  }

  test('a calendar hidden meanwhile stays hidden, with nothing of it kept', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connect(page);
    await connectMicrosoft(page, pat, PAT);
    await microsoft.changes(pat, { calendarId: 'AAMkFamily=', upsert: [msEvent('later', 'Family lunch', '2026-10-10', '12:00', '13:00')] });
    await holding(page, pat);
    await toggle(page, 'Family', PAT).click();
    await expect(toggle(page, 'Family', PAT)).toHaveAttribute('aria-checked', 'false');
    await microsoft.becomes(pat, { hold: null });
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(toggle(page, 'Family', PAT)).toHaveAttribute('aria-checked', 'false');
    for (const title of ['Family dinner', 'Family lunch']) await expect(event(page, title)).toHaveCount(0);
    expect((await copy(page))[`microsoft ${PAT}`].calendars).toContain('Family (hidden)');
    expect((await copy(page))[`microsoft ${PAT}`].events).not.toContain('Family lunch');
  });

  test('Disconnect in another tab meanwhile: the late answer brings nothing back, and Google is still read', async ({ page, context, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connect(page);
    await connectMicrosoft(page, pat, PAT);
    const elsewhere = await context.newPage();
    await elsewhere.clock.setFixedTime(new Date('2026-10-07T10:10:00Z'));
    await open(elsewhere);
    await openCalendars(elsewhere);
    await expect(group(elsewhere, PAT)).toBeVisible();

    await holding(page, pat);
    const answered = page.waitForResponse((response) => response.url().endsWith('/api/calendars/events') && response.request().postDataJSON()?.calendars?.[0]?.calendarId?.startsWith('AAMk'));
    await disconnectButton(elsewhere, PAT).click();
    await expect(group(elsewhere, PAT)).toHaveCount(0, BACK);
    await expect.poll(async () => Object.keys(await copy(elsewhere))).toEqual([`google ${ME}`]);

    await microsoft.becomes(pat, { hold: null });
    await (await answered).finished();
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await page.waitForTimeout(300);
    expect(Object.keys(await copy(page))).toEqual([`google ${ME}`]);
    await expect(titled(page, 'Standup')).toHaveCount(0);
    await expect(external(page, 'Dentist')).toBeVisible();
    await google.changes(id, { calendarId: ME, cancel: ['dentist'] });
    await refresh(page);
    await expect(event(page, 'Dentist')).toHaveCount(0);
    await elsewhere.close();
  });
});

test.describe('whose Microsoft connection it is', () => {
  /** The round trip to Microsoft, one step at a time, so each can be tampered with. */
  const flow = {
    async begin(page: Page) {
      // Adding: once one account is connected, a start without it would send the person home to read it.
      const response = await page.request.get('/api/microsoft/connect?add=1', { maxRedirects: 0 });
      const to = new URL(response.headers().location);
      return { to, state: to.searchParams.get('state')! };
    },
    async consent(page: Page, to: URL) {
      const back = new URL((await page.request.get(to.href, { maxRedirects: 0 })).headers().location);
      return { back, code: back.searchParams.get('code')! };
    },
    async finish(page: Page, back: URL | string) {
      const response = await page.request.get(String(back), { maxRedirects: 0 });
      const home = new URL(response.headers().location);
      expect(home.origin + home.pathname).toBe(`${APP}/`);
      return `${home.searchParams.get('calendars')} ${home.searchParams.get('from')}`;
    },
  };
  const exchanges = async (code: string) => (await (await fetch(`${FAKE}/__fake/exchanges?code=${encodeURIComponent(code)}`)).json()) as { code: string; refused: string | null }[];
  const signIn = async (page: Page) => {
    await page.goto('/api/auth/signin?returnTo=%2F');
    await expect(page.getByText('koyomi', { exact: true })).toBeVisible();
  };

  test('the round trip is sealed, Microsoft’s own, honoured once, for its state, its browser and its person', async ({ page, browser, context, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await pickMicrosoft(page, pat);
    await signIn(page);

    // Remembered in a sealed cookie on Microsoft's own paths, which page code cannot read.
    const first = await flow.begin(page);
    expect(first.to.origin + first.to.pathname).toBe(`${FAKE}/microsoft/common/oauth2/v2.0/authorize`);
    const cookie = (await context.cookies(`${APP}/api/microsoft/callback`)).find((c) => c.name === 'koyomi_microsoft_oauth')!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/microsoft' });
    expect(cookie.value).not.toContain(first.state);
    expect((await context.cookies(`${APP}/api/google/callback`)).some((c) => c.name === 'koyomi_microsoft_oauth')).toBe(false);

    // Wrong state: refused, never redeemed, and the attempt is spent.
    const wrong = await flow.consent(page, first.to);
    const forged = new URL(wrong.back);
    forged.searchParams.set('state', 'AAAAAAAAAAAAAAAAAAAAAA');
    expect(await flow.finish(page, forged)).toBe('failed microsoft');
    expect(await flow.finish(page, wrong.back)).toBe('failed microsoft');
    expect(await exchanges(wrong.code)).toEqual([]);

    // A Microsoft return brought to Google's address, with a Google attempt of its own under way, is no return at all.
    const crossed = await flow.consent(page, (await flow.begin(page)).to);
    await page.request.get('/api/google/connect', { maxRedirects: 0 });
    const atGoogle = new URL((await page.request.get(`${APP}/api/google/callback${crossed.back.search}`, { maxRedirects: 0 })).headers().location);
    expect(atGoogle.searchParams.get('calendars')).toBe('failed');
    expect(await exchanges(crossed.code)).toEqual([]);

    // Right: connected, once. The same address again does nothing.
    const right = await flow.consent(page, (await flow.begin(page)).to);
    expect(await flow.finish(page, right.back)).toBe('connected microsoft');
    expect(await flow.finish(page, right.back)).toBe('failed microsoft');
    expect(await exchanges(right.code)).toEqual([{ code: right.code, refused: null }]);

    // Someone else's browser, or someone else signed in since: refused.
    const again = await flow.consent(page, (await flow.begin(page)).to);
    const theirs = await browser.newContext();
    await theirs.addCookies([{ name: 'fake_user', value: `victim-${id}`, url: FAKE }]);
    const victim = await theirs.newPage();
    await signIn(victim);
    expect(await flow.finish(victim, again.back)).toBe('failed microsoft');
    expect(await (await victim.request.get('/api/calendars')).json()).toEqual({ connections: [] });
    await theirs.close();
    const later = await flow.consent(page, (await flow.begin(page)).to);
    await context.clearCookies({ name: 'koyomi_session' });
    await context.addCookies([{ name: 'fake_user', value: `someone-else-${id}`, url: FAKE }]);
    await signIn(page);
    expect(await flow.finish(page, later.back)).toBe('failed microsoft');
    expect(await exchanges(later.code)).toEqual([]);
    expect(await (await page.request.get('/api/calendars')).json()).toEqual({ connections: [] });
  });

  test('goes only to Microsoft and back only to the app, whatever the request says', async ({ page, id }) => {
    const location = async (path: string, headers?: Record<string, string>) => (await page.request.get(path, { maxRedirects: 0, headers })).headers().location;
    // Not signed in: to 6Away first, on the app's own address, to come back here.
    expect(await location('/api/microsoft/connect?returnTo=https://evil.example')).toBe(`${APP}/api/auth/signin?returnTo=${encodeURIComponent('/api/microsoft/connect?signed=1')}`);
    expect(await location('/api/microsoft/connect?add=1')).toBe(`${APP}/api/auth/signin?returnTo=${encodeURIComponent('/api/microsoft/connect?signed=1&add=1')}`);
    // Back from Microsoft, however the address is dressed up: home, with a word.
    expect(await location('/api/microsoft/callback?error=access_denied&redirect=https://evil.example', { host: 'evil.example' })).toBe(`${APP}/?calendars=cancelled&from=microsoft`);
    expect(await location('/api/microsoft/callback?code=x&state=y')).toBe(`${APP}/?calendars=failed&from=microsoft`);
    // Signed in: to Microsoft, with Koyomi's own redirect address and nothing the request said.
    await pickMicrosoft(page, `${id}m`);
    await page.goto('/api/auth/signin?returnTo=%2F');
    const to = new URL(await location('/api/microsoft/connect?redirect_uri=https://evil.example&scope=Mail.Read', { host: 'evil.example' }));
    expect(to.origin + to.pathname).toBe(`${FAKE}/microsoft/common/oauth2/v2.0/authorize`);
    expect(to.searchParams.get('redirect_uri')).toBe(`${APP}/api/microsoft/callback`);
    expect(to.searchParams.get('scope')).toBe('openid offline_access https://graph.microsoft.com/Calendars.Read');
  });

  test('a Microsoft connection can be used, read and ended only by the person who made it', async ({ page, browser, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    const [mine] = await listed(page);
    const ask = { connectionId: mine.connectionId, timeMin: '2026-10-01T00:00:00.000Z', timeMax: '2026-11-01T00:00:00.000Z', calendars: [{ calendarId: 'AAMkADefault=', syncToken: null }] };
    const headers = { origin: APP };
    expect((await page.request.post('/api/calendars/events', { data: ask, headers })).status()).toBe(200);
    // Malformed: refused before anything is looked up.
    for (const bad of [
      { ...ask, connectionId: 'microsoft' },
      { ...ask, connectionId: `${mine.connectionId} ` },
      { ...ask, calendars: [] },
      // Steps, not names: they would lead somewhere else at Graph.
      { ...ask, calendars: [{ calendarId: '..', syncToken: null }] },
      { ...ask, calendars: [{ calendarId: '.', syncToken: null }] },
    ]) {
      expect((await page.request.post('/api/calendars/events', { data: bad, headers })).status(), JSON.stringify(bad.calendars)).toBe(400);
    }
    expect((await page.request.post('/api/calendars/disconnect', { data: { connectionId: 'nope' }, headers })).status()).toBe(400);

    // Someone else, signed in as themselves, with the id in hand.
    const theirs = await browser.newContext();
    await theirs.addCookies([{ name: 'fake_user', value: `stranger-${id}`, url: FAKE }]);
    const stranger = await theirs.newPage();
    await stranger.goto('/api/auth/signin?returnTo=%2F');
    expect(await (await stranger.request.get('/api/calendars')).json()).toEqual({ connections: [] });
    const reached = await stranger.request.post('/api/calendars/events', { data: ask, headers });
    expect([reached.status(), await reached.json()]).toEqual([409, { error: 'not_connected' }]);
    expect(await (await stranger.request.post('/api/calendars/disconnect', { data: { connectionId: mine.connectionId }, headers })).json()).toEqual({ ok: true, revoked: false, signedOut: true });
    await theirs.close();
    // Nobody signed in at all.
    const nobody = await browser.newContext();
    expect((await nobody.request.get(`${APP}/api/calendars`)).status()).toBe(401);
    expect((await nobody.request.post(`${APP}/api/calendars/events`, { data: ask, headers })).status()).toBe(401);
    await nobody.close();
    // From another site: refused.
    expect((await page.request.post('/api/calendars/events', { data: ask, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
    // Still the owner's, and still working.
    expect((await page.request.post('/api/calendars/events', { data: ask, headers })).status()).toBe(200);
    expect((await listed(page)).map((entry) => entry.connectionId)).toEqual([mine.connectionId]);
  });

  test('the addresses Google’s connection used before answer as the new ones, and koyomi.guru names its Microsoft app', async ({ page }) => {
    const answers = async (path: string) => {
      const response = await page.request.get(path);
      return [response.status(), await response.json()];
    };
    expect(await answers('/api/google/calendars')).toEqual(await answers('/api/calendars'));
    expect((await page.request.post('/api/google/events', { data: {}, headers: { origin: APP } })).status()).toBe((await page.request.post('/api/calendars/events', { data: {}, headers: { origin: APP } })).status());
    const association = await page.request.get('/.well-known/microsoft-identity-association.json');
    expect(association.status()).toBe(200);
    expect(association.headers()['content-type']).toMatch(/^application\/json/);
    expect(await association.json()).toEqual({ associatedApplications: [{ applicationId: 'microsoft-test' }] });
  });
});

test.describe('Microsoft on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('the sheet offers the same two choices, and shows the account under its provider', async ({ page, id }) => {
    const pat = `${id}m`;
    await microsoft.has(pat, personal());
    await start(page);
    await connectMicrosoft(page, pat, PAT);
    await expect(heading(page, 'MICROSOFT')).toBeVisible();
    await expect(group(page, PAT).getByRole('switch')).toHaveText(['Calendar✓', 'Birthdays', 'Family✓']);
    await addButton(page).tap();
    for (const name of ['Google', 'Microsoft'] as const) {
      const box = (await choice(page, name).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

