import { spawn } from 'node:child_process';
import { chromium, expect, test, type Page } from '@playwright/test';

// These run against the production build, so they exercise the real service worker and IndexedDB.
// Every test starts from an empty calendar: each gets its own browser profile.

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (k: string, n: number) => {
  const [y, m, d] = k.split('-').map(Number);
  return key(new Date(y, m - 1, d + n));
};
const today = () => key(new Date());
/** Another day in the same Monday-first week as today. */
const otherDay = () => addDays(today(), (new Date().getDay() + 6) % 7 === 6 ? -1 : 1);

const event = (page: Page, title: string) => page.locator('[data-event]', { hasText: title });
const popover = (page: Page) => page.locator('[data-popover]');
const plan = (page: Page) => page.getByRole('region', { name: 'Plan' });
const columns = (page: Page) => page.locator('[data-day]');

async function open(page: Page, url = '/') {
  await page.goto(url);
  await expect(page.getByText('kayomi')).toBeVisible();
}

/** Reloads and waits until the calendar is on screen and taking keys again. */
async function reload(page: Page) {
  await page.reload();
  await expect(page.getByText('kayomi')).toBeVisible();
}

/** A time of day inside a day's column, scrolled into view. */
async function at(page: Page, day: string, time: string) {
  const column = page.locator(`[data-day="${day}"]`);
  const [h, m] = time.split(':').map(Number);
  const y = await column.evaluate((el, minutes) => {
    const y = (minutes / 60) * (el.getBoundingClientRect().height / 24);
    el.closest('.overflow-y-auto')!.scrollTop = Math.max(0, y - 250);
    return y;
  }, h * 60 + m);
  return { column, position: { x: 40, y: y + 6 } };
}

const hourHeight = (page: Page) => columns(page).first().evaluate((el) => el.getBoundingClientRect().height / 24);

