import { expect, type Page } from '@playwright/test';
import {
  FAKE,
  ME,
  NOW,
  addAt,
  addButton,
  allDay,
  cached,
  choice,
  closeDrawer,
  connect,
  connectMicrosoft,
  connectYahoo,
  disconnectButton,
  everythingStored,
  external,
  google,
  graphTime,
  group,
  microsoft,
  nothingConnected,
  openCalendars,
  refresh,
  start,
  test,
  toggle,
  view,
  yahoo,
  yahooForm,
} from './connected';
import { event, open, popover, reload, seed, stored } from './helpers';

// Yahoo accounts, by CalDAV with an app password, beside Google's and Microsoft's and beside each
// other: read only, each its own connection, the app password kept on the server and nowhere
// else. Everything runs against the stand-in for Yahoo's CalDAV server (tests/fakes/providers.mjs).

const APP = 'http://localhost:4310';
const BACK = { timeout: 15_000 };
test.describe.configure({ timeout: 90_000 });

/** An app password as Yahoo makes them, and one the person may type wrongly. */
const PASSWORD = 'qwertyuiopasdfgh';
const WRONG = 'notthepasswordxx';
const ics = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yahoo//Calendar//EN', ...lines, 'END:VCALENDAR'].join('\r\n');
/** An event in Istanbul, with what Koyomi never keeps beside it, as Yahoo sends the whole object. */
const timed = (uid: string, title: string, day: string, from: string, to: string, ...more: string[]) => [
  'BEGIN:VEVENT',
  `UID:${uid}`,
  `SUMMARY:${title}`,
  `DTSTART;TZID=Europe/Istanbul:${day.replace(/-/g, '')}T${from.replace(':', '')}00`,
  `DTEND;TZID=Europe/Istanbul:${day.replace(/-/g, '')}T${to.replace(':', '')}00`,
  'DESCRIPTION:PRIVATE NOTES',
  'LOCATION:PRIVATE PLACE',
  'ORGANIZER;CN=Boss:mailto:boss@private.test',
  'ATTENDEE;PARTSTAT=ACCEPTED:mailto:someone@private.test',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:PRIVATE ALARM',
  'TRIGGER:-PT10M',
  'END:VALARM',
  ...more,
  'END:VEVENT',
];
const wholeDay = (uid: string, title: string, day: string, ...more: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, `DTSTART;VALUE=DATE:${day.replace(/-/g, '')}`, ...more, 'END:VEVENT'];

/**
 * A Yahoo account: a calendar of its own with a stand-up, a weekly one-to-one that began in 2025
 * (Yahoo only matches a span to a series by its first occurrence, so this is what the look back
 * is for) with next week's left out and the week after's moved, a holiday, a maybe and a
 * cancelled one; a family calendar; birthdays it cannot change; and a list of tasks.
 */
const account = (prefix = ''): Parameters<typeof yahoo.has>[1] => ({
  password: PASSWORD,
  calendars: [
    {
      id: 'Personal',
      name: 'Personal',
      objects: {
        standup: ics(...timed('standup', `${prefix}Standup`, '2026-10-07', '10:00', '10:15')),
        weekly: ics(
          ...timed('weekly', `${prefix}Weekly 1:1`, '2025-01-01', '15:30', '16:00', 'RRULE:FREQ=WEEKLY', 'EXDATE;TZID=Europe/Istanbul:20261014T153000'),
          ...timed('weekly', `${prefix}Weekly 1:1 (moved)`, '2026-10-21', '16:30', '17:00', 'RECURRENCE-ID;TZID=Europe/Istanbul:20261021T153000'),
        ),
        holiday: ics(...wholeDay('holiday', `${prefix}Republic Day`, '2026-10-09')),
        maybe: ics(...timed('maybe', `${prefix}Maybe lunch`, '2026-10-08', '12:00', '13:00', 'STATUS:TENTATIVE')),
        cancelled: ics(...timed('cancelled', `${prefix}Cancelled call`, '2026-10-07', '13:00', '14:00', 'STATUS:CANCELLED')),
      },
    },
    { id: 'Family', name: 'Family', objects: { dinner: ics(...timed('dinner', `${prefix}Family dinner`, '2026-10-08', '19:00', '21:00')) } },
    { id: 'Birthdays', name: 'Birthdays', readOnly: true, objects: { sam: ics(...wholeDay('sam', `${prefix}Sam’s birthday`, '2022-10-10', 'RRULE:FREQ=YEARLY')) } },
    { id: 'Tasks', name: 'Tasks', todo: true, objects: { task: ics('BEGIN:VTODO', 'UID:task', 'SUMMARY:A task', 'DUE:20261008T120000Z', 'END:VTODO') } },
  ],
});
/** What the account's shown calendars hold, by title, each title once: the weekly one is there every week of the span. */
const EVENTS = ['Family dinner', 'Maybe lunch', 'Republic Day', 'Standup', 'Weekly 1:1', 'Weekly 1:1 (moved)'];

