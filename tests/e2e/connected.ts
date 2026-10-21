import { expect, test as base, type Page } from '@playwright/test';
import { calendars, calendarsButton, open } from './helpers';

// What the tests of connected calendars share: made-up Google accounts, a made-up 6Away
// identity, and the steps of connecting. Everything runs against stand-ins for 6Away Auth and
// Google (tests/fakes/providers.mjs, started by playwright.config.ts). No real account is ever
// involved.

export const FAKE = 'http://localhost:4315';
/** Wednesday 7 October 2026, 13:10 in Istanbul, where the calendar in most of these tests is. */
export const NOW = new Date('2026-10-07T10:10:00Z');
export const ist = (day: string, time: string) => `${day}T${time}:00+03:00`;

/** The first account's address: the id of its own calendar, which is how Koyomi knows an account. */
export const ME = 'me@example.test';

/** A Google account with two calendars in use and one that is not ticked. */
export const account = () => ({
  calendars: [
    {
      id: ME,
      summary: 'Personal',
      primary: true,
      selected: true,
      events: [
        {
          id: 'dentist',
          summary: 'Dentist',
          htmlLink: 'https://www.google.com/calendar/event?eid=dentist',
          updated: '2026-10-01T10:00:00.000Z',
          start: { dateTime: ist('2026-10-07', '15:00'), timeZone: 'Europe/Istanbul' },
          end: { dateTime: ist('2026-10-07', '16:00'), timeZone: 'Europe/Istanbul' },
          // Things Koyomi has no business reading. None of it may reach the browser.
          description: 'PRIVATE NOTES',
          location: 'PRIVATE PLACE',
          attendees: [{ email: 'someone@private.test' }, { self: true, responseStatus: 'accepted' }],
        },
        { id: 'trip', summary: 'Trip to Izmir', start: { date: '2026-10-08' }, end: { date: '2026-10-11' } },
        { id: 'birthday', summary: 'Mum’s birthday', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } },
      ],
    },
    {
      id: 'work@example.test',
      summary: 'Work',
      selected: true,
      events: [
        // One repeating meeting, as Google hands it over: an event per time it happens.
        { id: 'sync_1', recurringEventId: 'sync', summary: 'Weekly sync', start: { dateTime: ist('2026-10-07', '10:00') }, end: { dateTime: ist('2026-10-07', '11:00') } },
        { id: 'sync_2', recurringEventId: 'sync', summary: 'Weekly sync', start: { dateTime: ist('2026-10-14', '10:00') }, end: { dateTime: ist('2026-10-14', '11:00') } },
        { id: 'declined', summary: 'Declined meeting', start: { dateTime: ist('2026-10-07', '12:00') }, end: { dateTime: ist('2026-10-07', '13:00') }, attendees: [{ self: true, responseStatus: 'declined' }] },
      ],
    },
    {
      id: 'holidays@example.test',
      summary: 'Holidays',
      selected: false,
      events: [{ id: 'holiday', summary: 'Republic Day', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } }],
    },
  ],
});

const post = (path: string, body: unknown, method = 'POST') => fetch(`${FAKE}/__fake/google/${path}`, { method, body: JSON.stringify(body) });
export const google = {
  /** Sets up what a Google account holds. */
  has: (id: string, data: unknown) => post(id, data, 'PUT'),
  /** Something changes at Google after Koyomi last looked. */
  changes: (id: string, change: { calendarId: string; upsert?: unknown[]; cancel?: string[] }) => post(`${id}/change`, change),
  /** Google starts refusing, failing, or forgetting. */
  becomes: (
    id: string,
    state: { revoked?: boolean; fail?: null | 'unavailable' | 'limited' | 'disabled'; staleCursors?: boolean; delay?: number; hold?: null | 'calendars' | 'events'; removeCalendar?: string },
  ) => post(`${id}/state`, state),
  /** Everything the app has asked of this account, and how many questions Google is keeping waiting. */
  asked: async (id: string) => (await (await fetch(`${FAKE}/__fake/google/${id}`)).json()) as { log: Record<string, string>[]; revoked: boolean; liveTokens: number; held: number },
  /** Every attempt to trade one code for tokens, and why it was refused if it was. */
  exchanges: async (code: string) => (await (await fetch(`${FAKE}/__fake/exchanges?code=${encodeURIComponent(code)}`)).json()) as { code: string; refused: string | null }[],
};

