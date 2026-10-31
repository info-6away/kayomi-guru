import { expect, type Page } from '@playwright/test';
import {
  FAKE,
  ME,
  addAt,
  addButton,
  cached,
  choice,
  closeDrawer,
  connect,
  connectMicrosoft,
  everythingStored,
  external,
  graphTime,
  group,
  microsoft,
  openCalendars,
  refresh,
  start,
  test,
  toggle,
  unfold,
  view,
} from './connected';
import { addEvent, event, popover, reload } from './helpers';

// Calendar links: a published calendar (an .ics feed) the person subscribes to by its private
// link, beside their Google and Microsoft accounts. Everything runs against a stand-in for where
// calendars are published (tests/fakes/feeds.mjs), the one address the app's test settings let
// a link name as it is. The link is a secret: these tests look for it everywhere it must not be.

const APP = 'http://localhost:4310';
const FEEDS = 'http://localhost:4317';
const BACK = { timeout: 15_000 };
test.describe.configure({ timeout: 90_000 });

const linkTo = (token: string) => `${FEEDS}/feeds/${token}/calendar.ics`;
const feeds = {
  /** Sets up what a published calendar says, and how it answers. */
  set: (token: string, data: { ics?: string; status?: number | null; html?: boolean; redirect?: string | null; validators?: boolean; gzip?: boolean; hold?: boolean }) =>
    fetch(`${FEEDS}/__fake/feeds/${token}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** What was asked of it: each request's conditional headers, and how many it is keeping waiting. */
  asked: async (token: string) => (await (await fetch(`${FEEDS}/__fake/feeds/${token}`)).json()) as { asked: { ifNoneMatch: string | null; cookie: boolean }[]; held: number },
};

const ics = (name: string, ...events: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stand-in//EN', `X-WR-CALNAME:${name}`, ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
/** What a published calendar carries that Koyomi has no business keeping. */
const PRIVATE = ['DESCRIPTION:PRIVATE NOTES', 'LOCATION:PRIVATE PLACE', 'ORGANIZER;CN=Boss:mailto:boss@private.test', 'ATTENDEE:mailto:someone@private.test', 'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.private.test/x'];
const PACIFIC = [
  'BEGIN:VTIMEZONE',
  'TZID:Pacific Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

/**
 * A team's calendar, published from Outlook: a meeting three mornings a week in Los Angeles with
 * one left out and one moved, a single meeting full of private detail, a day out, and an event
 * whose UID another calendar has too. The week on screen is Monday 5 to Sunday 11 October 2026,
 * in Istanbul (UTC+3), where nine in Los Angeles is six in the evening.
 */
const WORK = (...more: string[][]) =>
  ics(
    'Team rota',
    PACIFIC,
    vevent(
      'UID:standup',
      'SUMMARY:Standup',
      'DTSTART;TZID=Pacific Standard Time:20260907T080000',
      'DTEND;TZID=Pacific Standard Time:20260907T081500',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'EXDATE;TZID=Pacific Standard Time:20261005T080000',
    ),
    vevent('UID:standup', 'RECURRENCE-ID;TZID=Pacific Standard Time:20261007T080000', 'SUMMARY:Standup (moved)', 'DTSTART;TZID=Pacific Standard Time:20261007T100000', 'DTEND;TZID=Pacific Standard Time:20261007T101500'),
    vevent('UID:review', 'SUMMARY:Design review', 'DTSTART:20261008T090000Z', 'DTEND:20261008T100000Z', ...PRIVATE),
    vevent('UID:offsite', 'SUMMARY:Offsite', 'DTSTART;VALUE=DATE:20261009', 'DTEND;VALUE=DATE:20261010'),
    vevent('UID:shared', 'SUMMARY:Shared A', 'DTSTART:20261006T060000Z', 'DTEND:20261006T070000Z'),
    ...more,
  );
/** Another calendar entirely, with the same UID for one of its events. */
const FAMILY = (...more: string[][]) =>
  ics('Family', vevent('UID:shared', 'SUMMARY:Shared B', 'DTSTART:20261006T080000Z', 'DTEND:20261006T090000Z'), vevent('UID:dinner', 'SUMMARY:Dinner', 'DTSTART:20261008T160000Z', 'DTEND:20261008T180000Z'), ...more);

const form = (page: Page) => view(page).getByRole('form');
const listedLinks = async (page: Page) =>
  ((await (await page.request.get('/api/calendars')).json()) as { connections: { connectionId: string; provider: string; account: string; state: string }[] }).connections.filter((entry) => entry.provider === 'link');

/** Adds a calendar link as a person does: Add calendar account, Calendar link, and the form. */
async function subscribe(page: Page, link: string, name = '') {
  await openCalendars(page);
  await addAt(page, 'Calendar link');
  await expect(form(page)).toBeVisible(BACK);
  await form(page).getByLabel('Calendar link').fill(link);
  if (name) await form(page).getByLabel('Name (optional)').fill(name);
  await form(page).getByRole('button', { name: 'Add calendar' }).click();
  await expect(form(page)).toHaveCount(0, BACK);
  await unfold(page);
  await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
}

/** Tries a link in the open form, and returns what the form says of it. */
async function tryLink(page: Page, link: string) {
  await form(page).getByLabel('Calendar link').fill(link);
  await form(page).getByRole('button', { name: /^(Add calendar|Update link)$/ }).click();
  await expect(form(page).getByRole('alert')).toBeVisible(BACK);
  return form(page).getByRole('alert').textContent();
}

test.describe('subscribing to a calendar link', () => {
  test('offered beside Google and Microsoft; checked before it is kept; the link is kept nowhere on this device', async ({ page, id }) => {
    const token = `${id}w`;
    await feeds.set(token, { ics: WORK() });
    const answers: string[] = [];
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname.startsWith('/api/')) answers.push(`${response.url()} ${await response.text().catch(() => '')}`);
    });
    await start(page);
    await openCalendars(page);
    await expect(view(page)).toContainText('You can also subscribe to a read-only calendar using its private calendar link.');

    // The choice is Google, Microsoft, Calendar link, in that order.
    await addButton(page).click();
    await expect(view(page).getByRole('button', { name: /^(Google|Microsoft|Calendar link)$/ })).toHaveText(['Google', 'Microsoft', 'Calendar link']);
    await choice(page, 'Calendar link').click();
    // Signed in with 6Away first, and brought back to the form, which says what the link is.
    await expect(form(page)).toBeVisible(BACK);
    await expect(form(page)).toHaveAccessibleName('Subscribe to a calendar');
    await expect(form(page)).toContainText('Anyone who has this link may be able to view the calendar, so treat it like a password.');
    await expect(form(page).getByLabel('Calendar link')).toHaveAttribute('autocomplete', 'off');
    await form(page).getByLabel('Calendar link').fill(linkTo(token));
    await form(page).getByLabel('Name (optional)').fill('Work calendar');
    await form(page).getByRole('button', { name: 'Add calendar' }).click();
    await expect(form(page)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);

    // Under its own heading, by the name it was given, as one calendar that can be hidden.
    await expect(view(page).getByText('CALENDAR LINKS', { exact: true })).toBeVisible();
    await expect(toggle(page, 'Work calendar')).toHaveAttribute('aria-checked', 'true');
    await expect(view(page).getByRole('button', { name: 'Remove calendar Work calendar' })).toBeVisible();
    await expect(view(page)).toContainText('Read only. Koyomi never changes your calendar.');

    // Its events, in this device's zone: the series in Los Angeles with one left out and one
    // moved, the meeting, the day out. The series itself is not one more event.
    await closeDrawer(page);
    await expect(external(page, 'Standup (moved)')).toContainText('20:00');
    await expect(external(page, 'Design review')).toContainText('12:00 – 13:00');
    await expect(page.locator('[data-all-day] [data-event]', { hasText: 'Offsite' })).toBeVisible();
    await expect(page.locator('[data-day="2026-10-05"] [data-event]', { hasText: 'Standup' })).toHaveCount(0);
    await expect(page.locator('[data-day="2026-10-09"] [data-event]', { hasText: 'Standup' })).toContainText('18:00');

    // Read only, and said to be from a calendar link: nothing to edit, delete or answer.
    await external(page, 'Design review').click();
    await expect(popover(page)).toContainText('Calendar link · Work calendar');
    await expect(popover(page).getByRole('button', { name: /edit|delete|accept|decline/i })).toHaveCount(0);
    await expect(popover(page).getByRole('link')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The link, and everything the calendar carried that Koyomi does not show, is nowhere on
    // this device, in nothing the server sent back, and not on the page.
    const stored = await everythingStored(page);
    for (const secret of [token, FEEDS, 'localhost:4317', '/feeds/', 'PRIVATE', 'private.test']) {
      expect(stored, secret).not.toContain(secret);
      expect(answers.join('\n'), secret).not.toContain(secret);
      expect(await page.content(), secret).not.toContain(secret);
    }
    // Asked for as anyone would ask: no cookie of the person's goes with it.
    expect((await feeds.asked(token)).asked.every((each) => !each.cookie)).toBe(true);
  });

  test('a name is the calendar’s own when none is given, and the same link twice is still one calendar', async ({ page, id }) => {
    const token = `${id}f`;
    await feeds.set(token, { ics: FAMILY(), gzip: true });
    await start(page);
    await subscribe(page, linkTo(token));
    await expect(toggle(page, 'Family')).toHaveAttribute('aria-checked', 'true');
    await subscribe(page, linkTo(token), 'Home');
    expect(await listedLinks(page)).toEqual([expect.objectContaining({ account: 'Home', state: 'ok' })]);
    await expect(view(page).getByText('CALENDAR LINKS', { exact: true })).toHaveCount(1);
    await expect(toggle(page, 'Home')).toBeVisible();
  });

  test('what is not a calendar Koyomi will read is refused in words, and nothing is kept', async ({ page, id }) => {
    for (const [token, setting] of [
      ['html', { html: true }],
      ['gone', { status: 404 }],
      ['away', { redirect: 'http://127.0.0.1:4317/feeds/x/calendar.ics' }],
      ['metadata', { redirect: 'https://169.254.169.254/latest/meta-data/' }],
      ['down', { status: 503 }],
    ] as const)
      await feeds.set(`${id}${token}`, setting);
    await start(page);
    await openCalendars(page);
    await addAt(page, 'Calendar link');
    await expect(form(page)).toBeVisible(BACK);

    const notALink = 'That isn’t a calendar link Koyomi can use. Paste the calendar’s private https or webcal link.';
    for (const link of ['http://calendar.example.com/team.ics', 'https://127.0.0.1/team.ics', 'https://localhost/team.ics', 'https://169.254.169.254/latest/meta-data/', linkTo(`${id}away`), linkTo(`${id}metadata`)]) {
      expect(await tryLink(page, link), link).toBe(notALink);
    }
    for (const token of ['html', 'gone']) expect(await tryLink(page, linkTo(`${id}${token}`)), token).toBe('This link did not return a valid calendar.');
    expect(await tryLink(page, linkTo(`${id}down`))).toBe('Couldn’t reach that link just now. Try again in a moment.');
    // The field lets go of the link as it is sent.
    await expect(form(page).getByLabel('Calendar link')).toHaveValue('');

    // Cancel, and nothing was connected.
    await form(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(form(page)).toHaveCount(0);
    expect(await listedLinks(page)).toEqual([]);
    expect(await everythingStored(page)).not.toContain('/feeds/');
  });
});

test.describe('a subscription, not an import', () => {
  test('what changes where it is published shows on Refresh; an unchanged calendar is not read again; Koyomi’s own events are untouched', async ({ page, id }) => {
    const token = `${id}w`;
    await feeds.set(token, { ics: WORK() });
    await start(page);
    await addEvent(page, 'My own event', '09:00', '2026-10-07');
    await subscribe(page, linkTo(token), 'Work calendar');
    await closeDrawer(page);
    await expect(external(page, 'Design review')).toBeVisible();

    // Nothing has changed: Koyomi asks whether it has, and is told it has not.
    await refresh(page);
    expect((await feeds.asked(token)).asked.at(-1)?.ifNoneMatch).toMatch(/^"/);

    // Changed where it is published: a meeting added, one taken away.
    await feeds.set(token, { ics: WORK(vevent('UID:new', 'SUMMARY:New meeting', 'DTSTART:20261009T070000Z', 'DTEND:20261009T080000Z')).replace(/BEGIN:VEVENT\r\nUID:review[\s\S]*?END:VEVENT\r\n/, '') });
    await refresh(page);
    await closeDrawer(page);
    await expect(external(page, 'New meeting')).toContainText('10:00 – 11:00');
    await expect(event(page, 'Design review')).toHaveCount(0);
    await expect(event(page, 'My own event')).toBeVisible();
    // Kept as the calendar's own, apart from Koyomi's: nothing became a Koyomi event.
    expect((await cached(page)).events.map((e) => e.title)).toContain('New meeting');
    await expect(page.locator('[data-event]:not([data-external])', { hasText: 'New meeting' })).toHaveCount(0);
  });
});

test.describe('a link that stops working', () => {
  test('needs updating; Update link keeps the calendar and its place, refuses what does not work, and an old reading still on its way is not kept', async ({ page, id }) => {
    const [old, fresh, other, broken] = [`${id}old`, `${id}new`, `${id}other`, `${id}broken`];
    await feeds.set(old, { ics: WORK() });
    await feeds.set(fresh, { ics: ics('New rota', vevent('UID:fresh', 'SUMMARY:From the new link', 'DTSTART:20261008T060000Z', 'DTEND:20261008T070000Z')) });
    await feeds.set(other, { ics: FAMILY() });
    await feeds.set(broken, { html: true });
    await start(page);
    await subscribe(page, linkTo(old), 'Work calendar');
    await subscribe(page, linkTo(other));
    const [work] = (await listedLinks(page)).filter((entry) => entry.account === 'Work calendar');

    // Withdrawn where it was published.
    await feeds.set(old, { status: 404 });
    await refresh(page);
    await expect(group(page, 'Work calendar')).toContainText('Needs updating');
    await expect(group(page, 'Work calendar')).toContainText('This calendar link no longer returns a valid calendar.');
    await expect(page.getByText(/reconnect/i)).toHaveCount(0);
    await closeDrawer(page);
    // What was read stays, and one quiet line says what is needed.
    await expect(external(page, 'Design review')).toBeVisible();
    await page.getByRole('button', { name: 'Calendar link needs updating' }).click();

    // A link that does not work does not replace it; nor does one that is another of the person's calendars.
    await group(page, 'Work calendar').getByRole('button', { name: 'Update link Work calendar' }).click();
    await expect(form(page)).toHaveAccessibleName('Update link for Work calendar');
    await expect(form(page).getByLabel('Name (optional)')).toHaveCount(0);
    expect(await tryLink(page, linkTo(broken))).toBe('This link did not return a valid calendar.');
    expect(await tryLink(page, linkTo(other))).toBe('That link is already one of your calendars.');
    expect((await listedLinks(page)).find((entry) => entry.connectionId === work.connectionId)?.state).toBe('reconnect');

    // One that works: the same calendar, by the same name, now reading the new link.
    await form(page).getByLabel('Calendar link').fill(linkTo(fresh));
    await form(page).getByRole('button', { name: 'Update link' }).click();
    await expect(form(page)).toHaveCount(0, BACK);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await expect(group(page, 'Work calendar')).not.toContainText('Needs updating');
    expect((await listedLinks(page)).find((entry) => entry.account === 'Work calendar')).toMatchObject({ connectionId: work.connectionId, state: 'ok' });
    await closeDrawer(page);
    await expect(external(page, 'From the new link')).toBeVisible();
    await expect(event(page, 'Design review')).toHaveCount(0);

    // A reading of the old link held back while it is replaced again: when it arrives, it is not kept.
    await feeds.set(fresh, { ics: ics('New rota', vevent('UID:late', 'SUMMARY:Late from the old link', 'DTSTART:20261008T060000Z', 'DTEND:20261008T070000Z')), hold: true });
    await openCalendars(page);
    await view(page).getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(async () => (await feeds.asked(fresh)).held, BACK).toBeGreaterThan(0);
    await feeds.set(old, { status: null, ics: WORK() });
    await group(page, 'Work calendar').getByRole('button', { name: 'Update link Work calendar' }).click();
    await form(page).getByLabel('Calendar link').fill(linkTo(old));
    await form(page).getByRole('button', { name: 'Update link' }).click();
    await expect(form(page)).toHaveCount(0, BACK);
    await expect.poll(async () => (await cached(page)).events.map((e) => e.title), BACK).toContain('Design review');
    await feeds.set(fresh, { hold: false });
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await page.waitForTimeout(500);
    expect((await cached(page)).events.map((e) => e.title)).not.toContain('Late from the old link');
    await closeDrawer(page);
    await expect(event(page, 'Late from the old link')).toHaveCount(0);
    await expect(external(page, 'Design review')).toBeVisible();
  });

  test('a reading of the old link that fails after the link is replaced says nothing of the new one', async ({ page, id }) => {
    const [old, fresh] = [`${id}old`, `${id}new`];
    await feeds.set(old, { ics: WORK() });
    await feeds.set(fresh, { ics: ics('New rota', vevent('UID:fresh', 'SUMMARY:From the new link', 'DTSTART:20261008T060000Z', 'DTEND:20261008T070000Z')) });
    await start(page);
    await subscribe(page, linkTo(old), 'Work calendar');
    const [work] = await listedLinks(page);

    // Withdrawn just as Refresh asks: that answer is held back while the link is replaced.
    await feeds.set(old, { status: 404, hold: true });
    await view(page).getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(async () => (await feeds.asked(old)).held, BACK).toBeGreaterThan(0);
    await group(page, 'Work calendar').getByRole('button', { name: 'Update link Work calendar' }).click();
    await form(page).getByLabel('Calendar link').fill(linkTo(fresh));
    await form(page).getByRole('button', { name: 'Update link' }).click();
    await expect(form(page)).toHaveCount(0, BACK);
    await expect.poll(async () => (await cached(page)).events.map((e) => e.title), BACK).toContain('From the new link');

    // The old link's refusal arrives. The new link is not what refused.
    await feeds.set(old, { hold: false });
    await expect.poll(async () => (await feeds.asked(old)).held, BACK).toBe(0);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, BACK);
    await page.waitForTimeout(500);
    await expect(group(page, 'Work calendar')).not.toContainText('Needs updating');
    expect((await listedLinks(page)).find((entry) => entry.connectionId === work.connectionId)?.state).toBe('ok');
    await feeds.set(fresh, { ics: ics('New rota', vevent('UID:fresh', 'SUMMARY:Still read', 'DTSTART:20261008T060000Z', 'DTEND:20261008T070000Z')) });
    await refresh(page);
    await expect.poll(async () => (await cached(page)).events.map((e) => e.title), BACK).toContain('Still read');
  });

  test('a pause the old link asked for is not asked of the new one', async ({ page, id }) => {
    const [old, fresh] = [`${id}old`, `${id}new`];
    await feeds.set(old, { ics: WORK() });
    await feeds.set(fresh, { ics: ics('New rota', vevent('UID:fresh', 'SUMMARY:From the new link', 'DTSTART:20261008T060000Z', 'DTEND:20261008T070000Z')) });
    await start(page);
    await subscribe(page, linkTo(old), 'Work calendar');

    // Where the old link is kept asks Koyomi to leave it alone for a minute.
    await feeds.set(old, { status: 429 });
    const asked = (await feeds.asked(old)).asked.length;
    await refresh(page);
    await expect.poll(async () => (await feeds.asked(old)).asked.length, BACK).toBeGreaterThan(asked);

    await group(page, 'Work calendar').getByRole('button', { name: 'Update link Work calendar' }).click();
    await form(page).getByLabel('Calendar link').fill(linkTo(fresh));
    await form(page).getByRole('button', { name: 'Update link' }).click();
    await expect(form(page)).toHaveCount(0, BACK);
    await expect.poll(async () => (await cached(page)).events.map((e) => e.title), BACK).toContain('From the new link');
  });
});

test.describe('beside Google and Microsoft', () => {
  test('two links with the same UID are two calendars; one link’s trouble and removal are its own; all of it is there offline', async ({ page, context, id }) => {
    const [work, family] = [`${id}w`, `${id}f`];
    const pat = `${id}m`;
    const PAT = 'pat@outlook.test';
    await feeds.set(work, { ics: WORK() });
    await feeds.set(family, { ics: FAMILY() });
    await microsoft.has(pat, {
      kind: 'personal',
      address: PAT,
      calendars: [
        {
          id: 'AAMkADefault=',
          name: 'Calendar',
          isDefaultCalendar: true,
          events: [{ id: 'ms', subject: 'Microsoft meeting', start: { dateTime: graphTime('2026-10-07', '16:00'), timeZone: 'UTC' }, end: { dateTime: graphTime('2026-10-07', '17:00'), timeZone: 'UTC' }, showAs: 'busy', responseStatus: { response: 'organizer' }, type: 'singleInstance' }],
        },
      ],
    });
    await start(page);
    await connect(page);
    await connectMicrosoft(page, pat, PAT);
    await subscribe(page, linkTo(work), 'Work calendar');
    await subscribe(page, linkTo(family));
    await closeDrawer(page);
    for (const title of ['Dentist', 'Microsoft meeting', 'Design review', 'Dinner', 'Shared A', 'Shared B']) await expect(external(page, title)).toBeVisible();
    // The same UID in two calendars is two events, each filed under its own connection.
    const shared = (await cached(page)).events.filter((e) => e.providerEventId === 'shared');
    expect(shared.map((e) => e.title).sort()).toEqual(['Shared A', 'Shared B']);
    expect(new Set(shared.map((e) => e.id)).size).toBe(2);
    expect(new Set(shared.map((e) => e.connectionId)).size).toBe(2);

    // One link failing: it keeps what it had; the other link, Google and Microsoft are read as usual.
    await feeds.set(work, { status: 503 });
    await feeds.set(family, { ics: FAMILY(vevent('UID:late', 'SUMMARY:Late supper', 'DTSTART:20261009T170000Z', 'DTEND:20261009T180000Z')) });
    await refresh(page);
    await closeDrawer(page);
    await expect(external(page, 'Design review')).toBeVisible();
    await expect(external(page, 'Late supper')).toBeVisible();
    await openCalendars(page);
    await expect(page.getByText(/needs updating|reconnect/i)).toHaveCount(0);

    // Removing one link: only it goes, and Koyomi says the link itself still works.
    await view(page).getByRole('button', { name: 'Remove calendar Work calendar' }).click();
    await expect(view(page).getByRole('status')).toHaveText(
      'Koyomi no longer keeps that calendar link. It still works wherever else it is used: to stop it working, turn off or reset that calendar’s publishing where it lives.',
    );
    await expect(group(page, 'Work calendar')).toHaveCount(0);
    for (const address of [ME, PAT, 'Family']) await expect(group(page, address)).toBeVisible();
    expect((await listedLinks(page)).map((entry) => entry.account)).toEqual(['Family']);
    await closeDrawer(page);
    await expect(event(page, 'Design review')).toHaveCount(0);
    for (const title of ['Dentist', 'Microsoft meeting', 'Dinner', 'Shared B']) await expect(external(page, title)).toBeVisible();

    // With no connection at all, every provider's events are there; no link is.
    await page.evaluate(async () => void (await navigator.serviceWorker.ready));
    await context.setOffline(true);
    await reload(page);
    for (const title of ['Dentist', 'Microsoft meeting', 'Dinner', 'Shared B']) await expect(external(page, title)).toBeVisible();
    const stored = await everythingStored(page);
    expect(stored).not.toContain('/feeds/');
    expect(stored).not.toContain(work);
    expect(stored).not.toContain(family);
    await context.setOffline(false);
  });
});

test.describe('whose calendar it is', () => {
  test('nobody else can read, update or remove it; nothing without a sign-in, from another site, or for a malformed id', async ({ page, browser, id }) => {
    const token = `${id}w`;
    await feeds.set(token, { ics: WORK() });
    await start(page);
    await subscribe(page, linkTo(token), 'Work calendar');
    const [mine] = await listedLinks(page);
    const span = { timeMin: '2026-10-01T00:00:00.000Z', timeMax: '2026-11-01T00:00:00.000Z', calendars: [{ calendarId: 'calendar', syncToken: null }] };
    const headers = { origin: APP };

    // Someone else, signed in as themselves in a browser of their own.
    const theirs = await browser.newContext();
    await theirs.addCookies([{ name: 'fake_user', value: `stranger-${id}`, url: FAKE }]);
    const stranger = await theirs.newPage();
    await stranger.goto('/api/auth/signin?returnTo=%2F');
    await expect(stranger.getByText('koyomi', { exact: true })).toBeVisible();
    const read = await stranger.request.post('/api/calendars/events', { data: { connectionId: mine.connectionId, ...span }, headers });
    expect([read.status(), await read.json()]).toEqual([409, { error: 'not_connected' }]);
    const update = await stranger.request.post('/api/link/connect', { data: { link: linkTo(token), connectionId: mine.connectionId }, headers });
    expect([update.status(), await update.json()]).toEqual([404, { error: 'not_connected' }]);
    expect(await (await stranger.request.get('/api/calendars')).json()).toEqual({ connections: [] });
    // A malformed id, or one that is nobody's, finds nothing.
    for (const connectionId of ['', 'calendar', '00000000-0000-4000-8000-000000000000', `${mine.connectionId}x`]) {
      expect((await stranger.request.post('/api/link/connect', { data: { link: linkTo(token), connectionId }, headers })).status(), connectionId).toBe(404);
    }
    // Removing it, named outright, removes nothing of the owner's (and signs the stranger out, who has nothing connected).
    expect((await stranger.request.post('/api/calendars/disconnect', { data: { connectionId: mine.connectionId }, headers })).status()).toBe(200);
    // From another site, nothing at all.
    expect((await page.request.post('/api/link/connect', { data: { link: linkTo(token) }, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
    await theirs.close();

    // Without a sign-in, neither the form nor a link.
    const nobody = await browser.newContext();
    expect((await nobody.request.get(`${APP}/api/link/connect`)).status()).toBe(401);
    expect((await nobody.request.post(`${APP}/api/link/connect`, { data: { link: linkTo(token) }, headers })).status()).toBe(401);
    await nobody.close();

    // The owner's calendar is as it was, and the stranger never caused it to be fetched.
    expect(await listedLinks(page)).toEqual([expect.objectContaining({ connectionId: mine.connectionId, account: 'Work calendar', state: 'ok' })]);
    expect((await feeds.asked(token)).asked).toHaveLength(2);
  });
});
