import { expect, test as base, type Page } from '@playwright/test';
import { open, plan } from './helpers';

// What the tests of connected calendars share: a made-up Google account, a made-up 6Away
// identity, and the steps of connecting. Everything runs against stand-ins for 6Away Auth and
// Google (tests/fakes/providers.mjs, started by playwright.config.ts). No real account is ever
// involved.

export const FAKE = 'http://localhost:4315';
/** Wednesday 7 October 2026, 13:10 in Istanbul, where the calendar in most of these tests is. */
export const NOW = new Date('2026-10-07T10:10:00Z');
export const ist = (day: string, time: string) => `${day}T${time}:00+03:00`;

/** A Google account with two calendars in use and one that is not ticked. */
export const account = () => ({
  calendars: [
    {
      id: 'me@example.test',
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
  /** Sets up what this test's Google account holds. */
  has: (id: string, data: unknown) => post(id, data, 'PUT'),
  /** Something changes at Google after Koyomi last looked. */
  changes: (id: string, change: { calendarId: string; upsert?: unknown[]; cancel?: string[] }) => post(`${id}/change`, change),
  /** Google starts refusing, failing, or forgetting. */
  becomes: (id: string, state: { revoked?: boolean; fail?: null | 'unavailable' | 'limited'; staleCursors?: boolean; delay?: number; removeCalendar?: string }) =>
    post(`${id}/state`, state),
  /** Everything the app has asked of this account. */
  asked: async (id: string) => (await (await fetch(`${FAKE}/__fake/google/${id}`)).json()) as { log: Record<string, string>[]; revoked: boolean; liveTokens: number },
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

export const view = (page: Page) => page.getByRole('region', { name: 'Calendars' });
export const toggle = (page: Page, name: string) => view(page).getByRole('switch', { name });
export const external = (page: Page, title: string) => page.locator('[data-event][data-external]', { hasText: title });
export const allDay = (page: Page, title: string) => page.locator('[data-all-day] [data-event]', { hasText: title });
export const mobile = (page: Page) => page.viewportSize()!.width < 760;
/** A day's cell in the month, by its number and something on it. */
export const cell = (page: Page, day: number, has: string) => page.getByRole('button', { name: new RegExp(`^${day}\\D.*${has}`) });

export async function start(page: Page) {
  await page.clock.setFixedTime(NOW);
  await open(page);
}

export async function openCalendars(page: Page) {
  if (await view(page).isVisible()) return;
  if (!(await plan(page).isVisible())) {
    if (mobile(page)) await page.getByRole('button', { name: /^Plan/ }).tap();
    else await page.keyboard.press('p');
  }
  await plan(page).getByRole('button', { name: /^Calendars/ }).click();
  await expect(view(page)).toBeVisible();
}

export async function closeDrawer(page: Page) {
  if (mobile(page)) await page.mouse.click(195, 60);
  else await page.keyboard.press('p');
  await expect(view(page)).toBeHidden();
}

/** Presses Connect and comes back from the stand-ins signed in, with the calendars listed. */
export async function connect(page: Page) {
  await openCalendars(page);
  await view(page).getByRole('button', { name: 'Connect' }).click();
  // Two round trips and a first reading: allow for a busy machine.
  await expect(toggle(page, 'Personal')).toBeVisible({ timeout: 15_000 });
  await expect(view(page).getByText(/^Read \d/)).toBeVisible();
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

/** This device's copy of the connected calendars, read straight from its own database. */
export const cached = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ calendars: any[]; events: any[] }>((resolve) => {
        const open = indexedDB.open('koyomi-external');
        open.onsuccess = () => {
          const tx = open.result.transaction(['calendars', 'events']);
          const calendars = tx.objectStore('calendars').getAll();
          const events = tx.objectStore('events').getAll();
          tx.oncomplete = () => {
            open.result.close();
            resolve({ calendars: calendars.result, events: events.result });
          };
        };
      }),
  );

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