/** This device's copy, account by account, by provider and address. */
async function copy(page: Page) {
  const { connections, calendars, events } = await cached(page);
  return Object.fromEntries(
    connections.map((connection) => [
      `${connection.provider} ${connection.account}`,
      {
        status: connection.status,
        calendars: calendars.filter((c) => c.connectionId === connection.id).map((c) => `${c.name}${c.visible ? '' : ' (hidden)'}`).sort(),
        events: [...new Set(events.filter((e) => e.connectionId === connection.id).map((e) => e.title))].sort(),
      },
    ]),
  );
}
/** One account's part of the copy, without when it was read: every Yahoo reading is a whole one. */
const part = async (page: Page, provider: string, address: string) => {
  const { connections, events } = await cached(page);
  const { id } = connections.find((connection) => connection.provider === provider && connection.account === address);
  const mine = events.filter((e) => e.connectionId === id).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(provider === 'google' ? mine : mine.map(({ fetchedAt: _, updatedAt: __, ...rest }) => rest));
};
const listed = async (page: Page) => ((await (await page.request.get('/api/calendars')).json()) as { connections: { connectionId: string; provider: string; account: string; state: string }[] }).connections;
const heading = (page: Page, name: string) => view(page).getByText(name, { exact: true });
/** An event on the calendar whose title begins with these words. */
const titled = (page: Page, title: string) => page.locator('[data-event]', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
/** Each test's own Yahoo address. */
const addressFor = (id: string, who = 'pat') => `${who}-${id.toLowerCase()}@yahoo.test`;
/** Nothing Koyomi ever sent Yahoo could have changed anything. */
const noWrites = async (email: string) => expect((await yahoo.asked(email)).writes).toEqual([]);

test.describe('adding a Yahoo account', () => {
  test('Add calendar account offers Google, Microsoft and Yahoo; Yahoo asks for its email and an app password, and keeps it nowhere in the browser', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    const requests: string[] = [];
    const answers: string[] = [];
    page.on('request', (request) => void requests.push(request.url()));
    page.on('response', async (response) => void (/\/api\//.test(new URL(response.url()).pathname) && answers.push(await response.text().catch(() => ''))));
    await start(page);
    await openCalendars(page);
    await expect(view(page)).toContainText('Koyomi can show your Google, Microsoft and Yahoo calendars beside your own, to read only.');
    await addButton(page).click();
    for (const name of ['Google', 'Microsoft', 'Yahoo'] as const) await expect(choice(page, name)).toBeVisible();
    await choice(page, 'Yahoo').click();
    // A connection belongs to a sign-in: 6Away first, then back to the form.
    const form = yahooForm(page);
    await expect(form).toBeVisible(BACK);
    expect(new URL(page.url()).search).toBe('');
    await expect(form.getByLabel('Yahoo email')).toBeVisible();
    await expect(form.getByLabel('Yahoo app password')).toHaveAttribute('type', 'password');
    await expect(form.getByLabel(/^Password$/)).toHaveCount(0);
    await expect(form).toContainText('Use a Yahoo app password, not your normal Yahoo password.');
    await expect(form).toContainText('Yahoo Account, Account Security, External connections, Create app password');
    await expect(form.getByRole('link', { name: 'How' })).toHaveAttribute('href', 'https://help.yahoo.com/kb/SLN15241.html');

    await form.getByLabel('Yahoo email').fill(email);
    await form.getByLabel('Yahoo app password').fill(PASSWORD);
    await form.getByRole('button', { name: 'Connect Yahoo' }).click();
    await expect(group(page, email)).toBeVisible(BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(yahooForm(page)).toHaveCount(0);

    // Under its own heading and address: its calendars of events, by name; birthdays it cannot
    // change start hidden, and the list of tasks is not a calendar.
    await expect(heading(page, 'YAHOO')).toBeVisible();
    await expect(group(page, email).getByRole('switch')).toHaveText(['Birthdays', 'Family✓', 'Personal✓']);
    await expect(view(page).getByText('Tasks')).toHaveCount(0);
    await expect(view(page)).toContainText('Read only. Koyomi never changes your Yahoo calendar.');
    expect((await listed(page)).map((entry) => [entry.provider, entry.account, entry.state])).toEqual([['yahoo', email, 'ok']]);
    expect(await copy(page)).toEqual({ [`yahoo ${email}`]: { status: 'connected', calendars: ['Birthdays (hidden)', 'Family', 'Personal'], events: EVENTS } });

    // The app password went to Koyomi's server once, in a request's body, and is nowhere now: not
    // in the page, not in any address asked for, not in anything the server answered, not in any
    // storage on the device. Nor is anything Koyomi does not show.
    expect(await page.content()).not.toContain(PASSWORD);
    expect(requests.join('\n')).not.toContain(PASSWORD);
    expect(answers.join('\n')).not.toContain(PASSWORD);
    const everything = await everythingStored(page);
    for (const secret of [PASSWORD, 'PRIVATE', 'private.test', 'A task', 'Cancelled call']) expect(everything, secret).not.toContain(secret);
    // At Yahoo: discovery, then the calendars, then each shown one's events, by its email, read only.
    const log = (await yahoo.asked(email)).log;
    expect(log.slice(0, 3).map((entry) => `${entry.method} ${entry.type}`)).toEqual(['PROPFIND principal', 'PROPFIND home', 'PROPFIND calendars']);
    expect(new Set(log.map((entry) => entry.user))).toEqual(new Set([email]));
    expect(JSON.stringify(log)).not.toContain(PASSWORD);
    await noWrites(email);
  });

  test('its timed, all-day and repeating events, with their exceptions, are where they belong, read only', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await connectYahoo(page, email, PASSWORD);
    await closeDrawer(page);
    const wednesday = page.locator('[data-day="2026-10-07"]');
    await expect(wednesday.locator(external(page, 'Standup'))).toBeVisible();
    // Began in January 2025: found by looking further back for what repeats.
    await expect(wednesday.locator(external(page, 'Weekly 1:1'))).toBeVisible();
    await expect(allDay(page, 'Republic Day')).toBeVisible();
    for (const title of ['Cancelled call', 'A task', 'Sam’s birthday']) await expect(event(page, title)).toHaveCount(0);
    const weekly = (await cached(page)).events.filter((e) => e.title.startsWith('Weekly 1:1')).map((e) => `${e.start} ${e.title}`).sort();
    // Next week's is left out, and the one after is moved an hour, as they are at Yahoo.
    expect(weekly.slice(0, 4)).toEqual([
      '2026-09-02T12:30:00.000Z Weekly 1:1',
      '2026-09-09T12:30:00.000Z Weekly 1:1',
      '2026-09-16T12:30:00.000Z Weekly 1:1',
      '2026-09-23T12:30:00.000Z Weekly 1:1',
    ]);
    expect(weekly).toContain('2026-10-07T12:30:00.000Z Weekly 1:1');
    expect(weekly.some((w) => w.startsWith('2026-10-14'))).toBe(false);
    expect(weekly).toContain('2026-10-21T13:30:00.000Z Weekly 1:1 (moved)');
    expect((await cached(page)).events.find((e) => e.title === 'Republic Day')).toMatchObject({ start: '2026-10-09', end: '2026-10-09', allDay: true });
    expect((await cached(page)).events.find((e) => e.title === 'Maybe lunch')!.status).toBe('tentative');

    // Looked at: what, when, and where from. Nothing to change, and no link Yahoo does not have.
    await external(page, 'Standup').click();
    await expect(popover(page).locator('p')).toHaveText(['Standup', '10:00 – 10:15', `Yahoo Calendar · Personal${email}`]);
    await expect(popover(page).getByRole('link')).toHaveCount(0);
    await expect(popover(page).getByRole('button')).toHaveCount(0);
    await noWrites(email);
  });

  test.describe('on a device in New York', () => {
    test.use({ timezoneId: 'America/New_York' });
    test('the same events are at New York’s times, and the holiday on the same day', async ({ page, id }) => {
      const email = addressFor(id);
      await yahoo.has(email, account());
      await start(page);
      await connectYahoo(page, email, PASSWORD);
      await closeDrawer(page);
      await external(page, 'Standup').click();
      await expect(popover(page).locator('p').nth(1)).toHaveText('03:00 – 03:15');
      await page.keyboard.press('Escape');
      await expect(allDay(page, 'Republic Day')).toBeVisible();
    });
  });

  test('a wrong app password, or Yahoo sending Koyomi elsewhere, connects nothing and keeps nothing', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await openCalendars(page);
    await addAt(page, 'Yahoo');
    const form = yahooForm(page);
    await expect(form).toBeVisible(BACK);
    await form.getByLabel('Yahoo email').fill(email);
    await form.getByLabel('Yahoo app password').fill(WRONG);
    await form.getByRole('button', { name: 'Connect Yahoo' }).click();
    await expect(form.getByRole('status')).toHaveText('Yahoo couldn’t authenticate this app password. Create a Yahoo app password rather than using your normal Yahoo password.', BACK);
    // The field has let go of what was typed; the email stays, to try again.
    await expect(form.getByLabel('Yahoo app password')).toHaveValue('');
    await expect(form.getByLabel('Yahoo email')).toHaveValue(email);
    expect(await (await page.request.get('/api/calendars')).json()).toEqual({ connections: [] });
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();
    expect(await everythingStored(page)).not.toContain(WRONG);

    // Yahoo's well-known address sending Koyomi to another server, or another origin: not followed.
    for (const redirect of ['away', 'other-origin'] as const) {
      await yahoo.becomes(email, { redirect });
      await form.getByLabel('Yahoo app password').fill(PASSWORD);
      await form.getByRole('button', { name: 'Connect Yahoo' }).click();
      await expect(form.getByRole('status')).toHaveText('Couldn’t connect to Yahoo. Try again in a moment.', BACK);
      expect(await (await page.request.get('/api/calendars')).json()).toEqual({ connections: [] });
    }
    // Right password, Yahoo as it should be: connected.
    await yahoo.becomes(email, { redirect: null });
    await form.getByLabel('Yahoo app password').fill(PASSWORD);
    await form.getByRole('button', { name: 'Connect Yahoo' }).click();
    await expect(group(page, email)).toBeVisible(BACK);
    await noWrites(email);
  });

  test('the same Yahoo account again is the same connection, not a second one', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await connectYahoo(page, email, PASSWORD);
    const [first] = await listed(page);
    // Typed differently: the same account.
    await addAt(page, 'Yahoo');
    const form = yahooForm(page);
    await expect(form).toBeVisible(BACK);
    await form.getByLabel('Yahoo email').fill(email.toUpperCase());
    await form.getByLabel('Yahoo app password').fill(PASSWORD);
    await form.getByRole('button', { name: 'Connect Yahoo' }).click();
    await expect(yahooForm(page)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(view(page).getByRole('group')).toHaveCount(1);
    await expect(group(page, email)).toBeVisible();
    expect((await listed(page)).map((entry) => entry.connectionId)).toEqual([first.connectionId]);
  });

  test('too many tries in a few minutes are turned away before Yahoo is asked', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await openCalendars(page);
    await addAt(page, 'Yahoo');
    const form = yahooForm(page);
    await expect(form).toBeVisible(BACK);
    await form.getByLabel('Yahoo email').fill(email);
    for (let i = 0; i < 5; i++) {
      await form.getByLabel('Yahoo app password').fill(WRONG);
      await form.getByRole('button', { name: 'Connect Yahoo' }).click();
      await expect(form.getByRole('status')).toContainText('couldn’t authenticate', BACK);
      await expect(form.getByRole('button', { name: 'Connect Yahoo' })).toBeEnabled();
    }
    const tried = (await yahoo.asked(email)).log.length;
    await form.getByLabel('Yahoo app password').fill(PASSWORD);
    await form.getByRole('button', { name: 'Connect Yahoo' }).click();
    await expect(form.getByRole('status')).toHaveText('Too many tries for now. Wait a few minutes, then try again.', BACK);
    expect((await yahoo.asked(email)).log.length).toBe(tried);
  });
});

