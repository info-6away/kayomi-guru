import { expect } from '@playwright/test';
import { check } from './contrast';
import {
  FAKE,
  account,
  allDay,
  cached,
  cell,
  closeDrawer,
  connect,
  everythingStored,
  external,
  google,
  ist,
  openCalendars,
  refresh,
  start,
  test,
  toggle,
  view,
} from './connected';
import { addEvent, columns, event, fits, open, plan, popover, reload, seed, stored } from './helpers';

// Calendars connected from outside: Google, read-only. What only a real account can show is
// listed in docs/CALENDAR_CONNECTIONS.md under "Checking it against the real Google".

test.describe('someone who only uses Koyomi', () => {
  test('is asked nothing, and nothing is asked of the server', async ({ page, context }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/|:4315/.test(request.url())) asked.push(request.url());
    });
    await start(page);
    await addEvent(page, 'Lunch', '14:00', '2026-10-07');
    await page.keyboard.press('p');
    // The one new thing: a quiet line at the foot of Plan. Everything else is as it was.
    await expect(plan(page).getByRole('button', { name: 'Calendars' })).toBeVisible();
    await reload(page);
    await expect(event(page, 'Lunch')).toBeVisible();

    expect(asked).toEqual([]);
    expect((await context.cookies()).filter((cookie) => !cookie.name.startsWith('fake_'))).toEqual([]);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key !== 'kayomi-theme'))).toEqual([]);
  });

  test('can look at Calendars without anything starting', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      if (/\/api\//.test(request.url())) asked.push(request.url());
    });
    await start(page);
    await openCalendars(page);
    await expect(view(page)).toContainText('Koyomi');
    await expect(view(page).getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect(view(page)).toContainText('It can never change them.');
    await view(page).getByRole('button', { name: 'Back to Plan' }).click();
    await expect(plan(page)).toContainText('Nothing waiting.');
    expect(asked).toEqual([]);
  });
});