async function addEvent(page: Page, title: string, time: string, day = today()) {
  const { column, position } = await at(page, day, time);
  await column.click({ position });
  await expect(page.getByPlaceholder('What are you doing?')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(event(page, title)).toBeVisible();
}

async function addToPlan(page: Page, ...titles: string[]) {
  await plan(page).getByRole('button', { name: /Add$/ }).click();
  for (const title of titles) {
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
}

async function placeFromPlan(page: Page, title: string, time: string, day = today()) {
  await plan(page).getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByText('Choose a time for')).toBeVisible();
  const { column, position } = await at(page, day, time);
  await column.click({ position });
  await expect(event(page, title)).toBeVisible();
}

/** What is actually written to this device, read straight from IndexedDB. */
function stored(page: Page) {
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
const storedTitles = async (page: Page) => (await stored(page)).events.map((e) => e.title).sort();

/** The font files Chrome really drew an element's text with (not just what the CSS asks for). */
async function renderedFonts(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  await cdp.detach();
  return fonts.filter((f) => f.isCustomFont).map((f) => f.familyName);
}

test.describe('calendar', () => {
  test('opens on the week, with nothing failing to load', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
    page.on('pageerror', (e) => failed.push(e.message));
    await open(page);
    await expect(columns(page)).toHaveCount(7);
    await expect(page.locator(`[data-day="${today()}"]`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveTitle('Kayomi');
    expect(failed).toEqual([]);
    // Only the Latin slice of each font weight is fetched up front, not the Japanese ranges.
    expect(await page.locator('link[rel="preload"][as="font"]').count()).toBeLessThanOrEqual(4);
  });

  test('click a time, type a title, press Enter', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Lunch', '14:00');
    await expect(event(page, 'Lunch')).toContainText('14:00 – 15:00');

    await expect.poll(() => storedTitles(page)).toEqual(['Lunch']);
    const [saved] = (await stored(page)).events;
    expect(saved).toMatchObject({ title: 'Lunch', allDay: false, category: 'misc', planItemId: null, recurrence: null });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(saved.end).getTime() - new Date(saved.start).getTime()).toBe(3600_000);

    await reload(page);
    await expect(event(page, 'Lunch')).toContainText('14:00 – 15:00');
  });

  test('Escape cancels quick-add, and typing never fires a shortcut', async ({ page }) => {
    await open(page);
    const { column, position } = await at(page, today(), '09:00');
    await column.click({ position });
    await page.keyboard.type('nothing');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-event]')).toHaveCount(0);

    await addEvent(page, 'Dinner with dad, pm', '19:00');
    await expect(columns(page)).toHaveCount(7);
    await expect(plan(page)).toBeHidden();
  });

  test('N starts an event without touching the mouse', async ({ page }) => {
    await open(page);
    await page.keyboard.press('n');
    await expect(page.getByPlaceholder('What are you doing?')).toBeFocused();
    await page.keyboard.type('Call the bank');
    await page.keyboard.press('Enter');
    await expect(event(page, 'Call the bank')).toBeVisible();
  });

  test('an ordinary event is not a task: it has no done state and no way back to Plan', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Dinner', '19:00');
    await event(page, 'Dinner').click();
    await expect(popover(page).getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(popover(page).getByRole('button', { name: 'Mark done' })).toHaveCount(0);
    await expect(popover(page).getByRole('button', { name: 'Back to Plan' })).toHaveCount(0);

    await popover(page).getByRole('button', { name: 'Delete' }).click();
    await expect(event(page, 'Dinner')).toHaveCount(0);
    await expect.poll(() => storedTitles(page)).toEqual([]);
  });

  test('edit the title, time, day and colour of an event', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Focus', '09:00');
    await event(page, 'Focus').click();

    await popover(page).getByLabel('Title').fill('Deep work');
    await page.keyboard.press('Enter');
    await expect(event(page, 'Deep work')).toBeVisible();

    await popover(page).getByLabel('Start').fill('1330');
    await page.keyboard.press('Enter');
    await expect(event(page, 'Deep work')).toContainText('13:30 – 14:30');

    await popover(page).getByLabel('End').fill('15');
    await page.keyboard.press('Enter');
    await expect(event(page, 'Deep work')).toContainText('13:30 – 15:00');

    // An end before the start is not a time range: the field goes back.
    await popover(page).getByLabel('End').fill('12:00');
    await page.keyboard.press('Enter');
    await expect(popover(page).getByLabel('End')).toHaveValue('15:00');

    await popover(page).getByLabel('Date').fill(otherDay());
    await expect(page.locator(`[data-day="${otherDay()}"] [data-event]`, { hasText: 'Deep work' })).toBeVisible();
    await expect(popover(page)).toBeVisible();

    await popover(page).getByRole('button', { name: 'Work' }).click();
    await expect.poll(async () => (await stored(page)).events[0]?.category).toBe('work');

    await reload(page);
    await expect(page.locator(`[data-day="${otherDay()}"] [data-event]`, { hasText: 'Deep work' })).toContainText('13:30 – 15:00');
  });

  test('move and resize an event with the mouse', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Focus', '09:00');
    const hour = await hourHeight(page);

    let box = (await event(page, 'Focus').boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 12 + hour * 2, { steps: 8 });
    await page.mouse.up();
    await expect(event(page, 'Focus')).toContainText('11:00 – 12:00');
    // Ending a drag neither opens the event nor starts a new one.
    await expect(popover(page)).toHaveCount(0);
    await expect(page.getByPlaceholder('What are you doing?')).toHaveCount(0);

    box = (await event(page, 'Focus').boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + box.height - 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + box.height - 2 + hour * 1.5, { steps: 8 });
    await page.mouse.up();
    await expect(event(page, 'Focus')).toContainText('11:00 – 13:30');

    const target = (await page.locator(`[data-day="${otherDay()}"]`).boundingBox())!;
    box = (await event(page, 'Focus').boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(target.x + 60, box.y + 12, { steps: 8 });
    await page.mouse.up();
    const moved = page.locator(`[data-day="${otherDay()}"] [data-event]`, { hasText: 'Focus' });
    await expect(moved).toContainText('11:00 – 13:30');

    await expect.poll(async () => (await stored(page)).events.length).toBe(1);
    await reload(page);
    await expect(page.locator(`[data-day="${otherDay()}"] [data-event]`, { hasText: 'Focus' })).toContainText('11:00 – 13:30');
  });

  test('overlapping events sit side by side', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Workshop', '10:00');
    await addEvent(page, 'Call', '13:00');
    await event(page, 'Call').click();
    await popover(page).getByLabel('Start').fill('10:30');
    await page.keyboard.press('Enter');
    await expect(event(page, 'Call')).toContainText('10:30');

    const workshop = (await event(page, 'Workshop').boundingBox())!;
    const call = (await event(page, 'Call').boundingBox())!;
    expect(call.x).toBeGreaterThanOrEqual(workshop.x + workshop.width);
  });

  test('Day, Week and Month, by button and by key', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Gym', '08:00');

    await page.keyboard.press('d');
    await expect(columns(page)).toHaveCount(1);
    await expect(event(page, 'Gym')).toBeVisible();

    await page.keyboard.press('m');
    await expect(columns(page)).toHaveCount(0);
    await expect(page.getByText('Gym')).toBeVisible();
    await expect(page.getByText('MON', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Week' }).click();
    await expect(columns(page)).toHaveCount(7);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator(`[data-day="${addDays(today(), 7)}"]`)).toBeVisible();
    await expect(event(page, 'Gym')).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(`[data-day="${addDays(today(), -7)}"]`)).toBeVisible();
    await page.keyboard.press('t');
    await expect(page.locator(`[data-day="${today()}"]`)).toBeVisible();
    await expect(event(page, 'Gym')).toBeVisible();

    // A day in the month opens that day.
    await page.keyboard.press('m');
    await page.getByRole('button', { name: /Gym/ }).click();
    await expect(columns(page)).toHaveCount(1);
    await expect(page.locator(`[data-day="${today()}"]`)).toBeVisible();
  });

  test('a repeating event: every week, skip one, end the series, delete all', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Gym', '07:30');
    await event(page, 'Gym').click();
    await popover(page).getByLabel('Repeat').selectOption('weekly');
    const next = page.getByRole('button', { name: 'Next' });
    const previous = page.getByRole('button', { name: 'Previous' });

    await next.click();
    await expect(page.locator(`[data-day="${addDays(today(), 7)}"] [data-event]`, { hasText: 'Gym' })).toBeVisible();

    // Skip next week only.
    await event(page, 'Gym').click();
    await popover(page).getByRole('button', { name: 'Delete' }).click();
    await popover(page).getByRole('button', { name: 'This one' }).click();
    await expect(event(page, 'Gym')).toHaveCount(0);
    await next.click();
    await expect(event(page, 'Gym')).toHaveCount(1);
    await previous.click();
    await previous.click();
    await expect(event(page, 'Gym')).toHaveCount(1);

    // End it three weeks out: earlier weeks stay, later ones go.
    await next.click();
    await next.click();
    await next.click();
    await event(page, 'Gym').click();
    await popover(page).getByRole('button', { name: 'Delete' }).click();
    await popover(page).getByRole('button', { name: 'This and after' }).click();
    await expect(event(page, 'Gym')).toHaveCount(0);
    await next.click();
    await expect(event(page, 'Gym')).toHaveCount(0);
    await page.keyboard.press('t');
    await expect(event(page, 'Gym')).toHaveCount(1);

    await reload(page);
    await event(page, 'Gym').click();
    await expect(popover(page).getByLabel('Repeat')).toHaveValue('weekly');
    await popover(page).getByRole('button', { name: 'Delete' }).click();
    await popover(page).getByRole('button', { name: 'All' }).click();
    await expect.poll(() => storedTitles(page)).toEqual([]);
  });

  test('a change in one window shows up in another', async ({ page, context }) => {
    await open(page);
    const second = await context.newPage();
    await open(second);

    await page.bringToFront();
    await addEvent(page, 'Standup', '09:30');

    await second.bringToFront();
    await expect(event(second, 'Standup')).toContainText('09:30');
    await event(second, 'Standup').click();
    await popover(second).getByRole('button', { name: 'Delete' }).click();

    await page.bringToFront();
    await expect(event(page, 'Standup')).toHaveCount(0);
  });

  test('search finds events and Plan items', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Dentist', '10:00', otherDay());
    await page.keyboard.press('p');
    await addToPlan(page, 'Call the dentist back', 'Buy stamps');
    await page.keyboard.press('p');

    await page.keyboard.press('/');
    const search = page.getByRole('search');
    await search.getByLabel('Search').fill('DENT');
    await expect(search.getByRole('button')).toHaveCount(2);
    await expect(search.getByRole('button', { name: /Call the dentist back/ })).toContainText('Plan');

    await search.getByRole('button', { name: /^Dentist/ }).click();
    await expect(search).toHaveCount(0);
    await expect(popover(page).getByLabel('Title')).toHaveValue('Dentist');

    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('search').getByLabel('Search').fill('zzz');
    await expect(page.getByRole('search')).toContainText('Nothing found.');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('search')).toHaveCount(0);
  });
});