test.describe('reading a Yahoo account', () => {
  test('showing a calendar reads that one alone; hiding one keeps nothing of it', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await connectYahoo(page, email, PASSWORD);
    const asked = (await yahoo.asked(email)).log.length;
    await toggle(page, 'Birthdays', email).click();
    await expect(toggle(page, 'Birthdays', email)).toHaveAttribute('aria-checked', 'true');
    await expect(allDay(page, 'Sam’s birthday')).toBeVisible(BACK);
    expect((await yahoo.asked(email)).log.slice(asked).map((entry) => `${entry.method} ${entry.calendar} ${entry.repeatingOnly}`)).toEqual(['REPORT Birthdays false', 'REPORT Birthdays true']);
    await toggle(page, 'Family', email).click();
    await expect(event(page, 'Family dinner')).toHaveCount(0);
    expect((await copy(page))[`yahoo ${email}`].events).not.toContain('Family dinner');
    await reload(page);
    await expect(event(page, 'Family dinner')).toHaveCount(0);
    await expect(allDay(page, 'Sam’s birthday')).toBeVisible();
  });

  test('a refresh rereads the span, and what was added, changed and deleted at Yahoo is what is shown', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await connectYahoo(page, email, PASSWORD);
    await yahoo.changes(email, {
      calendar: 'Personal',
      put: { standup: ics(...timed('standup', 'Standup (moved)', '2026-10-07', '10:30', '10:45')), planning: ics(...timed('planning', 'New planning', '2026-10-08', '09:00', '10:00')) },
      remove: ['maybe'],
    });
    await refresh(page);
    expect((await copy(page))[`yahoo ${email}`].events).toEqual(['Family dinner', 'New planning', 'Republic Day', 'Standup (moved)', 'Weekly 1:1', 'Weekly 1:1 (moved)']);
    await noWrites(email);
  });

  test('read again with no network: everything that was read is there, and Refresh says it is offline', async ({ page, context, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await connectYahoo(page, email, PASSWORD);
    await closeDrawer(page);
    await page.evaluate(async () => void (await navigator.serviceWorker.ready));
    await context.setOffline(true);
    await reload(page);
    for (const title of ['Standup', 'Weekly 1:1', 'Maybe lunch']) await expect(external(page, title).first()).toBeVisible();
    await expect(allDay(page, 'Republic Day')).toBeVisible();
    await openCalendars(page);
    await refresh(page);
    await expect(view(page).getByRole('status')).toHaveText('You seem to be offline, so your calendars couldn’t be read. Try again once you’re back online.');
    await expect(page.getByText(/reconnect|sign in/i)).toHaveCount(0);
    expect(await everythingStored(page)).not.toContain(PASSWORD);
    await context.setOffline(false);
  });

  test('an app password deleted at Yahoo: Needs reconnecting, what was read stays, and Reconnect asks only for a new app password', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await connectYahoo(page, email, PASSWORD);
    const [first] = await listed(page);
    await toggle(page, 'Family', email).click();
    await expect(toggle(page, 'Family', email)).toHaveAttribute('aria-checked', 'false');
    await yahoo.becomes(email, { revoked: true });
    await refresh(page);
    await expect(group(page, email)).toContainText('Needs reconnecting');
    await closeDrawer(page);
    await expect(external(page, 'Standup')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yahoo calendar needs reconnecting' })).toBeVisible();
    await page.getByRole('button', { name: 'Yahoo calendar needs reconnecting' }).click();
    await group(page, email).getByRole('button', { name: 'Reconnect' }).click();

    // Only a new app password: the account is the one it was.
    const form = yahooForm(page);
    await expect(form).toHaveAccessibleName('Reconnect Yahoo Calendar');
    await expect(form).toContainText(email);
    await expect(form.getByLabel('Yahoo email')).toHaveCount(0);
    // The old one is refused; a new one is taken.
    await yahoo.becomes(email, { revoked: false, password: 'newpasswordnewpa' });
    await form.getByLabel('Yahoo app password').fill(PASSWORD);
    await form.getByRole('button', { name: 'Connect Yahoo' }).click();
    await expect(form.getByRole('status')).toContainText('couldn’t authenticate', BACK);
    await form.getByLabel('Yahoo app password').fill('newp assw ordn ewpa');
    await form.getByRole('button', { name: 'Connect Yahoo' }).click();
    await expect(page.getByText(/needs reconnecting/i)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    // The same connection, with the calendars as the person left them.
    expect((await listed(page)).map((entry) => [entry.connectionId, entry.state])).toEqual([[first.connectionId, 'ok']]);
    await expect(toggle(page, 'Family', email)).toHaveAttribute('aria-checked', 'false');
    await noWrites(email);
  });

  test('Yahoo down, or asking to wait, keeps what was read and Refresh says so; one calendar’s unreadable answer is that calendar’s own', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await connectYahoo(page, email, PASSWORD);
    const kept = await part(page, 'yahoo', email);
    const couldNot = `Couldn’t read ${email} just now. Try again in a moment.`;
    // Yahoo down, or its list of calendars unreadable: the account could not be read. One calendar's
    // events unreadable is that calendar's own, and the others are read as usual.
    for (const [fail, said] of [['unavailable', couldNot], ['doctype', couldNot], ['malformed', null]] as const) {
      await yahoo.becomes(email, { fail });
      await refresh(page);
      if (said) await expect(view(page).getByRole('status'), fail).toHaveText(said);
      else await expect(view(page).getByRole('status'), fail).toHaveCount(0);
      await expect(page.getByText(/reconnect|doesn’t let/i), fail).toHaveCount(0);
      expect(await part(page, 'yahoo', email), fail).toBe(kept);
    }
    // A server that will not filter on RRULE: the look back is made without it, all the same.
    await yahoo.becomes(email, { fail: 'no-prop-filter' });
    await refresh(page);
    expect((await copy(page))[`yahoo ${email}`].events).toEqual(EVENTS);
    // Asking to wait comes last: for as long as Yahoo asks, nothing more is asked of it, so nothing
    // after this would be read at all.
    const read = await part(page, 'yahoo', email);
    await yahoo.becomes(email, { fail: 'throttled' });
    await refresh(page);
    await expect(view(page).getByRole('status')).toHaveText(couldNot);
    await expect(page.getByText(/reconnect|doesn’t let/i)).toHaveCount(0);
    expect(await part(page, 'yahoo', email)).toBe(read);
  });
});