test.describe('connecting Google Calendar', () => {
  test('signs in, asks Google for read-only access, and shows the calendars', async ({ page, context, id }) => {
    const answers: string[] = [];
    page.on('response', async (response) => {
      if (response.url().includes('/api/google/') && response.request().resourceType() !== 'document') answers.push(await response.text().catch(() => ''));
    });
    await start(page);
    await connect(page);

    // Back on the calendar, at its own address, with nothing of the round trip left in it.
    expect(new URL(page.url()).search).toBe('');
    await expect(view(page)).toContainText('Koyomi');
    await expect(toggle(page, 'Personal')).toHaveAttribute('aria-checked', 'true');
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-checked', 'true');
    // Not ticked in Google's own app, so not shown here until asked for.
    await expect(toggle(page, 'Holidays')).toHaveAttribute('aria-checked', 'false');
    await expect(view(page)).toContainText('Read only. Koyomi never changes your Google Calendar.');

    // What Google was asked for: two read-only permissions, and nothing else.
    const { log } = await google.asked(id);
    const consent = log.find((entry) => entry.type === 'consent')!;
    expect(consent.scope).toBe('https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly');
    expect(consent).toMatchObject({ redirect_uri: 'http://localhost:4310/api/google/callback', access_type: 'offline', response_type: 'code', code_challenge_method: 'S256' });
    expect(consent).not.toHaveProperty('client_secret');
    // Repeating events arrive expanded by Google, and only titles and times are asked for.
    const reads = log.filter((entry) => entry.type === 'events');
    expect(reads.map((entry) => `${entry.calendarId} ${entry.mode}`).sort()).toEqual(['me@example.test everything', 'work@example.test everything']);
    for (const entry of reads) {
      expect(entry.singleEvents).toBe('true');
      expect(entry.fields).toBe('nextPageToken,nextSyncToken,items(id,status,summary,htmlLink,updated,eventType,start,end,attendees(self,responseStatus))');
    }

    // The session is a cookie page code cannot read. No token of Google's is anywhere a page can reach.
    const session = (await context.cookies()).find((cookie) => cookie.name === 'koyomi_session')!;
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    const onDevice = await everythingStored(page);
    expect(onDevice).not.toContain(id);
    expect(onDevice).not.toContain('koyomi_session');
    expect(answers.length).toBeGreaterThan(1);
    for (const answer of answers) expect(answer).not.toContain(id);
  });

  test('shows timed, all-day and repeating events in Week, Day and Month', async ({ page }) => {
    await start(page);
    await connect(page);
    await closeDrawer(page);

    // Week.
    await expect(columns(page)).toHaveCount(7);
    await expect(page.locator('[data-day="2026-10-07"]').locator(external(page, 'Dentist'))).toContainText('15:00 – 16:00');
    await expect(page.locator('[data-day="2026-10-07"]').locator(external(page, 'Weekly sync'))).toContainText('10:00 – 11:00');
    await expect(allDay(page, 'Mum’s birthday')).toBeVisible();
    // Three days long: one bar across Thursday, Friday and Saturday.
    const trip = (await allDay(page, 'Trip to Izmir').boundingBox())!;
    const thursday = (await page.locator('[data-day="2026-10-08"]').boundingBox())!;
    const saturday = (await page.locator('[data-day="2026-10-10"]').boundingBox())!;
    expect(trip.x).toBeGreaterThanOrEqual(thursday.x);
    expect(trip.x + trip.width).toBeGreaterThan(saturday.x + saturday.width / 2);
    expect(trip.x + trip.width).toBeLessThanOrEqual(saturday.x + saturday.width);
    // Declined, so it does not take up the time.
    await expect(event(page, 'Declined meeting')).toHaveCount(0);
    // The repeating meeting is there next week too, and the week after that it is not.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('[data-day="2026-10-14"]').locator(external(page, 'Weekly sync'))).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(event(page, 'Weekly sync')).toHaveCount(0);
    await page.keyboard.press('t');

    // Day.
    await page.keyboard.press('d');
    await expect(columns(page)).toHaveCount(1);
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(allDay(page, 'Mum’s birthday')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(allDay(page, 'Trip to Izmir')).toBeVisible();
    await expect(event(page, 'Dentist')).toHaveCount(0);

    // Month: all-day first and without a time, then by time.
    await page.keyboard.press('m');
    const seventh = cell(page, 7, 'Mum’s birthday');
    await expect(seventh).toHaveText(/7\s*Mum’s birthday\s*10:00\s*Weekly sync\s*15:00\s*Dentist/);
    for (const day of [8, 9, 10]) await expect(cell(page, day, 'Trip to Izmir')).toBeVisible();
    await expect(cell(page, 14, 'Weekly sync')).toBeVisible();
  });

  test('an external event is quieter than a Koyomi event, and never merged with one', async ({ page }) => {
    await start(page);
    await addEvent(page, 'Dentist', '15:00', '2026-10-07');
    await connect(page);
    await closeDrawer(page);

    // Same title, same time: still two things, side by side.
    const both = page.locator('[data-day="2026-10-07"] [data-event]', { hasText: 'Dentist' });
    await expect(both).toHaveCount(2);
    const mine = (await page.locator('[data-event]:not([data-external])', { hasText: 'Dentist' }).boundingBox())!;
    const theirs = (await external(page, 'Dentist').boundingBox())!;
    expect(Math.abs(mine.y - theirs.y)).toBeLessThan(2);
    expect(Math.min(mine.x + mine.width, theirs.x + theirs.width)).toBeLessThanOrEqual(Math.max(mine.x, theirs.x) + 1);
    expect((await stored(page)).events.map((e) => e.title)).toEqual(['Dentist']);

    // Koyomi's has a tint and heavier type; Google's has an outline on plain paper.
    const look = (title: string, own: boolean) =>
      page.locator(own ? '[data-event]:not([data-external])' : '[data-event][data-external]', { hasText: title }).evaluate((el) => ({
        fill: getComputedStyle(el).backgroundColor,
        weight: getComputedStyle(el.querySelectorAll('span')[1]).fontWeight,
        ink: getComputedStyle(el.querySelectorAll('span')[1]).color,
      }));
    const koyomi = await look('Dentist', true);
    const googles = await look('Dentist', false);
    expect(googles.fill).toBe('rgb(245, 241, 232)');
    expect(koyomi.fill).not.toBe(googles.fill);
    expect(Number(koyomi.weight)).toBeGreaterThan(Number(googles.weight));
    expect(koyomi.ink).not.toBe(googles.ink);
  });

  test('an external event can be looked at, opened in Google, and nothing else', async ({ page }) => {
    await start(page);
    await connect(page);
    await closeDrawer(page);
    const before = await cached(page);

    await external(page, 'Dentist').click();
    const details = popover(page);
    await expect(details).toHaveAttribute('data-external');
    await expect(details).toContainText('WEDNESDAY 7 OCTOBER');
    await expect(details).toContainText('Dentist');
    await expect(details).toContainText('15:00 – 16:00');
    await expect(details).toContainText('Google Calendar · Personal');
    // Nothing to type into, nothing to press but the way out to Google.
    await expect(details.locator('input, select, textarea')).toHaveCount(0);
    await expect(details.getByRole('button')).toHaveCount(0);
    for (const action of ['Mark done', 'Not done', 'Back to Plan', 'Delete', 'All day']) await expect(details.getByText(action, { exact: true })).toHaveCount(0);
    const link = details.getByRole('link', { name: 'Open in Google Calendar' });
    await expect(link).toHaveAttribute('href', 'https://www.google.com/calendar/event?eid=dentist');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);

    // It cannot be dragged to another time or stretched.
    const box = (await external(page, 'Dentist').boundingBox())!;
    for (const y of [box.y + 10, box.y + box.height - 2]) {
      await page.mouse.move(box.x + 40, y);
      await page.mouse.down();
      await page.mouse.move(box.x + 40, y + 120, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.press('Escape');
    }
    await expect(external(page, 'Dentist')).toContainText('15:00 – 16:00');
    expect((await external(page, 'Dentist').boundingBox())!.y).toBe(box.y);
    // Delete and Backspace do nothing to it either.
    await external(page, 'Dentist').focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await expect(external(page, 'Dentist')).toBeVisible();

    // An all-day one opens the same way.
    await allDay(page, 'Trip to Izmir').click();
    await expect(popover(page)).toContainText('Thu 8 Oct – Sat 10 Oct');
    await expect(popover(page)).toContainText('Google Calendar · Personal');
    await expect(popover(page).getByRole('button')).toHaveCount(0);

    expect(await cached(page)).toEqual(before);
    expect((await stored(page)).events).toEqual([]);
  });

  test('only titles and times reach this device', async ({ page }) => {
    await start(page);
    await connect(page);
    const { events, calendars } = await cached(page);
    expect(events.map((e) => e.title).sort()).toEqual(['Dentist', 'Mum’s birthday', 'Trip to Izmir', 'Weekly sync', 'Weekly sync']);
    expect(Object.keys(events.find((e) => e.title === 'Dentist')).sort()).toEqual(
      ['allDay', 'calendarId', 'end', 'fetchedAt', 'id', 'link', 'provider', 'providerEventId', 'start', 'status', 'timeZone', 'title', 'updatedAt'].sort(),
    );
    // The zone it was written in is kept beside the instant.
    expect(events.find((e) => e.title === 'Dentist')).toMatchObject({ start: '2026-10-07T12:00:00.000Z', end: '2026-10-07T13:00:00.000Z', timeZone: 'Europe/Istanbul', allDay: false });
    expect(events.find((e) => e.title === 'Trip to Izmir')).toMatchObject({ start: '2026-10-08', end: '2026-10-10', allDay: true });
    const everything = JSON.stringify({ events, calendars });
    for (const secret of ['PRIVATE', 'private.test', 'Declined', 'Republic Day']) expect(everything).not.toContain(secret);
  });
});

test.describe('choosing calendars', () => {
  test('a calendar can be shown or hidden, and a hidden one is neither read nor kept', async ({ page, id }) => {
    await start(page);
    await connect(page);
    await expect(event(page, 'Republic Day')).toHaveCount(0);

    await toggle(page, 'Holidays').click();
    await expect(toggle(page, 'Holidays')).toHaveAttribute('aria-checked', 'true');
    await expect(allDay(page, 'Republic Day')).toBeVisible();

    await toggle(page, 'Work').click();
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-checked', 'false');
    await expect(event(page, 'Weekly sync')).toHaveCount(0);
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect.poll(async () => (await cached(page)).events.map((e) => e.title).sort()).toEqual(['Dentist', 'Mum’s birthday', 'Republic Day', 'Trip to Izmir']);

    // The choice is this device's, and is still there after a reload.
    await reload(page);
    await expect(allDay(page, 'Republic Day')).toBeVisible();
    await expect(event(page, 'Weekly sync')).toHaveCount(0);
    await openCalendars(page);
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-checked', 'false');

    // While hidden, Work is not asked about at all.
    const before = (await google.asked(id)).log.filter((entry) => entry.calendarId === 'work@example.test').length;
    await refresh(page);
    expect((await google.asked(id)).log.filter((entry) => entry.calendarId === 'work@example.test').length).toBe(before);

    await toggle(page, 'Work').click();
    await expect(external(page, 'Weekly sync')).toBeVisible();
  });
});

test.describe('the all-day row', () => {
  test('an event of Koyomi’s own can be made all-day, and back', async ({ page }) => {
    await start(page);
    await expect(page.locator('[data-all-day]')).toHaveCount(0);
    await addEvent(page, 'Pay rent', '10:00', '2026-10-07');
    await event(page, 'Pay rent').click();
    await popover(page).getByRole('button', { name: 'All day' }).click();

    await expect(allDay(page, 'Pay rent')).toBeVisible();
    await expect(page.locator('[data-day] [data-event]')).toHaveCount(0);
    await expect(popover(page)).toContainText('All day');
    await expect(popover(page).getByLabel('Start')).toHaveCount(0);
    // Stored as its day, not as an instant, so it cannot drift to the day before or after.
    await expect.poll(async () => (await stored(page)).events[0]).toMatchObject({ title: 'Pay rent', allDay: true, start: '2026-10-07', end: '2026-10-07' });

    // It is still a Koyomi event: it can be renamed, moved to another day, repeated and deleted.
    await popover(page).getByLabel('Title').fill('Pay the rent');
    await page.keyboard.press('Enter');
    await popover(page).getByLabel('Date').fill('2026-10-09');
    await expect(allDay(page, 'Pay the rent')).toBeVisible();
    await expect.poll(async () => (await stored(page)).events[0]).toMatchObject({ start: '2026-10-09', end: '2026-10-09', allDay: true });
    await popover(page).getByLabel('Repeat').selectOption('weekly');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(allDay(page, 'Pay the rent')).toBeVisible();
    await page.keyboard.press('t');

    await reload(page);
    await allDay(page, 'Pay the rent').click();
    await popover(page).getByRole('button', { name: 'Set a time' }).click();
    await expect(page.locator('[data-day="2026-10-09"] [data-event]', { hasText: 'Pay the rent' })).toContainText('09:00 – 10:00');
    await expect(page.locator('[data-all-day]')).toHaveCount(0);
    await expect.poll(async () => (await stored(page)).events[0].allDay).toBe(false);
  });

  test('holds Koyomi’s and Google’s together, and folds when a day has many', async ({ page, id }) => {
    const more = account();
    more.calendars[1].events.push(
      { id: 'release', summary: 'Release day', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } } as never,
      { id: 'oncall', summary: 'On call', start: { date: '2026-10-07' }, end: { date: '2026-10-09' } } as never,
    );
    await google.has(id, more);
    await seed(page, {
      events: [{ id: 'rent', title: 'Pay rent', start: '2026-10-07', end: '2026-10-07', allDay: true, category: 'life', planItemId: null, recurrence: null, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' }],
    });
    await start(page);
    const headingsAlone = (await page.locator('.sticky').first().boundingBox())!.height;
    await connect(page);
    await closeDrawer(page);

    // Wednesday has four; two rows are shown and the rest are counted.
    const row = page.locator('[data-all-day]');
    await expect(row.locator('[data-event]')).toHaveCount(3);
    await expect(allDay(page, 'On call')).toBeVisible();
    await expect(allDay(page, 'Pay rent')).not.toHaveAttribute('data-external');
    await expect(allDay(page, 'Trip to Izmir')).toHaveAttribute('data-external');
    const folded = (await page.locator('.sticky').first().boundingBox())!.height;
    expect(folded - headingsAlone).toBeLessThanOrEqual(80);
    expect(await fits(page)).toBe(true);

    await row.getByRole('button', { name: '2 more all-day events' }).click();
    await expect(row.locator('[data-event]')).toHaveCount(5);
    await expect(allDay(page, 'Release day')).toBeVisible();
    await expect(allDay(page, 'Mum’s birthday')).toBeVisible();
    await row.getByRole('button', { name: 'less' }).click();
    await expect(row.locator('[data-event]')).toHaveCount(3);

    // The timed calendar underneath still works.
    await addEvent(page, 'Lunch', '13:00', '2026-10-07');
    await expect(page.locator('[data-day="2026-10-07"] [data-event]', { hasText: 'Lunch' })).toContainText('13:00 – 14:00');
  });
});

for (const [zone, expected] of [
  ['America/Los_Angeles', { day: '2026-10-07', time: '18:00 – 19:00' }],
  ['Pacific/Auckland', { day: '2026-10-08', time: '14:00 – 15:00' }],
  ['Asia/Kolkata', { day: '2026-10-08', time: '06:30 – 07:30' }],
] as const) {
  test.describe(`on a device in ${zone}`, () => {
    test.use({ timezoneId: zone });

    test('a timed event is at the right local time, and an all-day event on its own day', async ({ page, id }) => {
      await google.has(id, {
        calendars: [
          {
            id: 'me@example.test',
            summary: 'Personal',
            primary: true,
            selected: true,
            events: [
              // Six in the evening in Los Angeles, written in Los Angeles.
              { id: 'call', summary: 'Call with LA', start: { dateTime: '2026-10-07T18:00:00-07:00', timeZone: 'America/Los_Angeles' }, end: { dateTime: '2026-10-07T19:00:00-07:00', timeZone: 'America/Los_Angeles' } },
              { id: 'holiday', summary: 'Public holiday', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } },
            ],
          },
        ],
      });
      await page.clock.setFixedTime(new Date('2026-10-07T20:00:00Z'));
      await open(page);
      await connect(page);
      await closeDrawer(page);

      const call = page.locator(`[data-day="${expected.day}"]`).locator(external(page, 'Call with LA'));
      await expect(call).toContainText(expected.time);
      // The 7th is the 7th, whichever side of the date line the device is on.
      const holiday = (await allDay(page, 'Public holiday').boundingBox())!;
      const seventh = (await page.locator('[data-day="2026-10-07"]').boundingBox())!;
      expect(holiday.x).toBeGreaterThanOrEqual(seventh.x);
      expect(holiday.x + holiday.width).toBeLessThanOrEqual(seventh.x + seventh.width);

      await call.click();
      await expect(popover(page)).toContainText(expected.time);
      await page.keyboard.press('Escape');
      await page.keyboard.press('m');
      await expect(cell(page, 7, 'Public holiday')).toBeVisible();
      // What is kept is the instant and the zone it came with, not a time bent to this device.
      expect((await cached(page)).events.find((e) => e.title === 'Call with LA')).toMatchObject({ start: '2026-10-08T01:00:00.000Z', timeZone: 'America/Los_Angeles' });
    });
  });
}

test.describe('keeping up with Google', () => {
  test('a refresh asks only for what changed, and applies it', async ({ page, id }) => {
    await start(page);
    await connect(page);
    await google.changes(id, {
      calendarId: 'me@example.test',
      upsert: [
        { id: 'dentist', summary: 'Dentist (moved)', start: { dateTime: ist('2026-10-07', '16:30') }, end: { dateTime: ist('2026-10-07', '17:30') } },
        { id: 'haircut', summary: 'Haircut', start: { dateTime: ist('2026-10-08', '09:00') }, end: { dateTime: ist('2026-10-08', '09:30') } },
      ],
      cancel: ['birthday'],
    });
    await refresh(page);

    await expect(external(page, 'Dentist (moved)')).toContainText('16:30 – 17:30');
    await expect(external(page, 'Haircut')).toBeVisible();
    await expect(event(page, 'Mum’s birthday')).toHaveCount(0);
    await expect(external(page, 'Weekly sync')).toBeVisible();
    const reads = (await google.asked(id)).log.filter((entry) => entry.type === 'events').map((entry) => `${entry.calendarId} ${entry.mode}`);
    expect(reads.slice(-2).sort()).toEqual(['me@example.test changes', 'work@example.test changes']);
    await expect.poll(async () => (await cached(page)).events.map((e) => e.title).sort()).toEqual(['Dentist (moved)', 'Haircut', 'Trip to Izmir', 'Weekly sync', 'Weekly sync']);

    // Google lets a cursor lapse now and then. Everything is simply read again.
    await google.becomes(id, { staleCursors: true });
    await google.changes(id, { calendarId: 'work@example.test', cancel: ['sync_1'] });
    await refresh(page);
    await expect(page.locator('[data-day="2026-10-07"]').locator(external(page, 'Weekly sync'))).toHaveCount(0);
    await expect(external(page, 'Haircut')).toBeVisible();
    const again = (await google.asked(id)).log.filter((entry) => entry.type === 'events' && entry.calendarId === 'work@example.test').map((entry) => entry.mode);
    expect(again.slice(-2)).toEqual(['stale cursor', 'everything']);
  });

  test('a calendar removed at Google disappears here, with its events', async ({ page, id }) => {
    await start(page);
    await connect(page);
    await google.becomes(id, { removeCalendar: 'work@example.test' });
    await refresh(page);
    await expect(toggle(page, 'Work')).toHaveCount(0);
    await expect(event(page, 'Weekly sync')).toHaveCount(0);
    await expect(external(page, 'Dentist')).toBeVisible();
    expect((await cached(page)).calendars.map((c) => c.name).sort()).toEqual(['Holidays', 'Personal']);
  });

  test('only a bounded span is read: five weeks back, twenty-seven ahead', async ({ page, id }) => {
    await start(page);
    await connect(page);
    const read = (await google.asked(id)).log.find((entry) => entry.type === 'events')!;
    // From the start of 2 September to the end of 14 April, on this device's clock.
    expect(read).toMatchObject({ timeMin: '2026-09-01T21:00:00.000Z', timeMax: '2027-04-14T21:00:00.000Z' });
  });
});

test.describe('when Google or the connection fails', () => {
  test('with no connection the calendar carries on, Google events included', async ({ page, context, id }) => {
    await start(page);
    await connect(page);
    await closeDrawer(page);
    const before = await cached(page);

    // The worker finishes saving the page a moment after the first visit, and until it has there
    // is no offline. (Not offlineReady: with the clock fixed, the page cannot list what it loaded.)
    await page.evaluate(async () => void (await navigator.serviceWorker.ready));
    await context.setOffline(true);
    await reload(page);
    await expect(external(page, 'Dentist')).toContainText('15:00 – 16:00');
    await expect(allDay(page, 'Trip to Izmir')).toBeVisible();
    // Koyomi's own calendar is exactly as usable as it ever was.
    await addEvent(page, 'Written in a tunnel', '17:00', '2026-10-07');
    await openCalendars(page);
    await refresh(page);
    await expect(toggle(page, 'Personal')).toHaveAttribute('aria-checked', 'true');
    // Being offline is not something to reconnect, and nothing says it is.
    await expect(page.getByText(/reconnect|couldn’t|offline/i)).toHaveCount(0);
    expect(await cached(page)).toEqual(before);

    await context.setOffline(false);
    await google.changes(id, { calendarId: 'me@example.test', upsert: [{ id: 'new', summary: 'Added meanwhile', start: { dateTime: ist('2026-10-07', '19:00') }, end: { dateTime: ist('2026-10-07', '20:00') } }] });
    await refresh(page);
    await expect(external(page, 'Added meanwhile')).toBeVisible();
    await expect(event(page, 'Written in a tunnel')).toBeVisible();
  });

  test('if Google is failing or limiting requests, what was read stays and nothing is said', async ({ page, id }) => {
    await start(page);
    await connect(page);
    for (const fail of ['unavailable', 'limited'] as const) {
      await google.becomes(id, { fail });
      await refresh(page);
      await expect(external(page, 'Dentist')).toBeVisible();
      await expect(toggle(page, 'Work')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText(/reconnect|couldn’t/i)).toHaveCount(0);
    }
    await google.becomes(id, { fail: null });
    await google.changes(id, { calendarId: 'me@example.test', cancel: ['dentist'] });
    await refresh(page);
    await expect(event(page, 'Dentist')).toHaveCount(0);
  });

  // Found against the real Google: the Calendar API was not enabled in the app's own Google Cloud
  // project. That is the operator's to mend, not the person's, and consenting again cannot.
  test('if the Calendar API is switched off for the app itself, nobody is asked to reconnect', async ({ page, id }) => {
    const consents = async () => (await google.asked(id)).log.filter((entry) => entry.type === 'consent').length;
    await start(page);
    await connect(page);
    await google.becomes(id, { fail: 'disabled' });
    await refresh(page);
    // What was read stays, nothing is said, and the connection is not marked as needing the person.
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(page.getByText(/reconnect|couldn’t/i)).toHaveCount(0);
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBe('connected');

    // The operator switches it on: reading simply carries on, with no visit to Google's consent screen.
    await google.becomes(id, { fail: null });
    await google.changes(id, { calendarId: 'me@example.test', cancel: ['dentist'] });
    await refresh(page);
    await expect(event(page, 'Dentist')).toHaveCount(0);
    await expect(page.getByText(/reconnect/i)).toHaveCount(0);
    expect(await consents()).toBe(1);
  });

  test('connecting while the Calendar API is switched off says to try again, and trying again needs no second consent', async ({ page, id }) => {
    const consents = async () => (await google.asked(id)).log.filter((entry) => entry.type === 'consent').length;
    await google.becomes(id, { fail: 'disabled' });
    await start(page);
    await openCalendars(page);
    await view(page).getByRole('button', { name: 'Connect', exact: true }).click();

    // Consent was given and kept. Only the first reading failed, and the person is told what to do.
    await expect(view(page)).toContainText('Your calendars couldn’t be read just now. Press Connect again in a moment.', { timeout: 15_000 });
    await expect(view(page).getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    await expect(page.getByText(/reconnect/i)).toHaveCount(0);
    expect(await consents()).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();

    // Switched on: Connect finds the permission already given and goes straight to the calendars.
    await google.becomes(id, { fail: null });
    await view(page).getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(toggle(page, 'Personal')).toBeVisible({ timeout: 15_000 });
    await closeDrawer(page);
    await expect(external(page, 'Dentist')).toBeVisible();
    expect(await consents()).toBe(1);
  });

  test('if the permission is withdrawn at Google, one quiet line says so and reconnecting mends it', async ({ page, id }) => {
    await start(page);
    await connect(page);
    await addEvent(page, 'My own event', '17:00', '2026-10-07');
    await google.becomes(id, { revoked: true });
    await refresh(page);

    await expect(view(page)).toContainText('Google Calendar needs reconnecting');
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toHaveCount(0);
    // What was read before is still on screen, and Koyomi itself is untouched.
    await expect(external(page, 'Dentist')).toBeVisible();
    await closeDrawer(page);
    const line = page.getByRole('button', { name: 'Google Calendar needs reconnecting' });
    await expect(line).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(1); // only the framework's own announcer, which is always there
    await addEvent(page, 'Still works', '18:30', '2026-10-07');
    await reload(page);
    await expect(line).toBeVisible();
    await expect(external(page, 'Dentist')).toBeVisible();
    // Nothing more is asked of Google until the person acts.
    const calls = (await google.asked(id)).log.length;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    expect((await google.asked(id)).log.length).toBe(calls);

    await line.click();
    await expect(view(page)).toBeVisible();
    await google.changes(id, { calendarId: 'me@example.test', cancel: ['dentist'] });
    await view(page).getByRole('button', { name: 'Reconnect' }).click();
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.getByText('Google Calendar needs reconnecting')).toHaveCount(0);
    await expect(event(page, 'Dentist')).toHaveCount(0);
    await expect(event(page, 'My own event')).toBeVisible();
    await expect(event(page, 'Still works')).toBeVisible();
    expect((await google.asked(id)).log.filter((entry) => entry.type === 'consent')).toHaveLength(2);
  });

  test('cancelling at Google, or giving only part of the permission, connects nothing', async ({ page, context, id }) => {
    await start(page);
    await context.addCookies([{ name: 'fake_google', value: `deny:${id}`, url: FAKE }]);
    await openCalendars(page);
    await view(page).getByRole('button', { name: 'Connect' }).click();
    await expect(view(page).getByRole('status')).toHaveText('Google Calendar was not connected.');
    await expect(view(page).getByRole('button', { name: 'Connect' })).toBeVisible();

    await context.addCookies([{ name: 'fake_google', value: `partial:${id}`, url: FAKE }]);
    await view(page).getByRole('button', { name: 'Connect' }).click();
    await expect(view(page).getByRole('status')).toContainText('needs both permissions');
    await expect(view(page).getByRole('button', { name: 'Connect' })).toBeVisible();
    // The half-given permission was handed straight back, and nothing was kept.
    const { log, liveTokens } = await google.asked(id);
    expect(log.map((entry) => entry.type)).toEqual(['consent', 'consent', 'grant', 'revoke']);
    expect(liveTokens).toBe(0);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();
    expect((await page.request.get('/api/google/calendars')).status()).toBe(409);
  });
});

test.describe('disconnecting', () => {
  test('withdraws the permission, deletes the token and this device’s copy, and leaves Koyomi alone', async ({ page, context, id }) => {
    await seed(page, {
      events: [{ id: 'mine', title: 'My own event', start: '2026-10-07T14:00:00.000Z', end: '2026-10-07T15:00:00.000Z', allDay: false, category: 'work', planItemId: 'p1', recurrence: null, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' }],
      planItems: [
        { id: 'p1', title: 'My own event', status: 'open', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' },
        { id: 'p2', title: 'Still waiting', status: 'open', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' },
      ],
    });
    await start(page);
    const mine = await stored(page);
    await connect(page);
    await toggle(page, 'Holidays').click();
    await expect(allDay(page, 'Republic Day')).toBeVisible();
    // Connecting and reading did not touch a single Koyomi record.
    expect(await stored(page)).toEqual(mine);

    await view(page).getByRole('button', { name: 'Disconnect' }).click();
    await expect(view(page).getByRole('button', { name: 'Connect' })).toBeVisible();

    // On screen: Google's events are gone, Koyomi's are not.
    await expect(page.locator('[data-external]')).toHaveCount(0);
    await expect(page.locator('[data-all-day]')).toHaveCount(0);
    await expect(event(page, 'My own event')).toBeVisible();
    // At Google: the permission is withdrawn.
    const { log, revoked, liveTokens } = await google.asked(id);
    expect(log.at(-1)!.type).toBe('revoke');
    expect([revoked, liveTokens]).toEqual([true, 0]);
    // On the server: no connection, and no session either.
    expect((await context.cookies()).some((cookie) => cookie.name === 'koyomi_session')).toBe(false);
    expect((await page.request.get('/api/google/calendars')).status()).toBe(401);
    // On this device: the copy is deleted, the calendar is exactly what it was.
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();
    expect(await stored(page)).toEqual(mine);

    await reload(page);
    await expect(event(page, 'My own event')).toBeVisible();
    await expect(page.locator('[data-external]')).toHaveCount(0);
    await page.keyboard.press('p');
    await expect(plan(page).getByRole('button', { name: 'Still waiting', exact: true })).toBeVisible();

    // And it can be connected again, cleanly.
    await connect(page);
    await expect(external(page, 'Dentist')).toBeVisible();
    expect(await stored(page)).toEqual(mine);
  });

  test('works after the session has lapsed: sign in, then it finishes', async ({ page, context, id }) => {
    await start(page);
    await connect(page);
    await context.clearCookies({ name: 'koyomi_session' });
    await view(page).getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.locator('[data-external]')).toHaveCount(0);
    await expect.poll(async () => (await google.asked(id)).revoked).toBe(true);
    expect(new URL(page.url()).search).toBe('');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();
  });
});

test.describe('the server', () => {
  test('answers only the signed-in person, from this site, about their own connection', async ({ page, browser, id }) => {
    const ask = { timeMin: '2026-10-01T00:00:00Z', timeMax: '2026-11-01T00:00:00Z', calendars: [{ calendarId: 'me@example.test', syncToken: null }] };
    const mine = { origin: 'http://localhost:4310' };

    // Signed out: nothing.
    for (const path of ['/api/google/calendars']) expect((await page.request.get(path)).status()).toBe(401);
    for (const path of ['/api/google/events', '/api/google/disconnect']) expect((await page.request.post(path, { data: ask, headers: mine })).status()).toBe(401);

    await start(page);
    await connect(page);
    expect((await page.request.post('/api/google/events', { data: ask, headers: mine })).status()).toBe(200);
    // From another site, or from nowhere in particular: refused, even with the session.
    expect((await page.request.post('/api/google/events', { data: ask, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
    expect((await page.request.post('/api/google/events', { data: ask })).status()).toBe(403);
    expect((await page.request.post('/api/google/disconnect', { data: {}, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
    // Not what the app would ask: refused.
    for (const bad of [{}, { ...ask, timeMax: '2029-01-01T00:00:00Z' }, { ...ask, timeMin: 'yesterday' }, { ...ask, calendars: 'all' }, { ...ask, calendars: [{ calendarId: 7 }] }]) {
      expect((await page.request.post('/api/google/events', { data: bad, headers: mine })).status(), JSON.stringify(bad)).toBe(400);
    }
    // A calendar this account does not have is simply not there.
    const other = await page.request.post('/api/google/events', { data: { ...ask, calendars: [{ calendarId: 'someone-else@example.test', syncToken: null }] }, headers: mine });
    expect(await other.json()).toEqual({ calendars: [{ calendarId: 'someone-else@example.test', gone: true }] });
    // Answers are never to be kept by a browser or anything in between.
    expect((await page.request.get('/api/google/calendars')).headers()['cache-control']).toBe('no-store');

    // Someone else, signed in as themselves, has no connection: not this one, not any.
    const theirs = await browser.newContext();
    await theirs.addCookies([{ name: 'fake_user', value: `stranger-${id}`, url: FAKE }]);
    const stranger = await theirs.newPage();
    await stranger.goto('/api/auth/signin?returnTo=%2F');
    await expect(stranger.getByText('koyomi', { exact: true })).toBeVisible();
    const refused = await stranger.request.get('/api/google/calendars');
    expect([refused.status(), await refused.json()]).toEqual([409, { error: 'not_connected' }]);
    await theirs.close();
  });

  test('never has an answer about a calendar kept by the service worker', async ({ page }) => {
    await start(page);
    await connect(page);
    await reload(page);
    await openCalendars(page);
    await refresh(page);
    const kept = await page.evaluate(async () => {
      const urls = [];
      for (const name of await caches.keys()) urls.push(...(await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname));
      return urls;
    });
    expect(kept.length).toBeGreaterThan(3);
    expect(kept.filter((path) => path.startsWith('/api/'))).toEqual([]);
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('everything about connected calendars is easy to read', async ({ page }) => {
      await seed(page, {
        events: [
          { id: 'k1', title: 'Focus', start: '2026-10-07T06:00:00.000Z', end: '2026-10-07T08:00:00.000Z', allDay: false, category: 'focus', planItemId: null, recurrence: null, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' },
          { id: 'k2', title: 'Pay rent', start: '2026-10-08', end: '2026-10-08', allDay: true, category: 'life', planItemId: null, recurrence: null, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' },
        ],
      });
      await start(page);
      await page.evaluate(() => document.fonts.ready);
      await openCalendars(page);
      await check(page, 'Calendars, before connecting');
      await connect(page);
      await check(page, 'Calendars, connected');
      await closeDrawer(page);
      await check(page, 'week with Google events');
      await external(page, 'Dentist').click();
      await check(page, 'a Google event open');
      await page.keyboard.press('Escape');
      await page.keyboard.press('m');
      await expect(cell(page, 7, 'Mum’s birthday')).toBeVisible();
      await check(page, 'month with Google events');
    });
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('connects, shows Google events in the day and the all-day row, and stays readable', async ({ page }) => {
    await start(page);
    await page.evaluate(() => document.fonts.ready);
    await connect(page);
    await check(page, 'Calendars on a phone');
    await toggle(page, 'Holidays').tap();
    await expect(toggle(page, 'Holidays')).toHaveAttribute('aria-checked', 'true');
    await closeDrawer(page);

    await expect(columns(page)).toHaveCount(1);
    await expect(allDay(page, 'Mum’s birthday')).toBeVisible();
    await expect(external(page, 'Dentist')).toContainText('15:00 – 16:00');
    await check(page, 'day with Google events');
    expect(await fits(page)).toBe(true);

    await external(page, 'Weekly sync').tap();
    await expect(popover(page)).toContainText('Google Calendar · Work');
    await expect(popover(page).getByRole('button')).toHaveCount(0);
    await check(page, 'a Google event open on a phone');
    await page.mouse.click(195, 300);

    // Friday has the trip and the holiday.
    await page.getByRole('button', { name: /^F\s*9$/ }).tap();
    await expect(allDay(page, 'Trip to Izmir')).toBeVisible();
    await expect(allDay(page, 'Republic Day')).toBeVisible();
  });
});
