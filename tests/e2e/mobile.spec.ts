import { expect, test, type Page } from '@playwright/test';
import type { CalendarEvent } from '../../lib/types';
import { check } from './contrast';
import { at, calendars, calendarsButton, colourOf, columns, event, fits, open, popover, seed, settled, stored } from './helpers';
import { ME, confirmation, connect, connectAlso, disconnectButton, google, group, ist, openCalendars, refresh, test as connected, view } from './connected';

// The readability pass that followed testers on Android phones: the day is never hidden under
// Calendars, Calendars looks like something to press, midnight has its label, what is read is easy
// to read, what is pressed is big enough, ending a connection is asked about first, failures are
// noticed, long titles cannot break the day, and ＋ opens where the person was looking.

const NOW = new Date(2026, 9, 7, 13, 10); // Wednesday 7 October 2026, 13:10
const TODAY = '2026-10-07';
const STAMP = '2026-10-01T08:00:00.000Z';
const local = (day: string, time: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min).toISOString();
};
const made = (id: string, day: string, from: string, to: string, title: string): CalendarEvent => ({
  id,
  title,
  start: local(day, from),
  end: local(day, to),
  allDay: false,
  category: 'misc',
  recurrence: null,
  createdAt: STAMP,
  updatedAt: STAMP,
});
/** One unbroken string, as a pasted address or code would be: nothing to wrap it at. */
const LONG = `https://example.com/${'a1B2c3D4'.repeat(24)}`;
const EVENTS = [made('late', TODAY, '23:00', '23:45', 'Late event'), made('long', TODAY, '15:00', '16:00', LONG), made('focus', TODAY, '09:00', '10:00', 'Focus')];

async function start(page: Page, events: CalendarEvent[] = EVENTS) {
  await page.clock.setFixedTime(NOW);
  await seed(page, { events });
  await open(page);
  await page.evaluate(() => document.fonts.ready);
}

const scroller = (page: Page) => columns(page).first().locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
const box = async (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
const shownDay = (page: Page) => columns(page).first().getAttribute('data-day');
/** The week strip's days, and the one chosen among them. */
const stripDays = (page: Page) => page.locator('button[aria-pressed].h-16');
const stripDay = (page: Page) => page.locator('button[aria-pressed="true"].h-16');

/** A one-finger swipe, as a phone's touchscreen sends it. */
async function swipe(page: Page, x: number, y: number, dx: number, fingers = 1) {
  const cdp = await page.context().newCDPSession(page);
  const points = (along: number) =>
    Array.from({ length: fingers }, (_, i) => ({
      x: x + along,
      y: y + i * 30,
      id: i,
    }));
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: points(0),
  });
  for (let i = 1; i <= 8; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points((dx * i) / 8),
    });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
  await page.waitForTimeout(250);
}

/** The line ＋ opens: which day it is in, and the time it starts at. */
async function quickAdd(page: Page) {
  const field = page.getByPlaceholder('What are you doing?');
  await expect(field).toBeFocused();
  return {
    day: await field.evaluate((el) => el.closest('[data-day]')!.getAttribute('data-day')),
    time: await field.evaluate((el) => el.parentElement!.firstElementChild!.textContent!.trim()),
  };
}

const PHONE = { hasTouch: true, isMobile: true };