test.describe('several Yahoo accounts, and Yahoo beside Google and Microsoft', () => {
  test('two Yahoo accounts with the same calendars and UIDs are kept apart; one refreshed or disconnected leaves the other', async ({ page, context, id }) => {
    const a = addressFor(id, 'pat');
    const b = addressFor(id, 'sam');
    await yahoo.has(a, account());
    await yahoo.has(b, account('Sam: '));
    await start(page);
    await connectYahoo(page, a, PASSWORD);
    await connectYahoo(page, b, PASSWORD);
    expect(Object.keys(await copy(page)).sort()).toEqual([`yahoo ${a}`, `yahoo ${b}`]);
    const sams = await part(page, 'yahoo', b);
    await toggle(page, 'Family', a).click();
    await expect(titled(page, 'Family dinner')).toHaveCount(0);
    await expect(external(page, 'Sam: Family dinner')).toBeVisible();
    await yahoo.changes(a, { calendar: 'Personal', remove: ['standup'] });
    await refresh(page);
    await expect(titled(page, 'Standup')).toHaveCount(0);
    await expect(external(page, 'Sam: Standup')).toBeVisible();
    expect(await part(page, 'yahoo', b)).toBe(sams);

    // Disconnect the first: Koyomi forgets its app password, and says where to delete it at Yahoo.
    const answer = page.waitForResponse((response) => response.url().endsWith('/api/calendars/disconnect'));
    await disconnectButton(page, a).click();
    expect(await (await answer).json()).toEqual({ ok: true, revoked: false, signedOut: false });
    await expect(group(page, a)).toHaveCount(0, BACK);
    await expect(view(page).getByRole('status')).toContainText('Koyomi no longer keeps that Yahoo app password.');
    await expect(view(page).getByRole('status')).toContainText('Account Security, External connections');
    expect((await listed(page)).map((entry) => entry.account)).toEqual([b]);
    expect(Object.keys(await copy(page))).toEqual([`yahoo ${b}`]);
    expect(await part(page, 'yahoo', b)).toBe(sams);
    expect((await context.cookies()).some((cookie) => cookie.name === 'koyomi_session')).toBe(true);
    await disconnectButton(page, b).click();
    await expect(nothingConnected(page)).toBeVisible(BACK);
    await expect.poll(() => page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    await noWrites(a);
    await noWrites(b);
  });

  test('Google, Microsoft and two Yahoo accounts together: apart, read apart, in trouble apart, ended apart, and all there offline', async ({ page, context, id }) => {
    const pat = `${id}m`;
    const a = addressFor(id, 'pat');
    const b = addressFor(id, 'sam');
    await microsoft.has(pat, {
      kind: 'personal',
      address: 'pat@outlook.test',
      calendars: [{ id: 'AAMkDefault=', name: 'Calendar', isDefaultCalendar: true, events: [{ id: 'dentist', subject: 'Osteopath', start: { dateTime: graphTime('2026-10-07', '17:00'), timeZone: 'UTC' }, end: { dateTime: graphTime('2026-10-07', '18:00'), timeZone: 'UTC' } }] }],
    });
    // A Yahoo UID equal to the Google event's id, and to the Microsoft one's.
    await yahoo.has(a, { password: PASSWORD, calendars: [{ id: 'Personal', name: 'Personal', objects: { dentist: ics(...timed('dentist', 'Physio', '2026-10-07', '11:00', '12:00')) } }] });
    await yahoo.has(b, { password: PASSWORD, calendars: [{ id: 'Personal', name: 'Personal', objects: { dentist: ics(...timed('dentist', 'Massage', '2026-10-08', '11:00', '12:00')) } }] });
    await seed(page, { events: [{ id: 'mine', title: 'My own event', start: '2026-10-07T14:00:00.000Z', end: '2026-10-07T15:00:00.000Z', allDay: false, category: 'work', recurrence: null, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' }] });
    await start(page);
    await connect(page);
    await connectMicrosoft(page, pat, 'pat@outlook.test');
    await connectYahoo(page, a, PASSWORD);
    await connectYahoo(page, b, PASSWORD);
    const own = JSON.stringify(await stored(page));

    for (const name of ['GOOGLE', 'MICROSOFT', 'YAHOO']) await expect(heading(page, name)).toBeVisible();
    await expect(view(page)).toContainText('Read only. Koyomi never changes your calendars.');
    expect(Object.keys(await copy(page)).sort()).toEqual([`google ${ME}`, `microsoft pat@outlook.test`, `yahoo ${a}`, `yahoo ${b}`]);
    for (const title of ['Dentist', 'Osteopath', 'Physio', 'Massage']) await expect(external(page, title)).toBeVisible();

    // A change at one Yahoo account touches no other part.
    const parts = async () => ({ google: await part(page, 'google', ME), microsoft: await part(page, 'microsoft', 'pat@outlook.test'), b: await part(page, 'yahoo', b) });
    const before = await parts();
    await yahoo.changes(a, { calendar: 'Personal', remove: ['dentist'] });
    await refresh(page);
    await expect(event(page, 'Physio')).toHaveCount(0);
    const microsoftNow = (await parts()).microsoft;
    expect({ ...(await parts()), microsoft: before.microsoft }).toEqual(before);
    expect(microsoftNow).toBe(before.microsoft);

    // Yahoo refusing one account is that account's alone; Google failing is Google's.
    await yahoo.becomes(a, { revoked: true });
    await google.becomes(id, { fail: 'unavailable' });
    await yahoo.changes(b, { calendar: 'Personal', put: { extra: ics(...timed('extra', 'Extra review', '2026-10-09', '10:00', '11:00')) } });
    await refresh(page);
    await expect(group(page, a)).toContainText('Needs reconnecting');
    for (const other of [ME, 'pat@outlook.test', b]) await expect(group(page, other)).not.toContainText('Needs reconnecting');
    await expect(external(page, 'Extra review')).toBeVisible();
    await expect(external(page, 'Dentist')).toBeVisible();
    await google.becomes(id, { fail: null });

    // Offline: every provider's events, and Koyomi's own.
    await closeDrawer(page);
    await page.evaluate(async () => void (await navigator.serviceWorker.ready));
    await context.setOffline(true);
    await reload(page);
    for (const title of ['Dentist', 'Osteopath', 'Massage', 'Extra review', 'My own event']) await expect(event(page, title).first()).toBeVisible();
    await context.setOffline(false);

    // Disconnecting the second Yahoo account leaves Google, Microsoft and the first.
    await openCalendars(page);
    await disconnectButton(page, b).click();
    await expect(group(page, b)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    // The first Yahoo account still needs reconnecting: the server does not read it, so names no address for it.
    expect((await listed(page)).map((entry) => `${entry.provider} ${entry.account ?? entry.state}`)).toEqual([`google ${ME}`, 'microsoft pat@outlook.test', 'yahoo reconnect']);
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(external(page, 'Osteopath')).toBeVisible();
    expect(JSON.stringify(await stored(page))).toBe(own);
    await noWrites(a);
    await noWrites(b);
  });
});

test.describe('whose Yahoo connection it is', () => {
  test('a Yahoo connection is read and ended only by its owner, from the app, and the server never hands its password back', async ({ page, browser, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await connectYahoo(page, email, PASSWORD);
    const [mine] = await listed(page);
    const home = new URL(String((await yahoo.asked(email)).log.find((entry) => entry.type === 'calendars')!.path), 'http://x').pathname;
    const ask = { connectionId: mine.connectionId, timeMin: '2026-10-01T00:00:00.000Z', timeMax: '2026-11-01T00:00:00.000Z', calendars: [{ calendarId: `${home}Personal/`, syncToken: null }] };
    const headers = { origin: APP };
    const reached = await page.request.post('/api/calendars/events', { data: ask, headers });
    expect(reached.status()).toBe(200);
    expect(await reached.text()).not.toContain(PASSWORD);
    expect(JSON.stringify(await listed(page))).not.toContain(PASSWORD);
    expect(await (await page.request.get('/api/yahoo/connect')).json()).toEqual({ ok: true });

    // A calendar outside the account's own home is never asked about, whatever the browser says.
    const asked = (await yahoo.asked(email)).log.length;
    for (const calendarId of ['/dav/someone-else/Calendar/Theirs/', `${home}../`, 'http://evil.example/dav/x/']) {
      const answer = await page.request.post('/api/calendars/events', { data: { ...ask, calendars: [{ calendarId, syncToken: null }] }, headers });
      expect(answer.status(), calendarId).toBe(200);
      expect(await answer.json()).toEqual({ calendars: [{ calendarId, gone: true }] });
    }
    expect((await yahoo.asked(email)).log.length).toBe(asked);
    // Malformed, from another site, with nothing at all, or with a server named by the browser: refused.
    expect((await page.request.post('/api/calendars/events', { data: { ...ask, connectionId: 'yahoo' }, headers })).status()).toBe(400);
    expect((await page.request.post('/api/yahoo/connect', { data: { email, appPassword: PASSWORD }, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
    expect((await page.request.post('/api/yahoo/connect', { data: { email }, headers })).status()).toBe(400);
    expect((await page.request.post('/api/yahoo/connect', { data: { email: `${email}:x`, appPassword: PASSWORD }, headers })).status()).toBe(400);
    const named = await page.request.post('/api/yahoo/connect', { data: { email, appPassword: PASSWORD, server: 'http://evil.example', url: 'http://evil.example/dav/' }, headers });
    expect(await named.json()).toEqual({ ok: true });

    // Someone else, signed in as themselves, with the id in hand.
    const theirs = await browser.newContext();
    await theirs.addCookies([{ name: 'fake_user', value: `stranger-${id}`, url: FAKE }]);
    const stranger = await theirs.newPage();
    await stranger.goto('/api/auth/signin?returnTo=%2F');
    expect(await (await stranger.request.get('/api/calendars')).json()).toEqual({ connections: [] });
    const theirAnswer = await stranger.request.post('/api/calendars/events', { data: ask, headers });
    expect([theirAnswer.status(), await theirAnswer.json()]).toEqual([409, { error: 'not_connected' }]);
    expect(await (await stranger.request.post('/api/calendars/disconnect', { data: { connectionId: mine.connectionId }, headers })).json()).toEqual({ ok: true, revoked: false, signedOut: true });
    await theirs.close();
    // Nobody signed in.
    const nobody = await browser.newContext();
    expect((await nobody.request.get(`${APP}/api/yahoo/connect`)).status()).toBe(401);
    expect((await nobody.request.post(`${APP}/api/yahoo/connect`, { data: { email, appPassword: PASSWORD }, headers })).status()).toBe(401);
    await nobody.close();
    // Still the owner's, still working.
    expect((await page.request.post('/api/calendars/events', { data: ask, headers })).status()).toBe(200);
    expect((await listed(page)).map((entry) => entry.connectionId)).toEqual([mine.connectionId]);
    await noWrites(email);
  });

  test('signed out with the form open: sign in, and the form is shown again, empty', async ({ page, context, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await openCalendars(page);
    await addAt(page, 'Yahoo');
    await expect(yahooForm(page)).toBeVisible(BACK);
    await context.clearCookies({ name: 'koyomi_session' });
    const form = yahooForm(page);
    await form.getByLabel('Yahoo email').fill(email);
    await form.getByLabel('Yahoo app password').fill(PASSWORD);
    // Refused for want of a sign-in; signed in again; the form is asked for once more.
    const refused = page.waitForResponse((r) => r.url().endsWith('/api/yahoo/connect') && r.request().method() === 'POST');
    const back = page.waitForResponse((r) => r.url().endsWith('/api/yahoo/connect') && r.request().method() === 'GET' && r.status() === 200);
    await form.getByRole('button', { name: 'Connect Yahoo' }).click();
    expect((await refused).status()).toBe(401);
    await back;
    await expect(yahooForm(page)).toBeVisible(BACK);
    await expect(yahooForm(page).getByLabel('Yahoo app password')).toHaveValue('');
    expect(await (await page.request.get('/api/calendars')).json()).toEqual({ connections: [] });
    expect(await everythingStored(page)).not.toContain(PASSWORD);
  });
});

test.describe('Yahoo on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('the form fits, and the account is under its provider', async ({ page, id }) => {
    const email = addressFor(id);
    await yahoo.has(email, account());
    await start(page);
    await openCalendars(page);
    await addButton(page).tap();
    await choice(page, 'Yahoo').tap();
    const form = yahooForm(page);
    await expect(form).toBeVisible(BACK);
    for (const field of ['Yahoo email', 'Yahoo app password']) expect((await form.getByLabel(field).boundingBox())!.height).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await form.getByLabel('Yahoo email').fill(email);
    await form.getByLabel('Yahoo app password').fill(PASSWORD);
    await form.getByRole('button', { name: 'Connect Yahoo' }).tap();
    await expect(group(page, email)).toBeVisible(BACK);
    await expect(heading(page, 'YAHOO')).toBeVisible();
    void open;
    void NOW;
  });
});