test.describe('Plan', () => {
  test('Plan holds what is unscheduled; scheduling moves it to the calendar', async ({ page }) => {
    await open(page);
    await page.keyboard.press('p');
    await expect(plan(page)).toContainText('Nothing waiting.');
    await addToPlan(page, 'Send documents', 'Book dentist');
    await expect(plan(page)).toContainText('2 things');

    await placeFromPlan(page, 'Send documents', '10:00');
    await expect(event(page, 'Send documents')).toContainText('10:00 – 11:00');
    await expect(plan(page)).toContainText('1 thing');
    await expect(plan(page).getByRole('button', { name: 'Send documents', exact: true })).toHaveCount(0);

    // One record each, linked: not two unrelated copies.
    await expect.poll(async () => (await stored(page)).events.length).toBe(1);
    const data = await stored(page);
    const item = data.planItems.find((p) => p.title === 'Send documents');
    expect(item.status).toBe('open');
    expect(data.events[0].planItemId).toBe(item.id);
  });

  test('Back to Plan and Delete are different things', async ({ page }) => {
    await open(page);
    await page.keyboard.press('p');
    await addToPlan(page, 'Send documents', 'Book dentist');
    await placeFromPlan(page, 'Send documents', '10:00');
    await placeFromPlan(page, 'Book dentist', '13:00');

    // Back to Plan: off the calendar, waiting in Plan again.
    await event(page, 'Send documents').click();
    await popover(page).getByRole('button', { name: 'Back to Plan' }).click();
    await expect(event(page, 'Send documents')).toHaveCount(0);
    await expect(plan(page).getByRole('button', { name: 'Send documents', exact: true })).toBeVisible();
    await expect(plan(page)).toContainText('1 thing');

    // Delete: gone from the calendar and from Plan.
    await event(page, 'Book dentist').click();
    await popover(page).getByRole('button', { name: 'Delete' }).click();
    await expect(event(page, 'Book dentist')).toHaveCount(0);
    await expect(plan(page)).not.toContainText('Book dentist');
    await expect(plan(page)).toContainText('1 thing');

    await expect.poll(async () => (await stored(page)).planItems.map((p) => p.title)).toEqual(['Send documents']);
    expect((await stored(page)).events).toEqual([]);

    await reload(page);
    await page.keyboard.press('p');
    await expect(plan(page).getByRole('button', { name: 'Send documents', exact: true })).toBeVisible();
    await expect(plan(page)).not.toContainText('Book dentist');
    await expect(page.locator('[data-event]')).toHaveCount(0);
  });

  test('marking a scheduled Plan item done completes the item and keeps the event', async ({ page }) => {
    await open(page);
    await page.keyboard.press('p');
    await addToPlan(page, 'Call supplier');
    await placeFromPlan(page, 'Call supplier', '18:00');

    await event(page, 'Call supplier').click();
    await popover(page).getByRole('button', { name: 'Mark done' }).click();
    await expect(event(page, 'Call supplier')).toBeVisible();
    await expect(event(page, 'Call supplier').locator('span').nth(1)).toHaveCSS('text-decoration-line', 'line-through');

    // Completed sits collapsed at the foot of Plan.
    const completed = plan(page).getByRole('button', { name: /Completed/ });
    await expect(completed).toContainText('1');
    await expect(plan(page).getByText('Call supplier')).toHaveCount(0);
    await completed.click();
    await expect(plan(page).getByText('Call supplier')).toBeVisible();
    await expect.poll(async () => (await stored(page)).planItems[0]?.status).toBe('completed');

    await reload(page);
    await event(page, 'Call supplier').click();
    await popover(page).getByRole('button', { name: 'Not done' }).click();
    await expect.poll(async () => (await stored(page)).planItems[0]?.status).toBe('open');
    await expect(event(page, 'Call supplier')).toBeVisible();
  });

  test('complete and reopen an item inside Plan', async ({ page }) => {
    await open(page);
    await page.keyboard.press('p');
    await addToPlan(page, 'Renew passport photos');
    await plan(page).getByRole('button', { name: 'Mark done: Renew passport photos' }).click();
    await expect(plan(page)).toContainText('Nothing waiting');
    await plan(page).getByRole('button', { name: /Completed/ }).click();
    await plan(page).getByRole('button', { name: 'Mark not done: Renew passport photos' }).click();
    await expect(plan(page).getByRole('button', { name: 'Renew passport photos', exact: true })).toBeVisible();
    await expect(plan(page).getByRole('button', { name: /Completed/ })).toHaveCount(0);
  });

  test('drag a Plan item onto the calendar', async ({ page }) => {
    await open(page);
    await page.keyboard.press('p');
    await addToPlan(page, 'Project review');
    const { column, position } = await at(page, today(), '15:00');
    await plan(page).getByRole('button', { name: 'Project review', exact: true }).dragTo(column, { targetPosition: position });
    await expect(event(page, 'Project review')).toContainText('15:00 – 16:00');
    await expect(plan(page)).toContainText('Nothing waiting');
    await event(page, 'Project review').click();
    await expect(popover(page).getByRole('button', { name: 'Back to Plan' })).toBeVisible();
  });

  test('renaming a scheduled item renames it in Plan too', async ({ page }) => {
    await open(page);
    await page.keyboard.press('p');
    await addToPlan(page, 'Gym');
    await placeFromPlan(page, 'Gym', '07:30');
    await event(page, 'Gym').click();
    await popover(page).getByLabel('Title').fill('Gym, legs');
    await page.keyboard.press('Enter');
    await popover(page).getByRole('button', { name: 'Back to Plan' }).click();
    await expect(plan(page).getByRole('button', { name: 'Gym, legs', exact: true })).toBeVisible();
  });
});