/** New on every run, so nothing a previous run left on the servers can be mistaken for this one's. */
const RUN = Date.now().toString(36);

/** Each test has a Google account and a 6Away identity of its own, chosen by cookies on the stand-in. */
export const test = base.extend<{ id: string }>({
  // Most of these tests are about a calendar in Istanbul. Ones about other zones say so.
  timezoneId: 'Europe/Istanbul',
  id: [
    async ({ context }, use, testInfo) => {
      const id = `a${testInfo.testId.replace(/[^a-z0-9]/gi, '')}x${testInfo.repeatEachIndex}r${RUN}`;
      await google.has(id, account());
      await context.addCookies([
        { name: 'fake_user', value: `user-${id}`, url: FAKE },
        { name: 'fake_google', value: id, url: FAKE },
      ]);
      await use(id);
    },
    // Set up for every test, whether or not it asks for the id.
    { auto: true },
  ],
});

export const view = calendars;
/** One connected account in Calendars, by its address: its calendars, and its own Disconnect. */
export const group = (page: Page, address: string) => view(page).getByRole('group', { name: address, exact: true });
/** A calendar's on/off row. Where two accounts have a calendar of the same name, say which account. */
export const toggle = (page: Page, name: string, address?: string) => (address ? group(page, address) : view(page)).getByRole('switch', { name });
export const addButton = (page: Page) => view(page).getByRole('button', { name: 'Add calendar account' });
/** Where to add an account, once Add calendar account has been pressed: the two quiet choices under it. */
export const choice = (page: Page, provider: 'Google' | 'Microsoft') => view(page).getByRole('button', { name: provider, exact: true });
/** Adds an account at a provider, as a person does it: Add calendar account, then which provider. */
export async function addAt(page: Page, provider: 'Google' | 'Microsoft') {
  await addButton(page).click();
  await choice(page, provider).click();
}
/** The server's addresses for connected calendars, at every provider. */
export const CALENDAR_API = /^\/api\/(google|microsoft|calendars)(\/|$)/;
export const disconnectButton = (page: Page, address?: string) => (address ? group(page, address) : view(page)).getByRole('button', { name: /^Disconnect/ });
/** What Calendars says while no account is connected: the sentence about what adding one means. */
export const nothingConnected = (page: Page) => view(page).getByText('It can never change them.');
export const external = (page: Page, title: string) => page.locator('[data-event][data-external]', { hasText: title });
export const allDay = (page: Page, title: string) => page.locator('[data-all-day] [data-event]', { hasText: title });
export const mobile = (page: Page) => page.viewportSize()!.width < 760;
/** A day's cell in the month, by its number and something on it. */
export const cell = (page: Page, day: number, has: string) => page.getByRole('button', { name: new RegExp(`^${day}\\D.*${has}`) });

export async function start(page: Page) {
  await page.clock.setFixedTime(NOW);
  await open(page);
}

/** One account's own line in Calendars, which opens and folds it. */
export const accountLine = (page: Page, address: string) => group(page, address).locator('[data-account]');

/**
 * Opens every account that is folded. With several accounts connected each starts as one line;
 * the tests that are not about that want to reach their calendars as they always could.
 */
export async function unfold(page: Page) {
  const folded = view(page).locator('[data-account][aria-expanded="false"]');
  for (let left = await folded.count(); left > 0; left = await folded.count()) await folded.first().click();
}

