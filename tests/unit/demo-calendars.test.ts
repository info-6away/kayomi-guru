import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { occurrencesOf } from '../../lib/calendars/ical';
import type { Authorized, Source, SourceEvent } from '../../lib/server/ai/read';
import { findFreeTimeTool, getEventsTool, getScheduleTool, listCalendarsTool, type ToolContext } from '../../lib/server/ai/tools';
import { isCalendar } from '../../lib/server/fetchlink';
import { feedName } from '../../lib/server/link';

// The two synthetic calendars a directory reviewer subscribes to by calendar link
// (public/demo/, served at https://koyomi.guru/demo/; docs/MCP_PUBLIC_READINESS.md, section 4).
// Every event repeats weekly from January 2026 and never ends, so the answers are the same
// whichever week a reviewer tries. Read here exactly as Koyomi reads a calendar link (ical.ts),
// and answered by the assistant tools themselves.

const WORK = readFileSync('public/demo/koyomi-demo-work.ics', 'utf8');
const PERSONAL = readFileSync('public/demo/koyomi-demo-personal.ics', 'utf8');
const NOW = Date.parse('2026-11-10T08:00:00Z');
const FETCHED = '2026-11-10T08:00:00.000Z';

const source = (handle: string, text: string, connectionId: string): Source => ({
  handle,
  name: feedName(text)!,
  provider: 'link',
  primary: false,
  connectionId,
  accountKey: `demo-${handle}`,
  calendarId: 'link',
});
const work = source('cal_work', WORK, '11111111-1111-4111-8111-111111111111');
const personal = source('cal_personal', PERSONAL, '22222222-2222-4222-8222-222222222222');
const TEXT = new Map([
  [work.handle, WORK],
  [personal.handle, PERSONAL],
]);

/** What the assistant would get with these calendars authorized: read as a calendar link is read. */
function reviewer(authorized: Source[], zone = 'Europe/London'): ToolContext {
  const calendars: Authorized = { sources: authorized, unavailable: [], removed: 0 };
  return {
    defaultZone: zone,
    now: NOW,
    access: {
      calendars: async () => calendars,
      events: async (chosen, span) => ({
        events: chosen.flatMap((s): SourceEvent[] =>
          occurrencesOf(TEXT.get(s.handle)!, { provider: 'link', connectionId: s.connectionId, calendarId: s.calendarId, fetchedAt: FETCHED, ...span }).map((event) => ({ source: s, event })),
        ),
        unavailable: [],
        removed: 0,
      }),
    },
  };
}

const at = (iso: string) => iso.slice(11, 16);
const span = (from: string, to: string) => ({ timeMin: `${from}T00:00:00.000Z`, timeMax: `${to}T00:00:00.000Z` });
const read = (text: string, from: string, to: string) =>
  occurrencesOf(text, { provider: 'link', connectionId: work.connectionId, calendarId: 'link', fetchedAt: FETCHED, ...span(from, to) });

test('both are calendars Koyomi takes as calendar links, named as a reviewer will see them, and synthetic through and through', () => {
  for (const text of [WORK, PERSONAL]) {
    expect(isCalendar(text)).toBe(true);
    // Every event is ours: a demo address, a weekly rule from January 2026, and no end.
    for (const uid of text.match(/^UID:.*$/gm)!) expect(uid).toMatch(/^UID:[a-z-]+@demo\.koyomi\.guru$/);
    expect(text.match(/^RRULE:.*$/gm)!.every((rule) => /^RRULE:FREQ=WEEKLY;BYDAY=[A-Z,]+$/.test(rule))).toBe(true);
    expect(text).not.toMatch(/UNTIL|COUNT|ATTENDEE|ORGANIZER|mailto:|@(?!demo\.koyomi\.guru)[a-z0-9-]+\.[a-z]/i);
  }
  expect(feedName(WORK)).toBe('Koyomi Demo — Work');
  expect(feedName(PERSONAL)).toBe('Koyomi Demo — Personal');
});