test.describe('the day on a phone, down to midnight', () => {
  for (const viewport of [
    { width: 360, height: 800 }, // a small Android phone
    { width: 412, height: 915 }, // a large one, as Chrome reports a Pixel's
    { width: 390, height: 844 },
  ]) {
    test.describe(`${viewport.width}×${viewport.height}`, () => {
      test.use({ viewport, ...PHONE });

      test('scrolled to the end, the last hour is above Calendars and nothing is under it', async ({ page }) => {
        await start(page);
        await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
        const bar = await calendarsButton(page).boundingBox();
        const day = await box(page, '[data-day]');
        const late = await event(page, 'Late event').boundingBox();
        // Midnight's line, and the late event before it, are both above the bar.
        expect(day.bottom).toBeLessThanOrEqual(bar!.y);
        expect(late!.y + late!.height).toBeLessThanOrEqual(bar!.y);
        // And no great empty stretch was added to get there.
        expect(bar!.y - day.bottom).toBeLessThanOrEqual(48);
        await expect(page.locator('[data-hour="23"]')).toBeInViewport();
        // The bar is in reach at the foot, and the page itself never scrolls.
        expect(bar!.y + bar!.height).toBeLessThanOrEqual(viewport.height);
        expect(await fits(page)).toBe(true);
      });

      test('with a gesture bar or a notch, as an installed app is drawn, the bar grows by it and the day still ends above', async ({ page }) => {
        await start(page);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top: 24, bottom: 34 } } as never);
        await page.waitForTimeout(200);
        await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
        const bar = await calendarsButton(page).boundingBox();
        const word = await calendarsButton(page).locator('span').first().boundingBox();
        expect(bar!.height).toBe(64 + 34);
        // The word sits above the system's own bar, not under it.
        expect(word!.y + word!.height).toBeLessThanOrEqual(viewport.height - 34);
        expect((await box(page, '[data-day]')).bottom).toBeLessThanOrEqual(bar!.y);
        expect(await fits(page)).toBe(true);
      });
    });
  }
});

test.describe('Calendars looks like something to press', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...PHONE });

  test('a small chevron says it opens, and turns once it has; the bar says what it opens', async ({ page }) => {
    await start(page);
    const bar = calendarsButton(page);
    const chevron = bar.locator('[aria-hidden]');
    await expect(chevron).toHaveText('⌃');
    await expect(chevron).toBeVisible();
    await expect(bar).toHaveAttribute('aria-expanded', 'false');
    await expect(bar).toHaveAttribute('aria-controls', 'calendars');
    await expect(bar).toHaveAccessibleName(/^Calendars/);
    // Turned with the rotate property, which an inline box would ignore.
    const turn = () => chevron.evaluate((el) => ({ inline: getComputedStyle(el).display === 'inline', rotate: getComputedStyle(el).rotate }));
    expect(await turn()).toEqual({ inline: false, rotate: 'none' });

    await bar.tap();
    await expect(calendars(page)).toBeVisible();
    // What the bar says it controls is the sheet that opened.
    await expect(page.locator('#calendars')).toHaveAccessibleName('Calendars');
    await expect(bar).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(turn).toEqual({ inline: false, rotate: '180deg' });
    await calendars(page).getByRole('button', { name: 'Close calendars' }).tap();
    await expect(calendars(page)).toBeHidden();
    await expect(bar).toHaveAttribute('aria-expanded', 'false');
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`hour labels, ${theme}`, () => {
    test.use({ colorScheme: theme });

    test('midnight is labelled 00, exactly like every other hour, and the labels read plainly on a phone', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await start(page);
      // An hour label, not merely legible but plain: well above the 4.5:1 line.
      const readings = await check(page, `day, ${theme}`);
      expect(readings.find((r) => r.text === '12')!.ratio).toBeGreaterThanOrEqual(6.5);
      const hour = (h: number) => page.locator(`[data-hour="${h}"]`);
      await expect(hour(0)).toHaveText('00');
      await expect(page.locator('[data-hour]')).toHaveCount(24);
      const style = (h: number) =>
        hour(h).evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            size: s.fontSize,
            weight: s.fontWeight,
            colour: s.color,
            family: s.fontFamily,
          };
        });
      expect(await style(0)).toEqual(await style(12));
      expect((await style(0)).colour).toBe(await colourOf(page, '--hour'));
      // On its line, like the others: its middle is the top of the day.
      await scroller(page).evaluate((el) => (el.scrollTop = 0));
      const label = await hour(0).boundingBox();
      const day = await box(page, '[data-day]');
      expect(Math.abs(label!.y + label!.height / 2 - day.top)).toBeLessThanOrEqual(1);
      // Whole, inside the day as it scrolls, not cut off at its top.
      const view = (await scroller(page).boundingBox())!;
      expect(label!.y).toBeGreaterThanOrEqual(view.y);
    });
  });
}

