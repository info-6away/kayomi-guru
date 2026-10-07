import { expect, test, type Page } from '@playwright/test';
import type { CalendarEvent, Category, PlanItem } from '../../lib/types';
import { columns, event, open, plan, popover, seed } from './helpers';

// What a day is read by must be easy to read, in both themes and at every size. Each piece of text
// on screen is compared with the pixels actually behind it, so a tint, a faded parent or a new
// colour cannot quietly slip under the line.
//
// The line is WCAG AA: 4.5:1, or 3:1 for large text. One thing is held to 3:1 on purpose: the
// numeral on today's vermilion disc. The disc is the accent itself, and darkening it would change it.

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

interface Reading {
  text: string;
  ratio: number;
  size: number;
  /** Large enough, or the numeral on the accent disc: held to 3:1 instead of 4.5:1. */
  lenient: boolean;
  /** Dimmed with opacity rather than set in a colour of its own. */
  faded: boolean;
}

/** Every piece of text on screen, with its contrast against what is really behind it. */
async function read(page: Page): Promise<Reading[]> {
  // Nothing hovered, and every slide and fade finished.
  await page.mouse.move(5, 5);
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
  const screenshot = (await page.screenshot()).toString('base64');

  return page.evaluate(async (png) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;

    /** The colour filling most of a box: its background, since text covers less than half of it. */
    const behind = (box: DOMRect) => {
      const counts = new Map<number, number>();
      for (let y = Math.max(0, Math.floor(box.top)); y < Math.min(image.height, Math.ceil(box.bottom)); y++) {
        for (let x = Math.max(0, Math.floor(box.left)); x < Math.min(image.width, Math.ceil(box.right)); x++) {
          const i = (y * image.width + x) * 4;
          const colour = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
          counts.set(colour, (counts.get(colour) ?? 0) + 1);
        }
      }
      const [most] = [...counts].sort((a, b) => b[1] - a[1])[0];
      return [(most >> 16) & 255, (most >> 8) & 255, most & 255];
    };
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    /** Any CSS colour as red, green, blue and alpha. */
    const probe = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
    const rgba = (colour: string) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = colour;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      return a ? [(r * 255) / a, (g * 255) / a, (b * 255) / a, a / 255] : [0, 0, 0, 0];
    };
    const accent = rgba(getComputedStyle(document.documentElement).getPropertyValue('--verm')).slice(0, 3).map(Math.round).join();

    const out = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent!.trim();
      const element = node.parentElement!;
      if (!text || seen.has(element)) continue;
      seen.add(element);
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.visibility === 'hidden' || box.width < 2 || box.height < 2) continue;
      // On screen, and not underneath something else.
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!top || !(element === top || element.contains(top) || top.contains(element))) continue;

      let opacity = 1;
      for (let parent: Element | null = element; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
      const [r, g, b, a] = rgba(style.color);
      // Hidden on purpose, like the hour label that makes way for the current time.
      if (a * opacity === 0) continue;
      const background = behind(box);
      const ink = [r, g, b].map((v, i) => v * a * opacity + background[i] * (1 - a * opacity));
      const [lighter, darker] = [luminance(ink), luminance(background)].sort((x, y) => y - x);
      const size = parseFloat(style.fontSize);
      out.push({
        text: text.slice(0, 30),
        ratio: Math.round(((lighter + 0.05) / (darker + 0.05)) * 10) / 10,
        size,
        lenient: size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) || background.join() === accent,
        faded: opacity < 1,
      });
    }
    return out;
  }, screenshot);
}

async function check(page: Page, screen: string) {
  const readings = await read(page);
  expect(readings.length, `${screen}: text found`).toBeGreaterThan(10);
  const hard = readings.filter((r) => r.ratio < (r.lenient ? 3 : 4.5)).map((r) => `"${r.text}" ${r.ratio}:1 at ${r.size}px`);
  expect(hard, `${screen}: text that is hard to read`).toEqual([]);
  expect(readings.filter((r) => r.faded).map((r) => r.text), `${screen}: text dimmed with opacity`).toEqual([]);
  return readings;
}

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
        await check(page, 'day');

        await page.getByRole('button', { name: /^Plan/ }).tap();
        await plan(page).getByRole('button', { name: /Completed/ }).tap();
        await check(page, 'Plan');
        await plan(page).getByRole('button', { name: 'Close plan' }).tap();
        await expect(plan(page)).toBeHidden();

        await page.getByRole('button', { name: /October/ }).first().tap();
        await expect(columns(page)).toHaveCount(0);
        await check(page, 'month');
      });
    });
  });
}