test('a week of each: weekly rules, an all-day event, overlaps, a tentative event, and nothing Koyomi does not show', () => {
  // The week of Monday 16 November 2026. London is on UTC then.
  const week = read(WORK, '2026-11-16', '2026-11-21').filter((e) => e.allDay || e.start < '2026-11-21');
  expect(week.map((e) => (e.allDay ? `${e.start} all day ${e.title}` : `${e.start.slice(0, 10)} ${at(e.start)}–${at(e.end)} ${e.title}`)).sort()).toEqual(
    [
      '2026-11-16 09:30–09:45 Daily standup',
      '2026-11-16 10:00–11:00 Weekly planning',
      '2026-11-17 09:30–09:45 Daily standup',
      '2026-11-17 14:00–15:00 Design review',
      '2026-11-17 16:00–17:00 Optional training',
      '2026-11-18 09:30–09:45 Daily standup',
      '2026-11-18 12:00–13:00 Team lunch',
      '2026-11-18 15:00–15:30 Call with the New York office',
      '2026-11-19 09:30–09:45 Daily standup',
      '2026-11-19 10:00–11:00 Client call',
      '2026-11-19 10:30–11:30 Team sync',
      '2026-11-20 09:30–09:45 Daily standup',
      '2026-11-20 all day Demo day',
    ].sort(),
  );
  expect(week.find((e) => e.title === 'Optional training')!.status).toBe('tentative');
  expect(week.filter((e) => e.title !== 'Optional training').every((e) => e.status === 'confirmed')).toBe(true);
  // The lunch's notes and place are in the file, and in nothing Koyomi keeps.
  expect(WORK).toContain('Synthetic Cafe');
  expect(JSON.stringify(week)).not.toMatch(/Synthetic Cafe|Synthetic notes|Example Street/);

  const home = read(PERSONAL, '2026-11-16', '2026-11-23').filter((e) => (e.allDay ? e.start >= '2026-11-16' && e.start <= '2026-11-22' : true));
  expect(home.map((e) => (e.allDay ? `${e.start} all day ${e.title}` : `${e.start.slice(0, 10)} ${at(e.start)}–${at(e.end)} ${e.title}`)).sort()).toEqual(
    [
      '2026-11-16 07:00–08:00 Gym',
      '2026-11-17 14:30–15:15 School pickup',
      '2026-11-18 07:00–08:00 Gym',
      '2026-11-19 14:30–15:15 School pickup',
      '2026-11-20 19:00–21:00 Dinner with friends',
      '2026-11-21 10:00–11:00 Piano lesson',
      '2026-11-22 all day Family day',
      '2026-11-22 11:00–11:30 Call with family in Tokyo',
    ].sort(),
  );
});

test('time zones: each event keeps the zone it is written in, across both countries’ changes of clocks', () => {
  const call = (from: string, to: string) => read(WORK, from, to).find((e) => e.title === 'Call with the New York office')!;
  const standup = (from: string, to: string) => read(WORK, from, to).find((e) => e.title === 'Daily standup')!;
  // November: New York on EST, London on GMT. 10:00 in New York is 15:00 in London.
  expect(call('2026-11-18', '2026-11-19').start).toBe('2026-11-18T15:00:00.000Z');
  // 17 March 2027: New York has changed its clocks (14 March), London not yet (28 March): 14:00 in London.
  expect(call('2027-03-17', '2027-03-18').start).toBe('2027-03-17T14:00:00.000Z');
  // July: both on summer time. 10:00 EDT is 14:00 UTC, 15:00 in London again.
  expect(call('2027-07-14', '2027-07-15').start).toBe('2027-07-14T14:00:00.000Z');
  // A London event stays at 09:30 London time: 09:30 UTC in winter, 08:30 UTC in summer.
  expect(standup('2026-11-18', '2026-11-19').start).toBe('2026-11-18T09:30:00.000Z');
  expect(standup('2027-07-14', '2027-07-15').start).toBe('2027-07-14T08:30:00.000Z');
  // Tokyo never changes its clocks: 20:00 there is 11:00 UTC all year.
  const tokyo = read(PERSONAL, '2027-07-18', '2027-07-19').find((e) => e.title === 'Call with family in Tokyo')!;
  expect(tokyo.start).toBe('2027-07-18T11:00:00.000Z');
});