test.describe('look', () => {
  test('ink mode is remembered', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 241, 232)');

    await page.getByRole('button', { name: 'Toggle ink mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(29, 29, 27)');
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#1D1D1B');

    await reload(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(29, 29, 27)');
  });

  test.describe('on a dark system', () => {
    test.use({ colorScheme: 'dark' });
    test('starts in ink mode until a choice is made', async ({ page }) => {
      await open(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.getByRole('button', { name: 'Toggle ink mode' }).click();
      await reload(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    });
  });

  test('uses the approved typefaces', async ({ page }) => {
    await open(page);
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => renderedFonts(page, 'header span.font-mincho')).toEqual(['Shippori Mincho']);
    await expect.poll(() => renderedFonts(page, 'header nav button')).toEqual(['Zen Kaku Gothic New']);
  });

  for (const size of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'laptop', width: 1280, height: 720 },
  ]) {
    test(`${size.name}: opens on the working day, whatever the hour`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const hour of [6, 13, 22]) {
        const now = new Date();
        now.setHours(hour, 30, 0, 0);
        await page.clock.setFixedTime(now);
        await open(page);
        // The hours between the column headings and the bottom of the window, as fractions of a day.
        const visible = await columns(page).first().evaluate((column) => {
          const scroller = column.closest('.overflow-y-auto')!;
          const headings = scroller.querySelector('.sticky')!.getBoundingClientRect().bottom;
          const hourH = column.getBoundingClientRect().height / 24;
          const start = column.getBoundingClientRect().top;
          return { from: (headings - start) / hourH, to: (scroller.getBoundingClientRect().bottom - start) / hourH };
        });
        expect(visible.from, `first hour shown at ${hour}:30`).toBeGreaterThan(7);
        expect(visible.from, `first hour shown at ${hour}:30`).toBeLessThanOrEqual(8);
        expect(visible.to, `last hour shown at ${hour}:30`).toBeGreaterThanOrEqual(19.5);
      }
    });

    test(`${size.name}: week fits the window with no sideways scroll`, async ({ page }) => {
      await page.setViewportSize(size);
      await open(page);
      await expect(columns(page)).toHaveCount(7);
      await page.keyboard.press('p');
      await expect(plan(page)).toBeVisible();
      await addToPlan(page, 'Something');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The drawer leaves the whole week readable beside it.
      const sunday = (await columns(page).last().boundingBox())!;
      const drawer = (await plan(page).boundingBox())!;
      expect(sunday.x + sunday.width).toBeLessThanOrEqual(drawer.x + 1);
    });
  }
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('opens on today, one day at a time', async ({ page }) => {
    await open(page);
    await expect(columns(page)).toHaveCount(1);
    await expect(page.locator(`[data-day="${today()}"]`)).toBeVisible();
    await expect(page.locator('button[aria-pressed]')).toHaveCount(7);
    await expect(page.locator('button[aria-pressed="true"]')).toHaveText(new RegExp(`${new Date().getDate()}$`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('tap a time to add; tap a Plan item, then a time, to schedule it', async ({ page }) => {
    await open(page);
    const slot = await at(page, today(), '09:00');
    await slot.column.tap({ position: slot.position });
    await page.getByPlaceholder('What are you doing?').fill('School run');
    await page.keyboard.press('Enter');
    await expect(event(page, 'School run')).toBeVisible();

    await page.getByRole('button', { name: /^Plan/ }).tap();
    await expect(plan(page)).toBeVisible();
    await plan(page).getByRole('button', { name: /Add$/ }).tap();
    await page.getByPlaceholder('Something to do').fill('Send documents');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    await plan(page).getByRole('button', { name: 'Send documents', exact: true }).tap();
    await expect(plan(page)).toBeHidden();
    await expect(page.getByText('Choose a time for')).toBeVisible();
    const target = await at(page, today(), '11:00');
    await target.column.tap({ position: target.position });
    await expect(event(page, 'Send documents')).toContainText('11:00 – 12:00');
    await expect(page.getByRole('button', { name: /^Plan/ })).toContainText('Nothing waiting');

    await event(page, 'Send documents').tap();
    await popover(page).getByRole('button', { name: 'Back to Plan' }).tap();
    await expect(event(page, 'Send documents')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Plan/ })).toContainText('1 thing');

    await reload(page);
    await expect(event(page, 'School run')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Plan/ })).toContainText('1 thing');
  });

  test('the month is a tap away and opens a day', async ({ page }) => {
    await open(page);
    const monthName = new Date().toLocaleString('en-US', { month: 'long' });
    await page.getByRole('button', { name: new RegExp(monthName) }).tap();
    await expect(columns(page)).toHaveCount(0);
    await page.getByRole('button', { name: '15', exact: true }).tap();
    await expect(columns(page)).toHaveCount(1);
    await expect(page.locator(`[data-day="${today().slice(0, 8)}15"]`)).toBeVisible();
  });
});