/** Opens Calendars, with every account in it opened. */
export async function openCalendars(page: Page) {
  if (!(await view(page).isVisible())) {
    if (mobile(page)) await calendarsButton(page).tap();
    else await page.keyboard.press('c');
    await expect(view(page)).toBeVisible();
  }
  await unfold(page);
}

export async function closeDrawer(page: Page) {
  if (mobile(page)) await page.mouse.click(195, 60);
  else await page.keyboard.press('c');
  await expect(view(page)).toBeHidden();
  // The drawer is gone at once, but the calendar takes a moment more to slide back to its full
  // width, and every column moves while it does. Wait for that slide itself to end, so that
  // positions read next are where things stay.
  await page.evaluate(async () => {
    // Two frames first: the slide begins with the frame after the change that causes it.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sliding = document.getAnimations().filter((animation) => (animation as CSSTransition).transitionProperty === 'padding-right');
    await Promise.all(sliding.map((animation) => animation.finished.catch(() => {})));
  });
}

const postMicrosoft = (path: string, body: unknown, method = 'POST') => fetch(`${FAKE}/__fake/microsoft/${path}`, { method, body: JSON.stringify(body) });
export const microsoft = {
  /** Sets up what a Microsoft account holds: personal or work, its mailbox's address, and its calendars. */
  has: (id: string, data: unknown) => postMicrosoft(id, data, 'PUT'),
  /** Something changes at Microsoft after Koyomi last looked. */
  changes: (id: string, change: { calendarId: string; upsert?: unknown[]; cancel?: string[] }) => postMicrosoft(`${id}/change`, change),
  /** Microsoft starts refusing, failing, asking to wait, or forgetting. */
  becomes: (
    id: string,
    state: {
      revoked?: boolean;
      fail?: null | 'unavailable' | 'throttled' | 'nomailbox' | 'mfa' | 'secret';
      delay?: number;
      hold?: null | 'calendars' | 'events';
      pageSize?: number;
      foreignNext?: boolean;
      removeCalendar?: string;
      deny?: string;
    },
  ) => postMicrosoft(`${id}/state`, state),
  /** Everything the app has asked of this account, and how many questions Microsoft is keeping waiting. */
  asked: async (id: string) =>
    (await (await fetch(`${FAKE}/__fake/microsoft/${id}`)).json()) as { log: Record<string, string | null>[]; revoked: boolean; liveTokens: number; held: number; kind: string; tenant: string },
};
/** Which Microsoft account is at the keyboard the next time Microsoft asks: what picking one from Microsoft's own list comes to. */
export const pickMicrosoft = (page: Page, account: string) => page.context().addCookies([{ name: 'fake_microsoft', value: account, url: FAKE }]);

/** Adds a Microsoft account beside whatever is connected, and waits until it is listed under its own address with its events read. */
export async function connectMicrosoft(page: Page, account: string, address: string) {
  await pickMicrosoft(page, account);
  await openCalendars(page);
  await addAt(page, 'Microsoft');
  await expect(group(page, address)).toBeVisible({ timeout: 15_000 });
  await unfold(page);
  await expect(group(page, address).getByRole('switch').first()).toBeVisible();
  await expect(view(page).getByText('Refreshing…')).toHaveCount(0, { timeout: 15_000 });
}

/** A time in Istanbul as Microsoft Graph writes it when asked for UTC: the UTC wall clock, no offset. */
export const graphTime = (day: string, time: string) => `${new Date(ist(day, time)).toISOString().slice(0, 19)}.0000000`;

/** Which Google account is at the keyboard the next time Google asks: what picking one from Google's own list comes to. */
export const pick = (page: Page, googleAccount: string) => page.context().addCookies([{ name: 'fake_google', value: googleAccount, url: FAKE }]);