test('with Work alone authorized, as a reviewer is asked to: the tools answer from Work, and nothing of Personal ever appears', async () => {
  const ctx = reviewer([work]);
  const listed = await listCalendarsTool(ctx);
  expect(listed.calendars.map((c) => c.name)).toEqual(['Koyomi Demo — Work']);

  // Wednesday, in London: three events, the New York call in London's time.
  const wednesday = await getScheduleTool(ctx, { date: '2026-11-18' });
  expect(wednesday.complete).toBe(true);
  expect(wednesday.events.map((e) => [at(e.start), e.title])).toEqual([
    ['09:30', 'Daily standup'],
    ['12:00', 'Team lunch'],
    ['15:00', 'Call with the New York office'],
  ]);
  // The same day in Dubai: the same events, four hours later on the clock.
  const dubai = await getScheduleTool(reviewer([work], 'Asia/Dubai'), { date: '2026-11-18' });
  expect(dubai.events.map((e) => e.start)).toEqual(['2026-11-18T13:30:00+04:00', '2026-11-18T16:00:00+04:00', '2026-11-18T19:00:00+04:00']);

  // Thursday 09:00–17:00, an hour: the client call and the team sync overlap, and are busy as one.
  const thursday = await findFreeTimeTool(ctx, { start: '2026-11-19T09:00', end: '2026-11-19T17:00', duration_minutes: 60 });
  expect(thursday.free.map((f) => `${at(f.start)}–${at(f.end)}`)).toEqual(['11:30–17:00']);
  // Tuesday: the tentative training counts as busy.
  const tuesday = await findFreeTimeTool(ctx, { start: '2026-11-17T09:00', end: '2026-11-17T17:00', duration_minutes: 60 });
  expect(tuesday.free.map((f) => `${at(f.start)}–${at(f.end)}`)).toEqual(['09:45–14:00', '15:00–16:00']);

  // Friday: Demo day is listed, all day, and does not make the day busy.
  const friday = await getScheduleTool(ctx, { date: '2026-11-20' });
  expect(friday.all_day_events.map((e) => [e.title, e.all_day])).toEqual([['Demo day', true]]);
  const fridayFree = await findFreeTimeTool(ctx, { start: '2026-11-20T09:00', end: '2026-11-20T17:00', duration_minutes: 60 });
  expect(fridayFree.free.map((f) => `${at(f.start)}–${at(f.end)}`)).toEqual(['09:45–17:00']);
  expect(fridayFree.all_day_events.map((e) => e.title)).toEqual(['Demo day']);

  // A whole week, and a calendar handle that is not Work's: nothing of Personal, in any answer.
  const week = await getEventsTool(ctx, { start: '2026-11-16', end: '2026-11-22' });
  expect(week.total_events).toBe(13);
  const said = JSON.stringify([listed, wednesday, thursday, tuesday, friday, week]);
  for (const never of ['Personal', 'Gym', 'School pickup', 'Dinner with friends', 'Piano lesson', 'Family day', 'Tokyo', 'Synthetic Cafe']) expect(said, never).not.toContain(never);
  await expect(getEventsTool(ctx, { start: '2026-11-16', end: '2026-11-22', calendars: [personal.handle] })).rejects.toMatchObject({ code: 'unknown_calendar' });
});

test('with both authorized, events overlap across the two calendars and free time takes both into account', async () => {
  const ctx = reviewer([work, personal]);
  // Tuesday: the design review (Work, 14:00–15:00) and the school pickup (Personal, 14:30–15:15) overlap.
  const tuesday = await getScheduleTool(ctx, { date: '2026-11-17' });
  expect(tuesday.events.map((e) => [at(e.start), at(e.end), e.title, e.calendar_name])).toEqual([
    ['09:30', '09:45', 'Daily standup', 'Koyomi Demo — Work'],
    ['14:00', '15:00', 'Design review', 'Koyomi Demo — Work'],
    ['14:30', '15:15', 'School pickup', 'Koyomi Demo — Personal'],
    ['16:00', '17:00', 'Optional training', 'Koyomi Demo — Work'],
  ]);
  const free = await findFreeTimeTool(ctx, { start: '2026-11-17T09:00', end: '2026-11-17T17:00', duration_minutes: 60 });
  expect(free.free.map((f) => `${at(f.start)}–${at(f.end)}`)).toEqual(['09:45–14:00']);
  expect(free.complete).toBe(true);
});
