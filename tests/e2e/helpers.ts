import { expect, type Page } from '@playwright/test';
import type { CalendarEvent, PlanItem } from '../../lib/types';

// Shared by the browser tests. They run against the production build, so they exercise the real
// service worker and IndexedDB, and every test starts from an empty calendar in its own profile.

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (k: string, n: number) => {
  const [y, m, d] = k.split('-').map(Number);
  return key(new Date(y, m - 1, d + n));
};
export const today = () => key(new Date());
/** Another day in the same Monday-first week as today. */
export const otherDay = () => addDays(today(), (new Date().getDay() + 6) % 7 === 6 ? -1 : 1);

export const event = (page: Page, title: string) => page.locator('[data-event]', { hasText: title });
export const popover = (page: Page) => page.locator('[data-popover]');
export const plan = (page: Page) => page.getByRole('region', { name: 'Plan' });
export const columns = (page: Page) => page.locator('[data-day]');

/** The wordmark in the header: on screen once the calendar has loaded what is saved. */
export const wordmark = (page: Page) => page.getByText('koyomi', { exact: true });

export async function open(page: Page, url = '/') {
  await page.goto(url);
  await expect(wordmark(page)).toBeVisible();
}

/** Reloads and waits until the calendar is on screen and taking keys again. */
export async function reload(page: Page) {
  await page.reload();
  await expect(wordmark(page)).toBeVisible();
}

/** A time of day inside a day's column, scrolled into view. */
export async function at(page: Page, day: string, time: string) {
  const column = page.locator(`[data-day="${day}"]`);
  const [h, m] = time.split(':').map(Number);
  const y = await column.evaluate((el, minutes) => {
    const y = (minutes / 60) * (el.getBoundingClientRect().height / 24);
    el.closest('.overflow-y-auto')!.scrollTop = Math.max(0, y - 250);
    return y;
  }, h * 60 + m);
  return { column, position: { x: 40, y: y + 6 } };
}

export const hourHeight = (page: Page) => columns(page).first().evaluate((el) => el.getBoundingClientRect().height / 24);

/** True when the page itself cannot be scrolled: the calendar fills the window and no more. */
export const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);

export async function addEvent(page: Page, title: string, time: string, day = today()) {
  const { column, position } = await at(page, day, time);
  await column.click({ position });
  await expect(page.getByPlaceholder('What are you doing?')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(event(page, title)).toBeVisible();
}

export async function addToPlan(page: Page, ...titles: string[]) {
  await plan(page).getByRole('button', { name: /Add$/ }).click();
  for (const title of titles) {
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
}

export async function placeFromPlan(page: Page, title: string, time: string, day = today()) {
  await plan(page).getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByText('Choose a time for')).toBeVisible();
  const { column, position } = await at(page, day, time);
  await column.click({ position });
  await expect(event(page, title)).toBeVisible();
}

/** What is actually written to this device, read straight from IndexedDB. */
export function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ events: any[]; planItems: any[] }>((resolve, reject) => {
        const open = indexedDB.open('kayomi');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(['events', 'planItems']);
          const events = tx.objectStore('events').getAll();
          const planItems = tx.objectStore('planItems').getAll();
          tx.oncomplete = () => {
            open.result.close();
            resolve({ events: events.result, planItems: planItems.result });
          };
        };
      }),
  );
}
export const storedTitles = async (page: Page) => (await stored(page)).events.map((e) => e.title).sort();

/**
 * Puts a calendar on this device before the app is opened, written the way the first release
 * wrote it: database `kayomi`, version 1, one store each for events and Plan items, keyed by id.
 * This is what everyone who used Koyomi before today already has.
 */
export async function seed(page: Page, data: { events?: CalendarEvent[]; planItems?: PlanItem[] }) {
  // The landing page shares the calendar's address and storage, and never opens the database itself.
  await page.goto('/home');
  await page.evaluate(
    ({ events = [], planItems = [] }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('kayomi', 1);
        open.onupgradeneeded = () => {
          for (const name of ['events', 'planItems']) open.result.createObjectStore(name, { keyPath: 'id' });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(['events', 'planItems'], 'readwrite');
          events.forEach((record) => tx.objectStore('events').put(record));
          planItems.forEach((record) => tx.objectStore('planItems').put(record));
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    data,
  );
}

/** Waits until the worker is in control and holds the page and every file the page loaded, fonts included. */
export async function offlineReady(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!navigator.serviceWorker.controller) return 'no worker yet';
          const cache = await caches.open('kayomi-static-v1');
          const loaded = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/_next/static/'));
          const missing = [];
          for (const url of loaded) if (!(await cache.match(url))) missing.push(url);
          const shell = await (await caches.open('kayomi-shell-v1')).match('/');
          return loaded.length && shell && !missing.length ? 'ready' : `missing ${missing.length}`;
        }),
      { timeout: 30_000 },
    )
    .toBe('ready');
}

/** The font files Chrome really drew an element's text with (not just what the CSS asks for). */
export async function renderedFonts(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  await cdp.detach();
  return fonts.filter((f) => f.isCustomFont).map((f) => f.familyName);
}