test.describe('the hour labels at their sizes', () => {
  test('12px on a phone and 11.5px on a desktop', async ({ page }) => {
    await start(page);
    await expect(page.locator('[data-hour="12"]')).toHaveCSS('font-size', '11.5px');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-hour="12"]')).toHaveCSS('font-size', '12px');
  });
});

test.describe('a title too long for its event', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...PHONE });

  test('stays inside its event, cannot be swiped into the next day, and can be read whole in its details', async ({ page }) => {
    await start(page);
    const card = event(page, LONG);
    await card.scrollIntoViewIfNeeded();
    // Nothing spills out: not the card, not the day, not the page.
    const c = (await card.boundingBox())!;
    const column = await box(page, '[data-day]');
    expect(c.x + c.width).toBeLessThanOrEqual(column.right + 0.5);
    expect(await scroller(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    expect(await fits(page)).toBe(true);

    // Sideways across it, as if to read the rest: the day stays.
    await swipe(page, c.x + c.width * 0.75, c.y + c.height / 2, -160);
    expect(await shownDay(page)).toBe(TODAY);

    // Its details show all of it, wrapped onto as many lines as it needs, never scrolled sideways.
    await card.tap();
    await expect(popover(page)).toBeVisible();
    const title = popover(page).getByRole('textbox', { name: 'Title' });
    await expect(title).toHaveValue(LONG);
    expect(await title.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    expect(await title.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
    expect((await title.boundingBox())!.height).toBeGreaterThan(80);
    const details = (await popover(page).boundingBox())!;
    expect(details.x + details.width).toBeLessThanOrEqual(390);

    // Sideways across the title, as if to move along it: still the same day.
    const t = (await title.boundingBox())!;
    await swipe(page, t.x + t.width * 0.8, t.y + 20, -160);
    expect(await shownDay(page)).toBe(TODAY);
    await expect(popover(page)).toBeVisible();

    // A swipe across an empty stretch of the day still turns it.
    await popover(page).getByRole('button', { name: 'Close' }).tap();
    await expect(popover(page)).toHaveCount(0);
    const { column: day } = await at(page, TODAY, '18:00');
    const d = (await day.boundingBox())!;
    const empty = (await scroller(page).boundingBox())!;
    await swipe(page, d.x + d.width * 0.8, empty.y + empty.height / 2, -160);
    expect(await shownDay(page)).toBe('2026-10-08');
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`the month, ${theme}`, () => {
    test.use({ colorScheme: theme, hasTouch: true });

    for (const where of ['phone', 'desktop'] as const) {
      test(`on a ${where}, days of the months either side are a quieter, smaller numeral; today and the chosen day stand out from both`, async ({ page }) => {
        if (where === 'phone') await page.setViewportSize({ width: 390, height: 844 });
        await start(page, [...EVENTS, made('before', '2026-09-29', '10:00', '11:00', 'Documents')]);
        if (where === 'phone') {
          // Choose a day other than today first, so the chosen day and today can both be seen.
          await page.getByRole('button', { name: /^FRI\s*9/ }).tap();
          await page
            .getByRole('button', { name: /October/ })
            .first()
            .tap();
        } else await page.keyboard.press('m');
        await expect(page.locator('[data-outside]').first()).toBeVisible();

        const numeral = (selector: string) =>
          page
            .locator(selector)
            .first()
            .evaluate((el) => ({
              size: parseFloat(getComputedStyle(el).fontSize),
              colour: getComputedStyle(el).color,
              background: getComputedStyle(el).backgroundColor,
            }));
        const outside = await numeral('[data-outside]');
        const inside = await page
          .locator('.font-mincho:not([data-outside])')
          .filter({ hasText: /^14$/ })
          .first()
          .evaluate((el) => ({
            size: parseFloat(getComputedStyle(el).fontSize),
            colour: getComputedStyle(el).color,
          }));
        expect(outside.size).toBeLessThan(inside.size);
        expect(outside.colour).toBe(await colourOf(page, '--outside'));
        expect(inside.colour).toBe(await colourOf(page, '--ink'));
        expect(outside.colour).not.toBe(inside.colour);

        const today = await page
          .locator('.font-mincho')
          .filter({ hasText: /^7$/ })
          .first()
          .evaluate((el) => ({
            size: parseFloat(getComputedStyle(el).fontSize),
            colour: getComputedStyle(el).color,
          }));
        expect(today.colour).toBe(await colourOf(page, '--verm-text'));
        expect(today.size).toBe(inside.size);
        if (where === 'phone') {
          // The chosen day is the filled disc.
          const chosen = await page
            .locator('.font-mincho')
            .filter({ hasText: /^9$/ })
            .first()
            .evaluate((el) => getComputedStyle(el).backgroundColor);
          expect(chosen).toBe(
            await page.evaluate(() => {
              const probe = document.createElement('span');
              probe.style.backgroundColor = 'var(--ink)';
              document.body.append(probe);
              const c = getComputedStyle(probe).backgroundColor;
              probe.remove();
              return c;
            }),
          );
        }
        // Every numeral, the quiet ones included, still reads at WCAG AA.
        await check(page, `month on a ${where}`);
      });
    }
  });
}

test.describe('what a thumb presses', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...PHONE });

  test('an event’s close, delete and other controls each take a 44px tap, and none overlaps another; delete is not drawn any larger', async ({ page }) => {
    await start(page);
    await event(page, 'Focus').tap();
    await expect(popover(page)).toBeVisible();
    const controls = [
      popover(page).getByRole('textbox', { name: 'Title' }),
      popover(page).getByRole('button', { name: 'Close' }),
      popover(page).getByRole('button', { name: 'Delete' }),
      popover(page).getByRole('button', { name: 'All day' }),
      popover(page).getByRole('textbox', { name: 'Start' }),
      popover(page).getByRole('textbox', { name: 'End' }),
      popover(page).getByRole('combobox', { name: 'Repeat' }),
      ...['Work', 'Life', 'Focus', 'Other'].map((name) => popover(page).getByRole('button', { name, exact: true })),
    ];
    const boxes = [];
    for (const control of controls) {
      const b = (await control.boundingBox())!;
      const name = await control.evaluate((el) => el.getAttribute('aria-label') ?? el.textContent);
      if (name !== 'Title') {
        expect(b.width, name!).toBeGreaterThanOrEqual(44);
        expect(b.height, name!).toBeGreaterThanOrEqual(44);
      }
      boxes.push(b);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        expect(overlap, `${i} and ${j}`).toBeLessThan(1);
      }
    // Delete's words are the size they always were: a large target, not a large button.
    await expect(popover(page).getByRole('button', { name: 'Delete' })).toHaveCSS('font-size', '12.5px');

    await popover(page).getByRole('button', { name: 'Close' }).tap();
    await expect(popover(page)).toHaveCount(0);

    // The header's add, the sheet's close and the way back to today.
    expect((await page.getByRole('button', { name: 'Add', exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: /^FRI\s*9/ }).tap();
    const back = (await page.getByRole('button', { name: 'Today', exact: true }).boundingBox())!;
    expect(back.height).toBeGreaterThanOrEqual(44);
    await calendarsButton(page).tap();
    // Measured once the sheet has finished sliding in: mid-slide its transform leaves a fraction off.
    await settled(page);
    const close = (await calendars(page).getByRole('button', { name: 'Close calendars' }).boundingBox())!;
    expect(Math.round(Math.min(close.width, close.height))).toBeGreaterThanOrEqual(44);
  });
});

test.describe('＋', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...PHONE });

  test('opens on the day in view: at the next half-hour today, at 09:00 on another day, and where the person chose, if they did', async ({ page }) => {
    await start(page, []);
    const plus = page.getByRole('button', { name: 'Add', exact: true });

    await plus.tap();
    expect(await quickAdd(page)).toEqual({ day: TODAY, time: '13:30' });
    await page.keyboard.press('Escape');

    // Another day: that day, not today.
    await page.getByRole('button', { name: /^FRI\s*9/ }).tap();
    await plus.tap();
    expect(await quickAdd(page)).toEqual({ day: '2026-10-09', time: '09:00' });
    await page.keyboard.press('Escape');

    // A time chosen on the day, then ＋: the time chosen, not the default.
    const { column, position } = await at(page, '2026-10-09', '18:30');
    await column.tap({ position });
    expect(await quickAdd(page)).toEqual({ day: '2026-10-09', time: '18:30' });
    await plus.tap();
    expect(await quickAdd(page)).toEqual({ day: '2026-10-09', time: '18:30' });

    // Once used, the choice is spent: ＋ is back to the day's default.
    await page.keyboard.type('Evening walk');
    await page.keyboard.press('Enter');
    await expect(event(page, 'Evening walk')).toBeVisible();
    await plus.tap();
    expect(await quickAdd(page)).toEqual({ day: '2026-10-09', time: '09:00' });
    await page.keyboard.press('Escape');

    // Put away with Escape, it is spent too.
    const again = await at(page, '2026-10-09', '20:00');
    await again.column.tap({ position: again.position });
    await page.keyboard.press('Escape');
    await plus.tap();
    expect(await quickAdd(page)).toEqual({ day: '2026-10-09', time: '09:00' });
  });
});

