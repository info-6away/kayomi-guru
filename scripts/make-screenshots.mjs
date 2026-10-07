// Takes Koyomi's pictures of itself: the design baseline in docs/design, and the two screenshots
// the manifest shows when someone installs the app.
// Start `npm run preview` in another terminal, then run `npm run screenshots`. The files are committed.
//
// Every picture is the production build with one neutral sample week, the clock stopped on
// Monday 5 October 2026 at 14:25. The sample week exists only here; the app itself starts empty.

import { chromium } from '@playwright/test';

const APP = 'http://localhost:4310/';
const NOW = new Date(2026, 9, 5, 14, 25);
const STAMP = '2026-10-01T00:00:00.000Z';

const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

function sampleWeek() {
  const events = [];
  const add = (day, from, to, title, category, planItemId = null) => events.push({ day, from, to, title, category, planItemId });
  add('2026-10-05', '07:30', '08:30', 'Gym', 'life');
  add('2026-10-05', '10:00', '11:30', 'Project review', 'work');
  add('2026-10-05', '12:30', '13:15', 'Lunch', 'misc');
  add('2026-10-05', '15:30', '16:00', 'School', 'life');
  add('2026-10-05', '19:00', '20:00', 'Dinner', 'misc');
  add('2026-10-06', '10:00', '10:45', 'Documents', 'work');
  add('2026-10-06', '14:00', '16:30', 'Design work', 'focus');
  add('2026-10-06', '18:00', '18:30', 'Call supplier', 'life', 'p6');
  add('2026-10-07', '09:00', '11:30', 'Focus', 'focus');
  add('2026-10-07', '12:30', '13:30', 'Lunch', 'misc');
  add('2026-10-08', '07:30', '08:30', 'Gym', 'life');
  add('2026-10-08', '11:00', '12:00', 'Team sync', 'work');
  add('2026-10-08', '15:30', '16:00', 'School', 'life');
  add('2026-10-09', '09:30', '10:30', 'Project review', 'work');
  add('2026-10-09', '19:30', '21:30', 'Dinner', 'misc');
  // The weeks either side, so the month view is not one busy row.
  for (let week = -2; week <= 6; week++) {
    if (!week) continue;
    const monday = addDays('2026-10-05', week * 7);
    for (const day of [monday, addDays(monday, 3)]) {
      add(day, '07:30', '08:30', 'Gym', 'life');
      add(day, '15:30', '16:00', 'School', 'life');
    }
  }
  add('2026-10-14', '18:00', '18:30', 'Call supplier', 'life');
  add('2026-10-15', '10:00', '11:00', 'Project review', 'work');
  add('2026-10-16', '19:30', '21:00', 'Dinner', 'misc');
  add('2026-10-20', '09:00', '11:00', 'Focus', 'focus');
  add('2026-10-21', '11:00', '12:00', 'Team sync', 'work');
  add('2026-10-22', '14:00', '16:00', 'Design work', 'focus');
  add('2026-10-27', '11:00', '11:45', 'Documents', 'work');
  add('2026-10-30', '19:00', '20:30', 'Dinner', 'misc');
  const plan = [
    ['p1', 'Finish slides', 'open'],
    ['p2', 'Send documents', 'open'],
    ['p3', 'Review budget', 'open'],
    ['p4', 'Gym', 'open'],
    ['p5', 'Book dentist', 'open'],
    ['p6', 'Call supplier', 'open'],
    ['p7', 'Renew passport photos', 'completed'],
  ];
  return { events, plan };
}

/** Opens the app in a fresh profile with the sample week saved, as if it had been used for a while. */
async function openApp(browser, options) {
  const context = await browser.newContext({ deviceScaleFactor: 1, ...options });
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(APP);
  await page.getByText('koyomi').first().waitFor();
  await page.evaluate(
    async ({ events, plan, stamp }) => {
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open('kayomi', 1);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const instant = (day, time) => {
        const [y, m, d] = day.split('-').map(Number);
        const [h, min] = time.split(':').map(Number);
        return new Date(y, m - 1, d, h, min).toISOString();
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['events', 'planItems'], 'readwrite');
        events.forEach((e, i) =>
          tx.objectStore('events').put({
            id: `sample-${i}`,
            title: e.title,
            start: instant(e.day, e.from),
            end: instant(e.day, e.to),
            allDay: false,
            category: e.category,
            planItemId: e.planItemId,
            recurrence: null,
            createdAt: stamp,
            updatedAt: stamp,
          }),
        );
        // Plan lists items oldest first, so each is a second newer than the one before.
        plan.forEach(([id, title, status], i) =>
          tx.objectStore('planItems').put({ id, title, status, createdAt: `2026-10-01T00:00:0${i}.000Z`, updatedAt: stamp }),
        );
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    },
    { ...sampleWeek(), stamp: STAMP },
  );
  await page.reload();
  await page.getByText('koyomi').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

async function shot(page, path) {
  await page.mouse.move(700, 40); // off the grid, so no hover marker is captured
  await page.waitForTimeout(500); // the Plan drawer has finished sliding
  await page.screenshot({ path });
  console.log('wrote', path);
}

const DESKTOP = { viewport: { width: 1440, height: 900 } };
// Twice the pixel density, so the type stays legible in a picture this narrow.
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

const browser = await chromium.launch({ channel: 'chrome' });

for (const theme of ['light', 'dark']) {
  const desktop = await openApp(browser, { ...DESKTOP, colorScheme: theme });
  await shot(desktop.page, `docs/design/desktop-week-${theme}.png`);
  await desktop.page.keyboard.press('p');
  await shot(desktop.page, `docs/design/desktop-week-plan-${theme}.png`);
  if (theme === 'light') {
    // What an installer sees: the week with Plan beside it, and one day on a phone.
    await shot(desktop.page, 'public/screenshots/desktop.png');
    await desktop.page.keyboard.press('p');
    await desktop.page.waitForTimeout(400);
    await desktop.page.keyboard.press('m');
    await shot(desktop.page, 'docs/design/desktop-month-light.png');
  }
  await desktop.context.close();

  const phone = await openApp(browser, { ...PHONE, colorScheme: theme });
  await shot(phone.page, `docs/design/mobile-day-${theme}.png`);
  if (theme === 'light') {
    await shot(phone.page, 'public/screenshots/phone.png');
    await phone.page.getByRole('button', { name: /^Plan/ }).tap();
    await shot(phone.page, 'docs/design/mobile-plan-light.png');
  }
  await phone.context.close();
}

await browser.close();