/** Adds an account and comes back from the stand-ins signed in, with its calendars listed. */
export async function connect(page: Page) {
  await openCalendars(page);
  await addAt(page, 'Google');
  // Two round trips and a first reading: allow for a busy machine. Beside another account it
  // arrives folded, so it is opened as it comes.
  await expect
    .poll(async () => {
      await unfold(page);
      return toggle(page, 'Personal').count();
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(toggle(page, 'Personal')).toBeVisible();
  await expect(view(page).getByText(/^Read \d/)).toBeVisible();
}

/**
 * Adds one more Google account beside whatever is connected, and waits until it is listed under
 * its own address with its events read.
 */
export async function connectAlso(page: Page, googleAccount: string, address: string) {
  await pick(page, googleAccount);
  await openCalendars(page);
  await addAt(page, 'Google');
  await expect(group(page, address)).toBeVisible({ timeout: 15_000 });
  await unfold(page);
  await expect(group(page, address).getByRole('switch').first()).toBeVisible();
  await expect(view(page).getByText('Refreshing…')).toHaveCount(0, { timeout: 15_000 });
}

/** Signs in with 6Away and nothing more: a Koyomi session, no Google. */
export async function signInOnly(page: Page) {
  await page.goto('/api/auth/signin?returnTo=%2F');
  await expect(page.getByText('koyomi', { exact: true })).toBeVisible();
}

/** Becomes someone else as far as the stand-in for 6Away is concerned. */
export const actAs = (page: Page, user: string) => page.context().addCookies([{ name: 'fake_user', value: user, url: FAKE }]);

export async function refresh(page: Page) {
  await openCalendars(page);
  await view(page).getByRole('button', { name: 'Refresh' }).click();
  await expect(view(page).getByText('Refreshing…')).toHaveCount(0);
}

/**
 * Presses Refresh with Google keeping one kind of answer back for one account, and returns once
 * Google has been asked. From then until `google.becomes(id, { hold: null })` the reading is
 * under way, and stays so: what a test does in between does not depend on how fast anything is.
 */
export async function refreshAndHold(page: Page, id: string, hold: 'calendars' | 'events') {
  await openCalendars(page);
  await google.becomes(id, { hold });
  await view(page).getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(async () => (await google.asked(id)).held, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(view(page).getByText('Refreshing…')).toBeVisible();
}

/** This device's copy of the connected calendars, read straight from its own database. */
export const cached = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ connections: any[]; calendars: any[]; events: any[] }>((resolve) => {
        const open = indexedDB.open('koyomi-external');
        open.onsuccess = () => {
          const tx = open.result.transaction(['connections', 'calendars', 'events']);
          const connections = tx.objectStore('connections').getAll();
          const calendars = tx.objectStore('calendars').getAll();
          const events = tx.objectStore('events').getAll();
          tx.oncomplete = () => {
            open.result.close();
            resolve({ connections: connections.result, calendars: calendars.result, events: events.result });
          };
        };
      }),
  );

/** The id Koyomi's server gave a connected account, as this device holds it, by the account's address. */
export const connectionId = async (page: Page, address = ME): Promise<string> => (await cached(page)).connections.find((connection) => connection.account === address).id;

/** Everything page code can reach on this device: both kinds of storage, every database, every cache. */
export const everythingStored = (page: Page) =>
  page.evaluate(async () => {
    const cookies = document.cookie.split('; ').filter((cookie) => !cookie.startsWith('fake_'));
    const out: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), ...cookies];
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const open = indexedDB.open(name!);
        open.onsuccess = () => resolve(open.result);
      });
      for (const store of db.objectStoreNames) {
        out.push(JSON.stringify(await new Promise((resolve) => (db.transaction(store).objectStore(store).getAll().onsuccess = (e) => resolve((e.target as IDBRequest).result)))));
      }
      db.close();
    }
    for (const name of await caches.keys()) out.push(...(await (await caches.open(name)).keys()).map((request) => request.url));
    return out.join('\n');
  });