test.describe('installed app', () => {
  test('has a manifest, icons and a service worker', async ({ request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ name: 'Kayomi', display: 'standalone', start_url: '/', background_color: '#F5F1E8' });
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of [...manifest.icons.map((i: { src: string }) => i.src), '/apple-icon.png', '/favicon.ico', '/icon.svg']) {
      const response = await request.get(icon);
      expect(response.status(), icon).toBe(200);
    }
    const worker = await request.get('/sw.js');
    expect(worker.status()).toBe(200);
    expect(worker.headers()['cache-control']).toContain('no-cache');
  });

  test('survives a browser restart, and Chrome finds it installable', async ({ baseURL }, testInfo) => {
    const profile = testInfo.outputPath('profile');
    const launch = () => chromium.launchPersistentContext(profile, { channel: 'chrome', viewport: { width: 1440, height: 900 } });

    let context = await launch();
    let page = context.pages()[0] ?? (await context.newPage());
    await open(page, baseURL!);
    await addEvent(page, 'Flight to Lisbon', '06:00');
    await page.keyboard.press('p');
    await addToPlan(page, 'Pack');
    await expect.poll(async () => (await stored(page)).planItems.length).toBe(1);

    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);
    expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
    await context.close();

    context = await launch();
    page = context.pages()[0] ?? (await context.newPage());
    await open(page, baseURL!);
    await expect(event(page, 'Flight to Lisbon')).toContainText('06:00 – 07:00');
    await page.keyboard.press('p');
    await expect(plan(page).getByRole('button', { name: 'Pack', exact: true })).toBeVisible();
    await context.close();
  });

  test('the offline cache drops files from older releases, on a host that nests them too', async ({ page }) => {
    await open(page);
    // Let the page finish handing its own files to the worker first.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          if (!navigator.serviceWorker.controller) return false;
          const cache = await caches.open('kayomi-static-v1');
          const loaded = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/_next/static/'));
          for (const url of loaded) if (!(await cache.match(url))) return false;
          return loaded.length > 0;
        }),
      )
      .toBe(true);

    // Vercel serves hashed files one folder deeper than a local build: /_next/static/immutable/.
    const kept = await page.evaluate(async () => {
      const base = `${location.origin}/_next/static/immutable/`;
      const cache = await caches.open('kayomi-static-v1');
      for (const file of ['chunks/old-release.js', 'chunks/current.js', 'media/font.woff2']) await cache.put(base + file, new Response('x'));
      navigator.serviceWorker.controller!.postMessage({ type: 'warm', urls: [`${base}chunks/current.js`] });
      for (let i = 0; i < 40 && (await cache.match(`${base}chunks/old-release.js`)); i++) await new Promise((r) => setTimeout(r, 100));
      const has = async (file: string) => !!(await cache.match(base + file));
      return { oldRelease: await has('chunks/old-release.js'), current: await has('chunks/current.js'), font: await has('media/font.woff2') };
    });
    expect(kept).toEqual({ oldRelease: false, current: true, font: true });
  });

  test('works with no connection after one visit', async ({ page }) => {
    test.setTimeout(120_000);
    // Its own server, so that it can be taken away.
    const origin = 'http://localhost:4311';
    const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '4311'], { stdio: 'ignore' });
    const reachable = () =>
      fetch(origin).then(
        (r) => r.ok,
        () => false,
      );
    try {
      await expect.poll(reachable, { timeout: 60_000 }).toBe(true);
      await open(page, origin);
      await addEvent(page, 'Before the tunnel', '10:00');

      // The worker holds the page and every file the page loaded, fonts included.
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

      server.kill();
      await expect.poll(reachable, { timeout: 30_000 }).toBe(false);

      await reload(page);
      await expect(page.getByText('kayomi')).toBeVisible();
      await expect(event(page, 'Before the tunnel')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => renderedFonts(page, 'header span.font-mincho')).toEqual(['Shippori Mincho']);
      await expect.poll(() => renderedFonts(page, 'header nav button')).toEqual(['Zen Kaku Gothic New']);

      await addEvent(page, 'In the tunnel', '12:00');
      await page.keyboard.press('p');
      await addToPlan(page, 'Reply when back online');
      await expect.poll(() => storedTitles(page)).toEqual(['Before the tunnel', 'In the tunnel']);

      await reload(page);
      await expect(event(page, 'In the tunnel')).toBeVisible();
      await page.keyboard.press('p');
      await expect(plan(page).getByRole('button', { name: 'Reply when back online', exact: true })).toBeVisible();
    } finally {
      server.kill();
    }
  });
});
