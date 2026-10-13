import { expect, test } from '@playwright/test';
import {
  addDays,
  addEvent,
  at,
  calendars,
  calendarsButton,
  columns,
  event,
  hourHeight,
  open,
  otherDay,
  popover,
  reload,
  renderedFonts,
  seed,
  stored,
  storedTitles,
  today,
} from './helpers';

// The calendar itself: events, the views, where Calendars is, and the look.
// Koyomi as an installed app (manifest, offline, releases) is in pwa.spec.ts, and calendars
// connected from elsewhere are in calendars.spec.ts and accounts.spec.ts.

test.describe('calendar', () => {
  test('opens on the week, with nothing failing to load', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
    page.on('pageerror', (e) => failed.push(e.message));
    await open(page);
    await expect(columns(page)).toHaveCount(7);
    await expect(page.locator(`[data-day="${today()}"]`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveTitle('Koyomi');
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
    expect(saved).toMatchObject({ title: 'Lunch', allDay: false, category: 'misc', recurrence: null });
    // An event is an event: nothing about it says it is, or ever was, a task.
    expect(Object.keys(saved).sort()).toEqual(['allDay', 'category', 'createdAt', 'end', 'id', 'recurrence', 'start', 'title', 'updatedAt']);
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

    // Every letter that is a shortcut elsewhere: c, d, m, n, t, w.
    await addEvent(page, 'Catch up with dad, pm', '19:00');
    await expect(columns(page)).toHaveCount(7);
    await expect(calendars(page)).toBeHidden();
  });

  test('N starts an event without touching the mouse', async ({ page }) => {
    await open(page);
    await page.keyboard.press('n');
    await expect(page.getByPlaceholder('What are you doing?')).toBeFocused();
    await page.keyboard.type('Call the bank');
    await page.keyboard.press('Enter');
    await expect(event(page, 'Call the bank')).toBeVisible();
  });

  test('an event is not a task: it can be deleted, and there is nothing to mark done or send anywhere', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Dinner', '19:00');
    await event(page, 'Dinner').click();
    // Everything an event can have done to it: its title, day and times, all day, a colour, repeating, deleting.
    await expect(popover(page).getByRole('button')).toHaveText(['All day', '', '', '', '', 'Delete']);
    await expect(popover(page).getByLabel('Repeat')).toBeVisible();
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
    await popover(page).getByRole('button', { name: 'All', exact: true }).click();
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

  test('search finds events by their title', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Dentist', '10:00', otherDay());
    await addEvent(page, 'Call the dentist back', '12:00');
    await addEvent(page, 'Buy stamps', '16:00');

    await page.keyboard.press('/');
    const search = page.getByRole('search');
    await expect(search.getByLabel('Search')).toHaveAttribute('placeholder', 'Search events');
    await search.getByLabel('Search').fill('DENT');
    await expect(search.getByRole('button')).toHaveCount(2);

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

test.describe('Calendars is in reach', () => {
  test('on a desktop it is one of the header’s own controls, and opens beside the week', async ({ page }) => {
    await open(page);
    // Beside Day, Week and Month, not behind a menu or a settings page.
    const control = page.locator('header').getByRole('button', { name: 'Calendars', exact: true });
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: /settings|menu/i })).toHaveCount(0);

    await control.click();
    await expect(control).toHaveAttribute('aria-expanded', 'true');
    await expect(calendars(page)).toBeVisible();
    // Koyomi's own calendar is always on it, and the way to another is one press away.
    await expect(calendars(page).getByText('Koyomi', { exact: true })).toBeVisible();
    await expect(calendars(page).getByRole('button', { name: 'Add calendar account' })).toBeVisible();

    // C opens and closes it, as D, W and M change the view; Escape and its own × close it too.
    await page.keyboard.press('c');
    await expect(calendars(page)).toBeHidden();
    await page.keyboard.press('c');
    await expect(calendars(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(calendars(page)).toBeHidden();
    await control.click();
    await calendars(page).getByRole('button', { name: 'Close calendars' }).click();
    await expect(calendars(page)).toBeHidden();
  });
});

test.describe('Plan is gone', () => {
  const stamp = '2026-10-01T08:00:00.000Z';
  const at9 = (day: string) => new Date(`${day}T09:00:00`).toISOString();
  const at10 = (day: string) => new Date(`${day}T10:00:00`).toISOString();
  /** A device that used Plan: something waiting, something done, and two events scheduled from it. */
  const usedPlan = () => ({
    events: [
      { id: 'e-open', title: 'Send documents', start: at9(today()), end: at10(today()), allDay: false, category: 'work' as const, planItemId: 'p-open', recurrence: null, createdAt: stamp, updatedAt: stamp },
      { id: 'e-done', title: 'Call supplier', start: at9(otherDay()), end: at10(otherDay()), allDay: false, category: 'life' as const, planItemId: 'p-done', recurrence: null, createdAt: stamp, updatedAt: stamp },
    ],
    planItems: [
      { id: 'p-open', title: 'Send documents', status: 'open' as const, createdAt: stamp, updatedAt: stamp },
      { id: 'p-done', title: 'Call supplier', status: 'completed' as const, createdAt: stamp, updatedAt: stamp },
      { id: 'p-waiting', title: 'Renew passport photos', status: 'open' as const, createdAt: stamp, updatedAt: stamp },
    ],
  });

  test('nothing on a desktop is called Plan, and P does nothing', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Lunch', '12:30');
    await expect(page.getByRole('button', { name: /plan/i })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Plan' })).toHaveCount(0);
    await expect(page.getByText(/\bPlan\b/)).toHaveCount(0);

    await page.keyboard.press('p');
    // The one drawer there is, is Calendars, and P did not open it.
    await expect(page.locator('section[aria-label]')).toHaveAttribute('aria-label', 'Calendars');
    await expect(calendars(page)).toBeHidden();
    await expect(page.getByText('Choose a time for')).toHaveCount(0);

    // Calendars has nothing of it either: no list of things to do, no field to add one.
    await page.keyboard.press('c');
    await expect(calendars(page)).toBeVisible();
    await expect(calendars(page).getByText(/\bPlan\b|waiting|Completed/)).toHaveCount(0);
    await expect(calendars(page).getByRole('textbox')).toHaveCount(0);
    // Nothing on the calendar can be dragged in from anywhere.
    expect(await page.locator('[draggable="true"]').count()).toBe(0);
  });

  test('an event that was scheduled from Plan is an ordinary event now, and what Plan held is neither shown nor touched', async ({ page }) => {
    const before = usedPlan();
    await seed(page, before);
    await open(page);

    // Both events are there. The one whose item was done is not struck through: there is no done.
    await expect(event(page, 'Send documents')).toContainText('09:00 – 10:00');
    const done = event(page, 'Call supplier');
    await expect(done).toContainText('09:00 – 10:00');
    await expect(done.locator('span').nth(1)).toHaveCSS('text-decoration-line', 'none');
    // What was only waiting in Plan is nowhere: not on the calendar, not in search, not in Calendars.
    await expect(page.getByText('Renew passport photos')).toHaveCount(0);
    await page.keyboard.press('/');
    await page.getByRole('search').getByLabel('Search').fill('passport');
    await expect(page.getByRole('search')).toContainText('Nothing found.');
    await page.keyboard.press('Escape');

    // It is edited like any event, and can repeat, which an event from Plan never could.
    await done.click();
    await expect(popover(page).getByRole('button', { name: 'Mark done' })).toHaveCount(0);
    await expect(popover(page).getByRole('button', { name: 'Not done' })).toHaveCount(0);
    await expect(popover(page).getByRole('button', { name: 'Back to Plan' })).toHaveCount(0);
    await popover(page).getByLabel('Title').fill('Call the supplier');
    await page.keyboard.press('Enter');
    await popover(page).getByLabel('Repeat').selectOption('weekly');
    await expect.poll(async () => (await stored(page)).events.find((e) => e.id === 'e-done')?.recurrence?.freq).toBe('weekly');

    // And deleted like any event. Nothing that Plan held follows it, or changes with it.
    await event(page, 'Send documents').click();
    await popover(page).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => storedTitles(page)).toEqual(['Call the supplier']);
    const held = async () => JSON.stringify((await stored(page)).planItems.sort((a, b) => a.id.localeCompare(b.id)));
    const was = JSON.stringify([...before.planItems].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await held()).toBe(was);

    await reload(page);
    await expect(event(page, 'Call the supplier')).toBeVisible();
    await expect(page.getByText('Renew passport photos')).toHaveCount(0);
    expect(await held()).toBe(was);
    // The event keeps the mark of where it came from, which means nothing now and is not acted on.
    expect((await stored(page)).events.map((e) => [e.title, e.planItemId])).toEqual([['Call the supplier', 'p-done']]);
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
      await page.keyboard.press('c');
      await expect(calendars(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The drawer leaves the whole week readable beside it.
      const sunday = (await columns(page).last().boundingBox())!;
      const drawer = (await calendars(page).boundingBox())!;
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

  test('tap a time to add an event, and tap it to change or delete it', async ({ page }) => {
    await open(page);
    const slot = await at(page, today(), '09:00');
    await slot.column.tap({ position: slot.position });
    await page.getByPlaceholder('What are you doing?').fill('School run');
    await page.keyboard.press('Enter');
    await expect(event(page, 'School run')).toContainText('09:00 – 10:00');

    await event(page, 'School run').tap();
    await expect(popover(page).getByRole('button', { name: 'Mark done' })).toHaveCount(0);
    await expect(popover(page).getByRole('button', { name: 'Back to Plan' })).toHaveCount(0);
    await popover(page).getByLabel('Start').fill('1100');
    await page.keyboard.press('Enter');
    await expect(event(page, 'School run')).toContainText('11:00 – 12:00');

    await reload(page);
    await event(page, 'School run').tap();
    await popover(page).getByRole('button', { name: 'Delete' }).tap();
    await expect(event(page, 'School run')).toHaveCount(0);
    await expect.poll(() => storedTitles(page)).toEqual([]);
  });

  test('Calendars is the bar along the foot, one tap from adding an account; nothing is called Plan', async ({ page }) => {
    await open(page);
    // Always on screen with the day, not behind a menu: the one bar at the foot.
    const bar = calendarsButton(page);
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Koyomi');
    const box = (await bar.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(844 - 2);
    expect(box.width).toBeGreaterThan(380);
    await expect(page.getByRole('button', { name: /plan|settings|menu/i })).toHaveCount(0);
    await expect(page.getByText(/\bPlan\b/)).toHaveCount(0);

    await bar.tap();
    await expect(calendars(page)).toBeVisible();
    await expect(calendars(page).getByText('Koyomi', { exact: true })).toBeVisible();
    await expect(calendars(page).getByRole('button', { name: 'Add calendar account' })).toBeVisible();
    await expect(calendars(page).getByText(/\bPlan\b|waiting|Completed/)).toHaveCount(0);
    await expect(calendars(page).getByRole('textbox')).toHaveCount(0);

    // A tap on the day behind it puts it away again.
    await page.mouse.click(195, 60);
    await expect(calendars(page)).toBeHidden();
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
