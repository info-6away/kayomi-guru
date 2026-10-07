import { expect, test, type Page } from '@playwright/test';
import type { CalendarEvent, Category, PlanItem } from '../../lib/types';
import { check } from './contrast';
import { columns, event, open, plan, popover, seed } from './helpers';

// What a day is read by must be easy to read, in both themes and at every size (see contrast.ts
// for how that is measured). The line is WCAG AA: 4.5:1, or 3:1 for large text. Nothing is exempt.

const NOW = new Date(2026, 9, 7, 13, 10); // a Wednesday at midday: the week has past and coming events
const STAMP = '2026-10-01T08:00:00.000Z';

const at = (day: string, time: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min).toISOString();
};
const events: CalendarEvent[] = (
  [
    ['2026-10-05', '07:30', '08:30', 'Gym', 'life'],
    ['2026-10-05', '10:00', '11:30', 'Project review', 'work'],
    ['2026-10-06', '14:00', '16:30', 'Design work', 'focus'],
    ['2026-10-06', '18:00', '18:30', 'Call supplier', 'life', 'p-done'],
    ['2026-10-07', '09:00', '11:30', 'Focus', 'focus'],
    ['2026-10-07', '12:30', '13:30', 'Lunch', 'misc'],
    // An event nobody has coloured, later today: the one that used to disappear into the paper.
    ['2026-10-07', '18:00', '19:00', 'Interact meeting', 'misc'],
    ['2026-10-08', '11:00', '12:00', 'Team sync', 'work'],
    ['2026-10-09', '19:30', '21:30', 'Dinner', 'misc'],
    // Outside October, so the month view has a day from another month with something on it.
    ['2026-09-29', '10:00', '11:00', 'Documents', 'misc'],
  ] as [string, string, string, string, Category, string?][]
).map(([day, from, to, title, category, planItemId], i) => ({
  id: `e-${i}`,
  title,
  start: at(day, from),
  end: at(day, to),
  allDay: false,
  category,
  planItemId: planItemId ?? null,
  recurrence: null,
  createdAt: STAMP,
  updatedAt: STAMP,
}));
const planItems: PlanItem[] = [
  { id: 'p-1', title: 'Finish slides', status: 'open', createdAt: STAMP, updatedAt: STAMP },
  { id: 'p-2', title: 'Review budget', status: 'open', createdAt: STAMP, updatedAt: STAMP },
  { id: 'p-done', title: 'Call supplier', status: 'completed', createdAt: STAMP, updatedAt: STAMP },
];

async function start(page: Page, now = NOW) {
  await page.clock.setFixedTime(now);
  await seed(page, { events, planItems });
  await open(page);
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const size of [
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
    ]) {
      test(`everything on a ${size.width}×${size.height} screen is easy to read`, async ({ page }) => {
        await page.setViewportSize(size);
        await start(page);
        const week = await check(page, 'week');

        // The event from the brief: its title and its time, not just "legible" but plain.
        const ratio = (text: string) => week.find((r) => r.text === text)?.ratio ?? 0;
        expect(ratio('Interact meeting')).toBeGreaterThanOrEqual(10);
        expect(ratio('18:00 – 19:00')).toBeGreaterThanOrEqual(5.5);

        await page.keyboard.press('p');
        await plan(page).getByRole('button', { name: /Completed/ }).click();
        await check(page, 'week with Plan');
        await page.keyboard.press('p');
        await expect(plan(page)).toBeHidden();

        await event(page, 'Interact meeting').click();
        await expect(popover(page)).toBeVisible();
        await check(page, 'an event open');
        await page.keyboard.press('Escape');
        await expect(popover(page)).toHaveCount(0);

        await page.keyboard.press('m');
        await expect(page.getByText('Documents')).toBeVisible();
        await check(page, 'month');
      });
    }

    test('today is easy to read on a shaded weekend too', async ({ page }) => {
      // Vermilion on the weekend's slightly darker paper is the least contrast any text here has.
      await start(page, new Date(2026, 9, 10, 13, 10));
      await page.keyboard.press('m');
      await expect(page.getByText('Documents')).toBeVisible();
      await check(page, 'month, on a Saturday');
    });

    test.describe('phone', () => {
      test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

      test('everything on a 390×844 screen is easy to read', async ({ page }) => {
        await start(page);
        const day = await check(page, 'day');
        // Today's numeral on its filled disc: the one place small text sits on vermilion.
        expect(day.find((r) => r.text === '7' && r.size === 17)?.ratio).toBeGreaterThanOrEqual(4.5);

        await page.getByRole('button', { name: /^Plan/ }).tap();
        await plan(page).getByRole('button', { name: /Completed/ }).tap();
        await check(page, 'Plan');
        await plan(page).getByRole('button', { name: 'Close plan' }).tap();
        await expect(plan(page)).toBeHidden();

        await page.getByRole('button', { name: /October/ }).first().tap();
        await expect(columns(page)).toHaveCount(0);
        const month = await check(page, 'month');
        expect(month.find((r) => r.text === '7' && r.size === 16)?.ratio).toBeGreaterThanOrEqual(4.5);
      });
    });
  });
}