for (const where of ['phone', 'desktop'] as const) {
  test(`times can be typed to the minute on a ${where}, with or without a colon`, async ({ page }) => {
    if (where === 'phone') await page.setViewportSize({ width: 390, height: 844 });
    await start(page, [made('meet', TODAY, '14:00', '15:00', 'Meeting')]);
    await event(page, 'Meeting').click();
    const from = popover(page).getByRole('textbox', { name: 'Start' });
    const until = popover(page).getByRole('textbox', { name: 'End' });
    // A phone's number pad has no colon: four digits are a time too.
    await from.fill('1405');
    await from.press('Enter');
    await expect(from).toHaveValue('14:05');
    await until.fill('14:20');
    await until.press('Enter');
    await expect(until).toHaveValue('14:20');
    const [saved] = (await stored(page)).events;
    const minutes = (iso: string) => new Date(iso).getHours() * 60 + new Date(iso).getMinutes();
    expect([minutes(saved.start), minutes(saved.end)]).toEqual([14 * 60 + 5, 14 * 60 + 20]);
    await expect(from).toHaveAttribute('title', 'Type any time, such as 14:05');
  });
}

test.describe('the week strip and the day', () => {
  for (const width of [320, 360, 412]) {
    test(`at ${width}px the weekdays say MON to SUN, with room to spare, and the header still fits`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width, height: 760 },
        ...PHONE,
      });
      const page = await context.newPage();
      await start(page);
      const labels = stripDays(page).locator('> span:first-child');
      await expect(labels).toHaveText(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
      for (const label of await labels.all()) {
        const fit = await label.evaluate((el) => ({
          text: el.scrollWidth,
          cell: el.parentElement!.clientWidth,
        }));
        expect(fit.text).toBeLessThanOrEqual(fit.cell - 8);
      }
      // Nothing in the header overflows the window, and from 360px up the wordmark is whole.
      expect(await fits(page)).toBe(true);
      if (width >= 360) {
        const whole = await page.getByText('koyomi', { exact: true }).evaluate((el) => el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right + 0.5);
        expect(whole).toBe(true);
      }
      await context.close();
    });
  }

  test.describe('swiping', () => {
    test.use({ viewport: { width: 390, height: 844 }, ...PHONE });

    test('the day moves a day at a time, the strip a week at a time keeping the weekday, and two fingers move nothing', async ({ page }) => {
      await start(page, []);
      const day = (await scroller(page).boundingBox())!;
      await swipe(page, day.x + day.width * 0.8, day.y + day.height / 2, -160);
      expect(await shownDay(page)).toBe('2026-10-08');
      await swipe(page, day.x + day.width * 0.2, day.y + day.height / 2, 160);
      expect(await shownDay(page)).toBe(TODAY);
      // The chosen day is the one marked in the strip.
      await expect(stripDay(page)).toContainText('7');

      const strip = (await stripDays(page).first().locator('xpath=..').boundingBox())!;
      await swipe(page, strip.x + strip.width * 0.8, strip.y + strip.height / 2, -160);
      expect(await shownDay(page)).toBe('2026-10-14');
      await expect(stripDay(page)).toContainText('WED');
      await expect(stripDay(page)).toContainText('14');

      await swipe(page, day.x + day.width * 0.8, day.y + 80, -160, 2);
      expect(await shownDay(page)).toBe('2026-10-14');
    });
  });
});

