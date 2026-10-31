import { expect, type Page } from '@playwright/test';
import { check } from './contrast';
import {
  CALENDAR_API,
  FAKE,
  ME,
  NOW,
  actAs,
  accountLine,
  addAt,
  addButton,
  allDay,
  cached,
  closeDrawer,
  connect,
  connectAlso,
  disconnectButton,
  external,
  google,
  group,
  ist,
  nothingConnected,
  openCalendars,
  pick,
  refresh,
  refreshAndHold,
  start,
  test,
  toggle,
  view,
} from './connected';
import { addEvent, event, popover, reload, seed, stored } from './helpers';

// Several Google accounts connected by one person. Each is a connection of its own: added,
// read, shown, refused and ended by itself. Two accounts can hold calendars and events with the
// very same ids (a shared team calendar is exactly that), so the second account here is made to
// collide with the first wherever it can, and nothing of one may ever stand in for the other.

/** The second account's address. */
const THEM = 'b@example.test';
const APP = 'http://localhost:4310';

/**
 * A second Google account. Its Work and Holidays calendars have the same ids as the first
 * account's, and the events in them the same ids too, with different things in them.
 */
const second = () => ({
  calendars: [
    {
      id: THEM,
      summary: 'Personal',
      primary: true,
      selected: true,
      // The same event id as the first account's Dentist, in a calendar with another id.
      events: [{ id: 'dentist', summary: 'Physio', start: { dateTime: ist('2026-10-07', '17:00') }, end: { dateTime: ist('2026-10-07', '18:00') } }],
    },
    {
      id: 'work@example.test',
      summary: 'Work',
      selected: true,
      events: [
        { id: 'sync_1', summary: 'Board meeting', htmlLink: 'https://www.google.com/calendar/event?eid=board', start: { dateTime: ist('2026-10-07', '13:00') }, end: { dateTime: ist('2026-10-07', '14:00') } },
        { id: 'sync_2', summary: 'Board dinner', start: { dateTime: ist('2026-10-08', '19:00') }, end: { dateTime: ist('2026-10-08', '20:00') } },
      ],
    },
    {
      id: 'holidays@example.test',
      summary: 'Holidays',
      selected: true,
      events: [{ id: 'holiday', summary: 'Company day off', start: { date: '2026-10-06' }, end: { date: '2026-10-07' } }],
    },
  ],
});

/** The first account's events as the device should hold them, and the second's. */
const MINE = ['Dentist', 'Mum’s birthday', 'Trip to Izmir', 'Weekly sync', 'Weekly sync'];
const THEIRS = ['Board dinner', 'Board meeting', 'Company day off', 'Physio'];

/** This device's copy, account by account: what each holds, by its address. */
async function copy(page: Page) {
  const { connections, calendars, events } = await cached(page);
  return Object.fromEntries(
    connections.map((connection) => [
      connection.account,
      {
        status: connection.status,
        calendars: calendars.filter((c) => c.connectionId === connection.id).map((c) => `${c.name}${c.visible ? '' : ' (hidden)'}`).sort(),
        events: events.filter((e) => e.connectionId === connection.id).map((e) => e.title).sort(),
      },
    ]),
  );
}
/** One account's part of the copy, to the letter: its events as they are stored. */
const part = async (page: Page, address: string) => {
  const { connections, events } = await cached(page);
  const { id } = connections.find((connection) => connection.account === address);
  return JSON.stringify(events.filter((e) => e.connectionId === id).sort((a, b) => a.id.localeCompare(b.id)));
};
/** What Google was last asked about each calendar of an account, in the order it was asked. */
const modes = async (id: string, last: number) => (await google.asked(id)).log.filter((entry) => entry.type === 'events').slice(-last).map((entry) => `${entry.calendarId} ${entry.mode}`).sort();
/** What was done with an account's permission, as opposed to what was read through it. */
const grants = async (id: string) => (await google.asked(id)).log.map((entry) => entry.type).filter((type) => ['consent', 'grant', 'account', 'revoke'].includes(type));
const listed = async (page: Page) => ((await (await page.request.get('/api/calendars')).json()) as { connections: { connectionId: string; account: string; state: string }[] }).connections;

/** Both accounts connected: the first, then the second beside it. Returns the second account's id at the stand-in. */
async function both(page: Page, id: string) {
  const other = `${id}b`;
  await google.has(other, second());
  await start(page);
  await connect(page);
  await connectAlso(page, other, THEM);
  return other;
}

test.describe.configure({ timeout: 90_000 });
/** For an answer on its way back through the server: allow for a busy machine, as `connect` does. */
const BACK = { timeout: 15_000 };