test('the theme switch says what it is and whether it is on', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await start(page);
  const button = page.getByRole('button', { name: 'Dark theme' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAttribute('title', 'Dark theme is off');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAttribute('title', 'Dark theme is on');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

// ---- With accounts connected, at the stand-ins ----

const THEM = 'b@example.test';
const second = () => ({
  calendars: [
    {
      id: THEM,
      summary: 'Personal',
      primary: true,
      selected: true,
      events: [
        {
          id: 'physio',
          summary: 'Physio',
          start: { dateTime: ist('2026-10-07', '17:00') },
          end: { dateTime: ist('2026-10-07', '18:00') },
        },
      ],
    },
  ],
});

connected.describe('ending a connection', () => {
  connected.describe.configure({ timeout: 90_000 });

  connected('Disconnect asks first; Cancel keeps the account; yes ends only that one, and Koyomi’s own events stay', async ({ page, id }) => {
    const other = `${id}b`;
    await google.has(other, second());
    await page.clock.setFixedTime(new Date('2026-10-07T10:10:00Z'));
    await seed(page, {
      events: [made('own', '2026-10-07', '08:00', '09:00', 'My own event')],
    });
    await open(page);
    await connect(page);
    await connectAlso(page, other, THEM);
    const own = (await stored(page)).events;

    // Asked, in words that say what it does, where the button was.
    await disconnectButton(page, ME).click();
    await expect(confirmation(page)).toBeVisible();
    await expect(confirmation(page)).toContainText('Disconnect this Google account?');
    await expect(confirmation(page)).toContainText('Its calendars will be removed from Koyomi');
    await expect(confirmation(page)).toContainText('Your own Koyomi events stay as they are.');
    await expect(confirmation(page).getByRole('button', { name: 'Cancel' })).toBeFocused();

    // Cancel: nothing has happened.
    await confirmation(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmation(page)).toHaveCount(0);
    await expect(group(page, ME)).toBeVisible();
    await expect(disconnectButton(page, ME)).toHaveAccessibleName(`Disconnect ${ME}`);

    // Yes: only that account goes.
    await disconnectButton(page, ME).click();
    await disconnectButton(page, ME).click();
    await expect(group(page, ME)).toHaveCount(0);
    await expect(group(page, THEM)).toBeVisible();
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0);
    expect((await stored(page)).events).toEqual(own);
  });

  connected.describe('on a phone at night', () => {
    connected.use({
      viewport: { width: 390, height: 844 },
      ...PHONE,
      colorScheme: 'dark',
    });

    connected('a failed Refresh is said in vermilion with its mark; Calendars is easy to read at night', async ({ page, id }) => {
      await page.clock.setFixedTime(new Date('2026-10-07T10:10:00Z'));
      await open(page);
      await connect(page);
      await google.becomes(id, { fail: 'unavailable' });
      await refresh(page);
      const note = view(page).getByRole('status');
      await expect(note).toHaveText(`Couldn’t read ${ME} just now. Try again in a moment.`);
      await expect(note).toHaveCSS('color', await colourOf(page, '--verm-text'));
      await expect(note.locator('svg')).toBeVisible();
      await google.becomes(id, { fail: null });

      // At night, the account's address reads as plainly as its calendars, and nothing is faint.
      await expect(group(page, ME).locator('[data-account] span').first()).toHaveCSS('color', await colourOf(page, '--ink'));
      await openCalendars(page);
      await check(page, 'Calendars at night, with an account', 6);
    });
  });
});