test.describe('Calendars with several accounts', () => {
  test('each account is one line until it is opened: its address and how many of its calendars are shown', async ({ page, id }) => {
    const other = await both(page, id);
    // As a device that has never opened either: what the tests opened on the way is forgotten.
    await page.evaluate(() => localStorage.removeItem('koyomi-calendars-open'));
    await reload(page);
    await page.keyboard.press('c');
    await expect(view(page)).toBeVisible();

    // Two lines, folded: nothing of either account's calendars, and no Disconnect to hit by mistake.
    await expect(accountLine(page, ME)).toHaveAttribute('aria-expanded', 'false');
    await expect(accountLine(page, THEM)).toHaveAttribute('aria-expanded', 'false');
    await expect(accountLine(page, ME)).toHaveText(`${ME}2 of 3›`);
    await expect(accountLine(page, THEM)).toHaveText(`${THEM}3 of 3›`);
    await expect(view(page).getByRole('switch')).toHaveCount(0);
    await expect(view(page).getByRole('button', { name: /^Disconnect/ })).toHaveCount(0);
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toBeVisible();

    // One opened: its calendars and its own Disconnect, last. The other stays as it was.
    await accountLine(page, ME).click();
    await expect(accountLine(page, ME)).toHaveAttribute('aria-expanded', 'true');
    await expect(group(page, ME).getByRole('switch')).toHaveText(['Personal✓', 'Holidays', 'Work✓']);
    await expect(disconnectButton(page, ME)).toBeVisible();
    await expect(group(page, THEM).getByRole('switch')).toHaveCount(0);
    // Hiding one says so on its line straight away.
    await toggle(page, 'Work', ME).click();
    await expect(accountLine(page, ME)).toHaveText(`${ME}1 of 3›`);

    // Remembered on this device, account by account.
    await reload(page);
    await page.keyboard.press('c');
    await expect(accountLine(page, ME)).toHaveAttribute('aria-expanded', 'true');
    await expect(accountLine(page, THEM)).toHaveAttribute('aria-expanded', 'false');
    await accountLine(page, ME).click();
    await expect(group(page, ME).getByRole('switch')).toHaveCount(0);

    // An account that needs the person opens by itself, with what to do.
    await google.becomes(other, { revoked: true });
    await view(page).getByRole('button', { name: 'Refresh' }).click();
    await expect(accountLine(page, THEM)).toHaveAttribute('aria-expanded', 'true', BACK);
    await expect(group(page, THEM).getByRole('button', { name: 'Reconnect' })).toBeVisible();
    // One the person folded themselves stays folded, and says it on its line instead.
    await google.becomes(id, { revoked: true });
    await view(page).getByRole('button', { name: 'Refresh' }).click();
    await expect(accountLine(page, ME)).toHaveText(`${ME}Needs reconnecting›`, BACK);
    await expect(accountLine(page, ME)).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('adding a second account', () => {
  test('goes to Google to choose it, leaves the first as it was, and shows both under their addresses', async ({ page, id }) => {
    const other = `${id}b`;
    await google.has(other, second());
    const asked: string[] = [];
    page.on('request', (request) => void (request.url().includes('/api/google/connect') && asked.push(new URL(request.url()).search)));
    await start(page);
    await connect(page);
    const [first] = await listed(page);
    const before = await part(page, ME);

    // The same button, from the same place. This time the device has an account, and says it is adding one.
    await connectAlso(page, other, THEM);
    // The first time by way of sign-in; the second time already signed in, and saying it is adding one.
    expect(asked).toEqual(['', '?signed=1', '?add=1']);
    expect(new URL(page.url()).search).toBe('');
    // Google was told to ask which account, both times, and the second account gave its own consent.
    for (const account of [id, other]) {
      const consent = (await google.asked(account)).log.find((entry) => entry.type === 'consent')!;
      expect(consent.prompt).toBe('consent select_account');
      expect(consent.scope).toBe('https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly');
    }
    expect(await grants(other)).toEqual(['consent', 'grant', 'account']);
    // Nothing was done with the first account's permission: no new consent, nothing handed back.
    expect(await grants(id)).toEqual(['consent', 'grant', 'account']);
    expect((await google.asked(id)).revoked).toBe(false);

    // Calendars: Koyomi, then each account under its own address, with its own calendars and its own Disconnect.
    await expect(view(page).getByText('GOOGLE', { exact: true })).toHaveCount(1);
    await expect(view(page).getByRole('group')).toHaveCount(2);
    await expect(group(page, THEM).getByRole('switch')).toHaveText(['Personal✓', 'Holidays✓', 'Work✓']);
    await expect(group(page, ME).getByRole('switch')).toHaveText(['Personal✓', 'Holidays', 'Work✓']);
    await expect(disconnectButton(page, ME)).toHaveAccessibleName(`Disconnect ${ME}`);
    await expect(disconnectButton(page, THEM)).toHaveAccessibleName(`Disconnect ${THEM}`);
    await expect(addButton(page)).toBeVisible();
    // Nothing of how it is connected is shown: no ids, no tokens, no permissions.
    await expect(view(page).getByText(/token|oauth|scope|[0-9a-f]{8}-[0-9a-f]{4}/i)).toHaveCount(0);

    // On the server: two connections of this person's, the first one the same as before.
    const now = await listed(page);
    expect(now.map((entry) => [entry.account, entry.state])).toEqual([[ME, 'ok'], [THEM, 'ok']]);
    expect(now[0].connectionId).toBe(first.connectionId);
    expect(now[1].connectionId).not.toBe(first.connectionId);
    // On the device: each account's own, and the first account's events exactly as they were.
    expect(await copy(page)).toEqual({
      [ME]: { status: 'connected', calendars: ['Holidays (hidden)', 'Personal', 'Work'], events: MINE },
      [THEM]: { status: 'connected', calendars: ['Holidays', 'Personal', 'Work'], events: THEIRS },
    });
    expect(await part(page, ME)).toBe(before);

    // On the calendar: both accounts' events, in the same quiet way.
    await closeDrawer(page);
    for (const title of ['Dentist', 'Weekly sync', 'Board meeting', 'Physio']) await expect(page.locator('[data-day="2026-10-07"]').locator(external(page, title))).toBeVisible();
    await expect(allDay(page, 'Company day off')).toBeVisible();
    await reload(page);
    await expect(external(page, 'Board meeting')).toBeVisible();
    await expect(external(page, 'Dentist')).toBeVisible();
  });

  test('an event says which calendar it is from, and whose account that is', async ({ page, id }) => {
    await both(page, id);
    await closeDrawer(page);

    // Two calendars called Work, in two accounts: the address under each is what tells them apart.
    await external(page, 'Board meeting').click();
    await expect(popover(page).locator('p')).toHaveText(['Board meeting', '13:00 – 14:00', `Google Calendar · Work${THEM}`]);
    await expect(popover(page).getByRole('link', { name: 'Open in Google Calendar' })).toHaveAttribute('href', 'https://www.google.com/calendar/event?eid=board');
    await expect(popover(page).getByRole('button')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await external(page, 'Weekly sync').click();
    await expect(popover(page).locator('p')).toHaveText(['Weekly sync', '10:00 – 11:00', `Google Calendar · Work${ME}`]);
    await page.keyboard.press('Escape');

    // They look alike on the calendar: outlined, with a grey bar. No colour for each account.
    // (Looked at with nothing under the pointer and nothing still fading: an outline darkens on hover.)
    await page.mouse.move(5, 5);
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
    const look = (title: string) => external(page, title).evaluate((el) => `${getComputedStyle(el).backgroundColor} ${getComputedStyle(el).boxShadow} ${getComputedStyle(el.querySelector('span')!).backgroundColor}`);
    expect(await look('Board meeting')).toBe(await look('Weekly sync'));
    // And a Koyomi event is still the one with a tint of its own.
    await addEvent(page, 'Lunch', '15:00', '2026-10-08');
    expect(await event(page, 'Lunch').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(await external(page, 'Board dinner').evaluate((el) => getComputedStyle(el).backgroundColor));
  });

  test('the same account added again is the same connection, not a second one', async ({ page, id }) => {
    await start(page);
    await connect(page);
    const [first] = await listed(page);

    // Add, and at Google choose the account that is already connected.
    await pick(page, id);
    await addAt(page, 'Google');
    await expect(view(page).getByText(/^Read \d/)).toBeVisible(BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(view(page).getByRole('group')).toHaveCount(1);
    expect((await google.asked(id)).log.filter((entry) => entry.type === 'consent')).toHaveLength(2);
    expect(await listed(page)).toEqual([{ ...first, calendars: expect.anything() }]);
    expect((await cached(page)).connections).toHaveLength(1);
    await closeDrawer(page);
    await expect(external(page, 'Dentist')).toHaveCount(1);
  });

  test('an account that was not added is said so, and stays said while the first is read on its own', async ({ page, context, id }) => {
    await start(page);
    await connect(page);
    // Some minutes at Google, deciding against it: long enough that the first account is due a
    // reading the moment the calendar opens again. Meanwhile something changed there.
    await page.clock.setFixedTime(new Date(NOW.getTime() + 10 * 60_000));
    await google.changes(id, { calendarId: ME, cancel: ['dentist'] });
    await context.addCookies([{ name: 'fake_google', value: `deny:${id}`, url: FAKE }]);
    await addAt(page, 'Google');

    // Back with nothing added. The first account was read at once, unasked, and its change is here.
    await expect(view(page).getByText('Read 13:20')).toBeVisible(BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0);
    await expect(external(page, 'Dentist')).toHaveCount(0);
    await expect(view(page).getByRole('group')).toHaveCount(1);
    // That reading was not the person's doing, so it has not taken away what they were just told.
    await expect(view(page).getByRole('status')).toHaveText('Google Calendar was not connected.');

    // Asking for something themselves does: they have seen it.
    await toggle(page, 'Holidays').click();
    await expect(view(page).getByRole('status')).toHaveCount(0);
    await addAt(page, 'Google');
    await expect(view(page).getByRole('status')).toHaveText('Google Calendar was not connected.', BACK);
    await view(page).getByRole('button', { name: 'Refresh' }).click();
    await expect(view(page).getByRole('status')).toHaveCount(0);
  });
});

test.describe('two accounts with the same calendar and event ids', () => {
  test('are two sets of calendars and events, chosen and kept apart', async ({ page, id }) => {
    await both(page, id);
    const { connections, calendars, events } = await cached(page);
    const [mine, theirs] = [ME, THEM].map((address) => connections.find((connection) => connection.account === address).id);

    // The very same ids at Google; on this device, a record for each account.
    const work = calendars.filter((c) => c.calendarId === 'work@example.test');
    expect(work.map((c) => c.connectionId).sort()).toEqual([mine, theirs].sort());
    expect(new Set(work.map((c) => c.id)).size).toBe(2);
    const sync = events.filter((e) => e.calendarId === 'work@example.test' && e.providerEventId === 'sync_1');
    expect(sync.map((e) => `${e.title} ${e.connectionId}`).sort()).toEqual([`Board meeting ${theirs}`, `Weekly sync ${mine}`].sort());
    expect(events.filter((e) => e.providerEventId === 'dentist').map((e) => e.title).sort()).toEqual(['Dentist', 'Physio']);
    // Every record is filed under its account, in its id as well as beside it.
    for (const record of [...calendars, ...events]) expect(record.id.startsWith(`${record.connectionId}:`), record.id).toBe(true);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);

    // Hiding Work in one account hides that account's Work and not the other's.
    const theirWork = await part(page, THEM);
    await toggle(page, 'Work', ME).click();
    await expect(toggle(page, 'Work', ME)).toHaveAttribute('aria-checked', 'false');
    await expect(toggle(page, 'Work', THEM)).toHaveAttribute('aria-checked', 'true');
    await expect(event(page, 'Weekly sync')).toHaveCount(0);
    await expect(external(page, 'Board meeting')).toBeVisible();
    await expect.poll(async () => (await copy(page))[ME].events).toEqual(['Dentist', 'Mum’s birthday', 'Trip to Izmir']);
    expect(await part(page, THEM)).toBe(theirWork);

    // Holidays was not ticked in the first account and was in the second: each as its own account has it.
    await expect(allDay(page, 'Company day off')).toBeVisible();
    await expect(event(page, 'Republic Day')).toHaveCount(0);
    const before = (await google.asked(`${id}b`)).log.length;
    await toggle(page, 'Holidays', ME).click();
    await expect(allDay(page, 'Republic Day')).toBeVisible(BACK);
    await expect(allDay(page, 'Company day off')).toBeVisible();
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    // Showing a calendar in one account reads that calendar there, and asks the other account nothing.
    expect((await google.asked(`${id}b`)).log.length).toBe(before);
    expect((await google.asked(id)).log.at(-1)).toMatchObject({ type: 'events', calendarId: 'holidays@example.test', mode: 'everything' });
    await toggle(page, 'Holidays', THEM).click();
    await expect(event(page, 'Company day off')).toHaveCount(0);
    await expect(allDay(page, 'Republic Day')).toBeVisible();

    // The choices are each account's own, and still there after a reload.
    await reload(page);
    await openCalendars(page);
    await expect(group(page, ME).getByRole('switch')).toHaveText(['Personal✓', 'Holidays✓', 'Work']);
    await expect(group(page, THEM).getByRole('switch')).toHaveText(['Personal✓', 'Holidays', 'Work✓']);
    await toggle(page, 'Work', ME).click();
    await expect(external(page, 'Weekly sync').first()).toBeVisible(BACK);
    await expect(external(page, 'Board meeting')).toBeVisible();
  });

  test('a refresh brings each account its own changes, and a calendar read again whole in one is untouched in the other', async ({ page, context, id }) => {
    const other = await both(page, id);
    const [mine, theirs] = [await part(page, ME), await part(page, THEM)];

    // Something changes in the first account, under ids the second account has too.
    await google.changes(id, { calendarId: 'work@example.test', upsert: [{ id: 'sync_1', summary: 'Weekly sync (moved)', start: { dateTime: ist('2026-10-07', '11:00') }, end: { dateTime: ist('2026-10-07', '12:00') } }], cancel: ['sync_2'] });
    await refresh(page);
    // Both accounts were asked only for what changed.
    expect(await modes(id, 2)).toEqual(['me@example.test changes', 'work@example.test changes']);
    expect(await modes(other, 3)).toEqual(['b@example.test changes', 'holidays@example.test changes', 'work@example.test changes']);
    await expect(external(page, 'Weekly sync (moved)')).toContainText('11:00 – 12:00');
    expect((await copy(page))[ME].events).toEqual(['Dentist', 'Mum’s birthday', 'Trip to Izmir', 'Weekly sync (moved)']);
    // The second account's sync_1 and sync_2 are exactly what they were.
    expect(await part(page, THEM)).toBe(theirs);
    await expect(external(page, 'Board meeting')).toContainText('13:00 – 14:00');

    // Now the other way round.
    const changed = await part(page, ME);
    await google.changes(other, { calendarId: 'work@example.test', upsert: [{ id: 'sync_3', summary: 'Board review', start: { dateTime: ist('2026-10-09', '10:00') }, end: { dateTime: ist('2026-10-09', '11:00') } }], cancel: ['sync_1'] });
    await google.changes(other, { calendarId: THEM, cancel: ['dentist'] });
    await refresh(page);
    expect((await copy(page))[THEM].events).toEqual(['Board dinner', 'Board review', 'Company day off']);
    expect(await part(page, ME)).toBe(changed);
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(external(page, 'Weekly sync (moved)')).toBeVisible();
    await expect(event(page, 'Board meeting')).toHaveCount(0);
    await expect(event(page, 'Physio')).toHaveCount(0);
    expect(mine).not.toBe(changed);

    // Google lets the first account's cursors lapse: its calendars are read again whole, which
    // clears what the device held of them first. The second account's calendar of the same id
    // is not among what is cleared.
    const untouched = await part(page, THEM);
    await google.becomes(id, { staleCursors: true });
    await refresh(page);
    expect(await modes(id, 4)).toEqual(['me@example.test everything', 'me@example.test stale cursor', 'work@example.test everything', 'work@example.test stale cursor']);
    expect(await modes(other, 3)).toEqual(['b@example.test changes', 'holidays@example.test changes', 'work@example.test changes']);
    expect((await copy(page))[ME].events).toEqual(['Dentist', 'Mum’s birthday', 'Trip to Izmir', 'Weekly sync (moved)']);
    expect(await part(page, THEM)).toBe(untouched);
    await google.becomes(id, { staleCursors: false });

    // All of it is there with no connection at all, account by account.
    await closeDrawer(page);
    await page.evaluate(async () => void (await navigator.serviceWorker.ready));
    await context.setOffline(true);
    await reload(page);
    for (const title of ['Dentist', 'Weekly sync (moved)', 'Board dinner', 'Board review']) await expect(external(page, title)).toBeVisible();
    await expect(allDay(page, 'Company day off')).toBeVisible();
    await openCalendars(page);
    await expect(group(page, ME).getByRole('switch')).toHaveCount(3);
    await expect(group(page, THEM).getByRole('switch')).toHaveCount(3);
    await refresh(page);
    await expect(view(page).getByRole('status')).toHaveText('You seem to be offline, so your calendars couldn’t be read. Try again once you’re back online.');
    await expect(page.getByText(/reconnect|sign in/i)).toHaveCount(0);
    expect(await part(page, THEM)).toBe(untouched);
    await context.setOffline(false);
  });
});

test.describe('one account in trouble', () => {
  test('Google failing for one account does not stop the other being read, and Refresh names only that one', async ({ page, id }) => {
    const other = await both(page, id);
    for (const fail of ['unavailable', 'limited', 'disabled'] as const) {
      await google.becomes(id, { fail });
      await google.changes(other, { calendarId: THEM, upsert: [{ id: fail, summary: `Added while ${fail}`, start: { dateTime: ist('2026-10-09', '09:00') }, end: { dateTime: ist('2026-10-09', '10:00') } }] });
      await refresh(page);
      // The account Google would not answer for keeps what was read of it. The other one is up to date.
      await expect(external(page, `Added while ${fail}`)).toBeVisible();
      await expect(external(page, 'Dentist')).toBeVisible();
      await expect(view(page).getByRole('status')).toHaveText(`Couldn’t read ${ME} just now. Try again in a moment.`);
      await expect(page.getByText(/reconnect|sign in/i)).toHaveCount(0);
      expect((await listed(page)).map((entry) => entry.state)).toEqual(['busy', 'ok']);
    }
    expect((await copy(page))[ME]).toEqual({ status: 'connected', calendars: ['Holidays (hidden)', 'Personal', 'Work'], events: MINE });

    // And the other way round: the first account is read while the second cannot be.
    await google.becomes(id, { fail: null });
    await google.becomes(other, { fail: 'unavailable' });
    await google.changes(id, { calendarId: ME, cancel: ['dentist'] });
    await refresh(page);
    await expect(event(page, 'Dentist')).toHaveCount(0);
    await expect(external(page, 'Board meeting')).toBeVisible();
    await expect(view(page).getByRole('status')).toHaveText(`Couldn’t read ${THEM} just now. Try again in a moment.`);
    // Both at once: one line, naming both, as Calendars lists them.
    await google.becomes(id, { fail: 'unavailable' });
    await refresh(page);
    await expect(view(page).getByRole('status')).toHaveText(`Couldn’t read ${THEM} and ${ME} just now. Try again in a moment.`);
  });

  test('Google refusing one account says so of that account, the other carries on, and reconnecting mends the one', async ({ page, id }) => {
    const other = await both(page, id);
    await addEvent(page, 'My own event', '16:00', '2026-10-08');
    const [first, secondOne] = await listed(page);
    const theirs = await part(page, THEM);

    // The permission is withdrawn in the first Google account. Something changes in the second.
    await google.becomes(id, { revoked: true });
    await google.changes(other, { calendarId: THEM, upsert: [{ id: 'new', summary: 'Added meanwhile', start: { dateTime: ist('2026-10-09', '09:00') }, end: { dateTime: ist('2026-10-09', '10:00') } }] });
    await refresh(page);

    // Said of the one account, under its address. The other is read as usual, and can be refreshed.
    await expect(group(page, ME)).toContainText('Needs reconnecting');
    await expect(group(page, ME).getByRole('button', { name: `Reconnect ${ME}` })).toBeVisible();
    await expect(group(page, THEM)).not.toContainText('Needs reconnecting');
    await expect(view(page).getByRole('button', { name: 'Reconnect' })).toHaveCount(1);
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toBeEnabled();
    await expect(external(page, 'Added meanwhile')).toBeVisible();
    // What was read of the refused account stays on screen, and Koyomi's own calendar is as it was.
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(event(page, 'My own event')).toBeVisible();
    expect((await copy(page))[ME]).toEqual({ status: 'reconnect', calendars: ['Holidays (hidden)', 'Personal', 'Work'], events: MINE });
    expect((await listed(page)).map((entry) => [entry.account, entry.state])).toEqual([[null, 'reconnect'], [THEM, 'ok']]);
    await expect(page.getByText(/sign in/i)).toHaveCount(0);

    // With the drawer closed, one quiet line; and it stays through a reload, with both accounts' events.
    await closeDrawer(page);
    const line = page.getByRole('button', { name: 'Google Calendar needs reconnecting' });
    await expect(line).toBeVisible();
    await reload(page);
    await expect(line).toBeVisible();
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(external(page, 'Board meeting')).toBeVisible();
    // The refused account is not asked about again, and its address is still known here.
    const asked = (await google.asked(id)).log.length;
    await refresh(page);
    expect((await google.asked(id)).log.length).toBe(asked);
    await expect(group(page, ME)).toContainText('Needs reconnecting');

    // Reconnect: Google again, for that account. It is mended in place.
    const mended = await part(page, THEM);
    await google.changes(id, { calendarId: ME, cancel: ['dentist'] });
    await pick(page, id);
    await group(page, ME).getByRole('button', { name: 'Reconnect' }).click();
    await expect(view(page).getByText(/^Read \d/)).toBeVisible(BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(page.getByText(/needs reconnecting/i)).toHaveCount(0);
    await expect(view(page).getByRole('group')).toHaveCount(2);
    await expect(event(page, 'Dentist')).toHaveCount(0);
    // The same two connections as before, and the other account neither asked for consent nor rewritten.
    expect((await listed(page)).map((entry) => [entry.connectionId, entry.account, entry.state])).toEqual([[first.connectionId, ME, 'ok'], [secondOne.connectionId, THEM, 'ok']]);
    expect(await grants(other)).toEqual(['consent', 'grant', 'account']);
    expect(await grants(id)).toEqual(['consent', 'grant', 'account', 'consent', 'grant', 'account']);
    expect(await part(page, THEM)).toBe(mended);
    expect(theirs).not.toBe(mended);
    await expect(event(page, 'My own event')).toBeVisible();
  });
});

test.describe('disconnecting one account', () => {
  const OWN = {
    events: [{ id: 'mine', title: 'My own event', start: '2026-10-07T14:00:00.000Z', end: '2026-10-07T15:00:00.000Z', allDay: false, category: 'work' as const, recurrence: null, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' }],
  };

  test('ends that account alone: the other, the sign-in and Koyomi’s own calendar are as they were', async ({ page, context, id }) => {
    await seed(page, OWN);
    const other = await both(page, id);
    const own = JSON.stringify(await stored(page));
    const theirs = await part(page, THEM);
    const [, secondOne] = await listed(page);

    await disconnectButton(page, ME).click();
    await expect(group(page, ME)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);

    // On screen: the first account's calendars and events are gone. The second account's are not.
    await expect(view(page).getByRole('group')).toHaveCount(1);
    await expect(group(page, THEM).getByRole('switch')).toHaveText(['Personal✓', 'Holidays✓', 'Work✓']);
    await expect(nothingConnected(page)).toHaveCount(0);
    for (const title of ['Dentist', 'Weekly sync', 'Trip to Izmir', 'Mum’s birthday']) await expect(event(page, title)).toHaveCount(0);
    for (const title of ['Board meeting', 'Physio']) await expect(external(page, title)).toBeVisible();
    await expect(event(page, 'My own event')).toBeVisible();
    // At Google: the first account's permission is withdrawn, the second's is not.
    expect(await grants(id)).toEqual(['consent', 'grant', 'account', 'revoke']);
    expect([(await google.asked(id)).revoked, (await google.asked(id)).liveTokens]).toEqual([true, 0]);
    expect(await grants(other)).toEqual(['consent', 'grant', 'account']);
    expect((await google.asked(other)).revoked).toBe(false);
    // On the server: one connection left, the same one, and the device is still signed in.
    expect((await context.cookies()).some((cookie) => cookie.name === 'koyomi_session')).toBe(true);
    expect((await listed(page)).map((entry) => [entry.connectionId, entry.account, entry.state])).toEqual([[secondOne.connectionId, THEM, 'ok']]);
    // On the device: nothing of the first account, and the second account's part to the letter.
    expect(await copy(page)).toEqual({ [THEM]: { status: 'connected', calendars: ['Holidays', 'Personal', 'Work'], events: THEIRS } });
    expect(await part(page, THEM)).toBe(theirs);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBe('connected');
    expect(JSON.stringify(await stored(page))).toBe(own);

    // The account that is left goes on being read, and it all holds after a reload.
    await google.changes(other, { calendarId: 'work@example.test', cancel: ['sync_2'] });
    await refresh(page);
    await expect(event(page, 'Board dinner')).toHaveCount(0);
    await reload(page);
    await expect(external(page, 'Board meeting')).toBeVisible();
    await expect(event(page, 'Dentist')).toHaveCount(0);
    await expect(event(page, 'My own event')).toBeVisible();

    // The first account can be added again beside it, as a connection of its own.
    await connectAlso(page, id, ME);
    await expect(view(page).getByRole('group')).toHaveCount(2);
    expect((await copy(page))[ME].events).toEqual(MINE);
    expect((await listed(page)).find((entry) => entry.account === THEM)!.connectionId).toBe(secondOne.connectionId);

    // Disconnecting the last account is the end of it all: no copy, no note, no sign-in.
    await disconnectButton(page, ME).click();
    await expect(group(page, ME)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await disconnectButton(page, THEM).click();
    await expect(nothingConnected(page)).toBeVisible(BACK);
    await expect(page.locator('[data-external]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();
    expect((await context.cookies()).some((cookie) => cookie.name === 'koyomi_session')).toBe(false);
    expect((await google.asked(other)).revoked).toBe(true);
    expect(JSON.stringify(await stored(page))).toBe(own);
  });

  test('works after the sign-in has lapsed: sign in, then that account alone is ended', async ({ page, context, id }) => {
    const other = await both(page, id);
    await context.clearCookies({ name: 'koyomi_session' });
    await disconnectButton(page, THEM).click();

    await expect.poll(async () => (await google.asked(other)).revoked, BACK).toBe(true);
    expect(new URL(page.url()).search).toBe('');
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(event(page, 'Board meeting')).toHaveCount(0);
    await expect.poll(() => copy(page)).toEqual({ [ME]: { status: 'connected', calendars: ['Holidays (hidden)', 'Personal', 'Work'], events: MINE } });
    // Signed in again by it, so the account that is left is simply connected: nothing asks to sign in.
    expect((await google.asked(id)).revoked).toBe(false);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBe('connected');
    await expect(page.getByText(/sign in again|reconnect/i)).toHaveCount(0);
  });
});

// A reading takes a moment. In each of these Google keeps one account's answer back until the
// test lets go (refreshAndHold), so what happens to an account happens while its reading, or the
// other account's, is under way: every time, on any machine.
test.describe('while a refresh is under way', () => {
  /** The answer a tab was waiting for, about one account's events, has arrived in full. */
  const answerOf = (page: Page) => page.waitForResponse((response) => response.url().endsWith('/api/calendars/events'));

  test('a calendar hidden in one account stays hidden, and the other account’s calendar of the same id is read all the same', async ({ page, id }) => {
    const other = await both(page, id);
    await google.changes(id, { calendarId: 'work@example.test', upsert: [{ id: 'standup', summary: 'Standup', start: { dateTime: ist('2026-10-08', '11:00') }, end: { dateTime: ist('2026-10-08', '11:30') } }] });
    await google.changes(other, { calendarId: 'work@example.test', upsert: [{ id: 'standup', summary: 'Board standup', start: { dateTime: ist('2026-10-08', '12:00') }, end: { dateTime: ist('2026-10-08', '12:30') } }] });

    // The second account's answer is on its way. Meanwhile Work is hidden in both accounts, and
    // then shown again in the first.
    await refreshAndHold(page, other, 'events');
    await toggle(page, 'Work', THEM).click();
    await expect(toggle(page, 'Work', THEM)).toHaveAttribute('aria-checked', 'false');
    await expect(event(page, 'Board meeting')).toHaveCount(0);
    await toggle(page, 'Work', ME).click();
    await toggle(page, 'Work', ME).click();
    await expect(toggle(page, 'Work', ME)).toHaveAttribute('aria-checked', 'true');

    await google.becomes(other, { hold: null });
    await expect(external(page, 'Standup')).toBeVisible(BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    // The second account's Work is as the person left it: hidden, with nothing of it kept.
    await expect(toggle(page, 'Work', THEM)).toHaveAttribute('aria-checked', 'false');
    await expect(event(page, 'Board standup')).toHaveCount(0);
    await expect(event(page, 'Board meeting')).toHaveCount(0);
    // The first account's Work, hidden and shown again meanwhile, was read whole and is all there.
    await expect.poll(() => copy(page)).toEqual({
      [ME]: { status: 'connected', calendars: ['Holidays (hidden)', 'Personal', 'Work'], events: [...MINE, 'Standup'].sort() },
      [THEM]: { status: 'connected', calendars: ['Holidays', 'Personal', 'Work (hidden)'], events: ['Company day off', 'Physio'] },
    });
    await reload(page);
    await expect(external(page, 'Standup')).toBeVisible();
    await expect(event(page, 'Board standup')).toHaveCount(0);
  });

  test('Disconnect of one account in another tab: its late answer brings nothing back, and the other account is still read', async ({ page, context, id }) => {
    const other = await both(page, id);
    const elsewhere = await context.newPage();
    await start(elsewhere);
    await openCalendars(elsewhere);
    await expect(group(elsewhere, ME)).toBeVisible();
    await google.changes(other, { calendarId: THEM, upsert: [{ id: 'new', summary: 'Added meanwhile', start: { dateTime: ist('2026-10-09', '09:00') }, end: { dateTime: ist('2026-10-09', '10:00') } }] });
    const theirs = (await listed(page))[1].connectionId;

    // The first tab is refreshing, and Google is keeping the first account's answer back.
    await refreshAndHold(page, id, 'events');
    const answered = answerOf(page);

    // The other tab disconnects that account, and that is finished: its part of the copy is gone.
    await disconnectButton(elsewhere, ME).click();
    await expect(group(elsewhere, ME)).toHaveCount(0, BACK);
    await expect.poll(async () => Object.keys(await copy(elsewhere))).toEqual([THEM]);
    await expect(group(page, ME)).toHaveCount(0);
    await expect(page.locator('[data-external]', { hasText: /Dentist|Weekly sync/ })).toHaveCount(0);

    // Now the answer the first tab was waiting for arrives, events and all.
    await google.becomes(id, { hold: null });
    expect((await answered).status()).toBe(200);
    await (await answered).finished();

    // The account is not back, in either tab or on the device. The other account is all there,
    // up to date, under the connection it always had.
    await expect.poll(async () => (await copy(page))[THEM]?.events, BACK).toEqual([...THEIRS, 'Added meanwhile'].sort());
    expect(Object.keys(await copy(page))).toEqual([THEM]);
    expect((await cached(page)).events.every((kept) => kept.connectionId === theirs)).toBe(true);
    for (const tab of [page, elsewhere]) {
      await expect(view(tab).getByRole('group')).toHaveCount(1);
      await expect(group(tab, THEM).getByRole('switch')).toHaveCount(3);
      await expect(tab.locator('[data-external]', { hasText: /Dentist|Weekly sync|Trip to Izmir|Mum/ })).toHaveCount(0);
      await expect(external(tab, 'Added meanwhile')).toBeVisible(BACK);
      await expect(tab.getByText(/sign in again|reconnect/i)).toHaveCount(0);
    }
    expect((await google.asked(id)).revoked).toBe(true);
    expect((await google.asked(other)).revoked).toBe(false);
    await reload(page);
    await expect(external(page, 'Board meeting')).toBeVisible();
    await expect(page.locator('[data-external]', { hasText: 'Dentist' })).toHaveCount(0);
  });

  test('coming back from Google in another tab: a reading begun before is let go, and asks for nothing more', async ({ page, context, id }) => {
    const other = await both(page, id);
    const elsewhere = await context.newPage();
    await start(elsewhere);
    await openCalendars(elsewhere);
    await expect(group(elsewhere, ME)).toBeVisible();
    const marks = async () => Object.fromEntries((await cached(page)).connections.map((connection) => [connection.account, connection.epoch]));
    const before = await marks();

    // The first tab is refreshing: the first account's answer is on its way, the second's not yet asked for.
    await refreshAndHold(page, id, 'events');
    const answered = answerOf(page);
    const asked: string[] = [];
    page.on('request', (request) => void (CALENDAR_API.test(new URL(request.url()).pathname) && asked.push(new URL(request.url()).pathname)));

    // In the other tab the first account is connected again: to Google and back. Every account's
    // part of the copy begins again, so that nothing asked before the trip is kept after it.
    await pick(elsewhere, id);
    await addAt(elsewhere, 'Google');
    await expect.poll(async () => Object.values(await marks()).every((mark, i) => mark !== Object.values(before)[i]), BACK).toBe(true);
    expect(Object.keys(await marks()).sort()).toEqual([THEM, ME]);

    // The first tab's answer arrives. It was for the copy as it was, and its tab stands down:
    // it does not go on to ask about the second account.
    await google.becomes(id, { hold: null });
    await (await answered).finished();
    await page.evaluate(() => 0);
    expect(asked.filter((path) => path === '/api/calendars/events')).toEqual([]);

    // Both accounts are there, once each, read by the tab that came back.
    await expect(view(elsewhere).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect.poll(() => copy(page), BACK).toEqual({
      [ME]: { status: 'connected', calendars: ['Holidays (hidden)', 'Personal', 'Work'], events: MINE },
      [THEM]: { status: 'connected', calendars: ['Holidays', 'Personal', 'Work'], events: THEIRS },
    });
    for (const tab of [page, elsewhere]) {
      await expect(view(tab).getByRole('group')).toHaveCount(2);
      await expect(external(tab, 'Dentist')).toHaveCount(1);
      await expect(external(tab, 'Board meeting')).toHaveCount(1);
    }
    expect((await google.asked(other)).log.filter((entry) => entry.type === 'consent')).toHaveLength(1);
  });
});

test.describe('whose accounts they are', () => {
  test('someone else signing in on the device gets neither account, and the first person finds both again', async ({ page, id }) => {
    const other = await both(page, id);
    const mine = (await listed(page)).map((entry) => entry.connectionId);

    // A different person signs in here. They have nothing connected.
    await page.context().clearCookies({ name: 'koyomi_session' });
    await actAs(page, `someone-else-${id}`);
    await page.goto(`/api/auth/signin?returnTo=${encodeURIComponent('/?calendars=resume')}`);
    await expect(page.getByText('koyomi', { exact: true })).toBeVisible();
    await expect(page.locator('[data-external]')).toHaveCount(0, BACK);
    await expect.poll(() => page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();
    expect(await listed(page)).toEqual([]);
    // They cannot read or end either of the first person's connections by naming it.
    const ask = { timeMin: '2026-10-01T00:00:00Z', timeMax: '2026-11-01T00:00:00Z', calendars: [{ calendarId: 'work@example.test', syncToken: null }] };
    for (const connectionId of mine) {
      const reached = await page.request.post('/api/calendars/events', { data: { ...ask, connectionId }, headers: { origin: APP } });
      expect([reached.status(), await reached.json()]).toEqual([409, { error: 'not_connected' }]);
    }
    // Nothing was revoked or deleted on the first person's behalf.
    expect([(await google.asked(id)).revoked, (await google.asked(other)).revoked]).toEqual([false, false]);

    // The first person comes back. Both connections are where they were: no consent screen for either.
    await page.context().clearCookies({ name: 'koyomi_session' });
    await actAs(page, `user-${id}`);
    await openCalendars(page);
    await addAt(page, 'Google');
    await expect(group(page, THEM)).toBeVisible(BACK);
    await expect(group(page, ME)).toBeVisible();
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    expect((await listed(page)).map((entry) => entry.connectionId)).toEqual(mine);
    expect(await grants(id)).toEqual(['consent', 'grant', 'account']);
    expect(await grants(other)).toEqual(['consent', 'grant', 'account']);
    expect(await copy(page)).toEqual({
      [ME]: { status: 'connected', calendars: ['Holidays (hidden)', 'Personal', 'Work'], events: MINE },
      [THEM]: { status: 'connected', calendars: ['Holidays', 'Personal', 'Work'], events: THEIRS },
    });
  });

  test('someone else with the same Google account connected has a connection of their own', async ({ page, browser, id }) => {
    // Two people, each signed in as themselves, both connect the first Google account.
    await start(page);
    await connect(page);
    const elsewhere = await browser.newContext({ timezoneId: 'Europe/Istanbul' });
    await elsewhere.addCookies([
      { name: 'fake_user', value: `someone-else-${id}`, url: FAKE },
      { name: 'fake_google', value: id, url: FAKE },
    ]);
    const theirs = await elsewhere.newPage();
    await start(theirs);
    await connect(theirs);

    const [mine, other] = [await listed(page), await listed(theirs)];
    expect([mine.length, other.length]).toEqual([1, 1]);
    expect(mine[0].account).toBe(other[0].account);
    expect(mine[0].connectionId).not.toBe(other[0].connectionId);
    await elsewhere.close();
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('Calendars with two accounts, one of them needing reconnecting, is easy to read', async ({ page, id }) => {
      await both(page, id);
      await page.evaluate(() => document.fonts.ready);
      await check(page, 'Calendars with two accounts');
      await google.becomes(id, { revoked: true });
      await refresh(page);
      await expect(group(page, ME)).toContainText('Needs reconnecting');
      await check(page, 'Calendars with an account needing reconnecting');
      await closeDrawer(page);
      await external(page, 'Board meeting').click();
      await check(page, 'an event from a second account open');
    });
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('both accounts are in the sheet from the bar at the foot, each with its own calendars', async ({ page, id }) => {
    await both(page, id);
    await page.evaluate(() => document.fonts.ready);
    await expect(group(page, ME).getByRole('switch')).toHaveCount(3);
    await expect(group(page, THEM).getByRole('switch')).toHaveCount(3);
    await check(page, 'Calendars with two accounts on a phone');
    // Nothing runs off the side: a long address is cut short, not wrapped or scrolled.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await toggle(page, 'Work', ME).tap();
    await expect(toggle(page, 'Work', ME)).toHaveAttribute('aria-checked', 'false');
    await closeDrawer(page);

    // The bar says how many calendars from elsewhere are on screen beside Koyomi's own.
    await expect(page.getByRole('button', { name: /^Calendars/ })).toContainText('Koyomi and 4 more');
    await expect(external(page, 'Board meeting')).toBeVisible();
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(event(page, 'Weekly sync')).toHaveCount(0);
    await external(page, 'Board meeting').tap();
    await expect(popover(page)).toContainText(`Google Calendar · Work${THEM}`);
    await check(page, 'an event from a second account open on a phone');
  });
});
