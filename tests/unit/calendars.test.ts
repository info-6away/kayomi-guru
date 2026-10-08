import { expect, test } from '@playwright/test';
import { EVENT_FIELDS, normalizeGoogleEvent, type GoogleEvent } from '../../lib/calendars/normalize';
import { showingsByDay, timeLabel } from '../../lib/calendars/showings';
import type { ExternalCalendar, ExternalEvent } from '../../lib/calendars/types';
import { covers, spanOfWindow, syncWindow, within } from '../../lib/calendars/window';

// Google events becoming Koyomi's record of them, and where they land on the local calendar.
// Time zones are the point of most of these, so each says which zone the device is in.

const FETCHED = '2026-10-07T09:00:00.000Z';
const read = (item: GoogleEvent) => normalizeGoogleEvent(item, 'work@example.com', FETCHED);
const calendar = (over: Partial<ExternalCalendar> = {}): ExternalCalendar => ({
  id: 'google:work@example.com',
  provider: 'google',
  calendarId: 'work@example.com',
  name: 'Work',
  primary: true,
  selected: true,
  visible: true,
  syncToken: null,
  windowFrom: null,
  windowTo: null,
  fetchedAt: null,
  ...over,
});
// Node does not go back to the system's zone when TZ is removed, so it is named and put back.
const HOME = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Runs with the device's clock set to a zone, and puts it back afterwards. */
function inZone<T>(zone: string, run: () => T): T {
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    process.env.TZ = HOME;
  }
}
const on = (event: ExternalEvent, from: string, to: string) =>
  [...showingsByDay([event], [calendar()], from, to)].flatMap(([, list]) => list.map((s) => `${s.date} ${s.allDay ? 'all day' : `${s.start}-${s.end}`}`));

test('a timed event keeps its instant and the zone it was written in', () => {
  const event = read({
    id: 'e1',
    summary: ' Design review ',
    status: 'confirmed',
    htmlLink: 'https://www.google.com/calendar/event?eid=abc',
    updated: '2026-10-01T10:00:00.000Z',
    start: { dateTime: '2026-10-07T18:00:00-07:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-10-07T19:00:00-07:00', timeZone: 'America/Los_Angeles' },
  })!;
  expect(event).toEqual({
    id: 'google:work@example.com:e1',
    provider: 'google',
    providerEventId: 'e1',
    calendarId: 'work@example.com',
    title: 'Design review',
    start: '2026-10-08T01:00:00.000Z',
    end: '2026-10-08T02:00:00.000Z',
    allDay: false,
    timeZone: 'America/Los_Angeles',
    status: 'confirmed',
    link: 'https://www.google.com/calendar/event?eid=abc',
    updatedAt: '2026-10-01T10:00:00.000Z',
    fetchedAt: FETCHED,
  });
});

test('the same instant is shown at the right local time wherever the device is', () => {
  // 18:00 in Los Angeles on the 7th.
  const event = read({ id: 'e1', summary: 'Call', start: { dateTime: '2026-10-07T18:00:00-07:00' }, end: { dateTime: '2026-10-07T19:00:00-07:00' } })!;
  expect(inZone('America/Los_Angeles', () => on(event, '2026-10-01', '2026-10-31'))).toEqual(['2026-10-07 1080-1140']);
  expect(inZone('Europe/Istanbul', () => on(event, '2026-10-01', '2026-10-31'))).toEqual(['2026-10-08 240-300']);
  expect(inZone('Pacific/Auckland', () => on(event, '2026-10-01', '2026-10-31'))).toEqual(['2026-10-08 840-900']);
  expect(inZone('Europe/Istanbul', () => timeLabel(event))).toBe('04:00 – 05:00');
});

test('an all-day event stays on its day in every zone', () => {
  // Google gives the first day and the day after the last.
  const event = read({ id: 'e2', summary: 'Holiday', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } })!;
  expect(event).toMatchObject({ allDay: true, start: '2026-10-07', end: '2026-10-07', timeZone: null });
  for (const zone of ['Pacific/Kiritimati', 'Pacific/Auckland', 'Europe/Istanbul', 'UTC', 'America/Los_Angeles', 'Pacific/Pago_Pago']) {
    expect(inZone(zone, () => on(event, '2026-10-01', '2026-10-31')), zone).toEqual(['2026-10-07 all day']);
  }
});

test('an all-day event of several days covers each of them and no more', () => {
  const event = read({ id: 'e3', summary: 'Conference', start: { date: '2026-10-07' }, end: { date: '2026-10-10' } })!;
  expect(event).toMatchObject({ start: '2026-10-07', end: '2026-10-09' });
  expect(inZone('America/Los_Angeles', () => on(event, '2026-10-01', '2026-10-31'))).toEqual(['2026-10-07 all day', '2026-10-08 all day', '2026-10-09 all day']);
  // Only the days in view.
  expect(on(event, '2026-10-08', '2026-10-08')).toEqual(['2026-10-08 all day']);
});

test('an event past midnight is the evening of one day and the small hours of the next', () => {
  const event = read({ id: 'e4', summary: 'Night flight', start: { dateTime: '2026-10-07T22:30:00+03:00' }, end: { dateTime: '2026-10-08T01:15:00+03:00' } })!;
  expect(inZone('Europe/Istanbul', () => on(event, '2026-10-01', '2026-10-31'))).toEqual(['2026-10-07 1350-1440', '2026-10-08 0-75']);
  // In a zone where it does not cross midnight, it is one piece.
  expect(inZone('UTC', () => on(event, '2026-10-01', '2026-10-31'))).toEqual(['2026-10-07 1170-1335']);
});

test('an event that ends at midnight does not spill into the next day', () => {
  const event = read({ id: 'e5', summary: 'Dinner', start: { dateTime: '2026-10-07T21:00:00+03:00' }, end: { dateTime: '2026-10-08T00:00:00+03:00' } })!;
  expect(inZone('Europe/Istanbul', () => on(event, '2026-10-01', '2026-10-31'))).toEqual(['2026-10-07 1260-1440']);
});

test('a timed event lasting a day or more joins the all-day events', () => {
  const event = read({ id: 'e6', summary: 'Offsite', start: { dateTime: '2026-10-07T09:00:00+03:00' }, end: { dateTime: '2026-10-09T17:00:00+03:00' } })!;
  expect(inZone('Europe/Istanbul', () => on(event, '2026-10-01', '2026-10-31'))).toEqual(['2026-10-07 all day', '2026-10-08 all day', '2026-10-09 all day']);
});

test('a daylight-saving change does not move an event', () => {
  // Clocks go back in Los Angeles on 1 November 2026; 09:00 the day after is still 09:00.
  const event = read({ id: 'e7', summary: 'Standup', start: { dateTime: '2026-11-02T09:00:00-08:00' }, end: { dateTime: '2026-11-02T09:15:00-08:00' } })!;
  expect(inZone('America/Los_Angeles', () => on(event, '2026-11-01', '2026-11-30'))).toEqual(['2026-11-02 540-555']);
});

test('what should not be on the calendar is left out', () => {
  const times = { start: { dateTime: '2026-10-07T10:00:00Z' }, end: { dateTime: '2026-10-07T11:00:00Z' } };
  expect(read({ id: 'c1', status: 'cancelled' })).toBeNull();
  expect(read({ id: 'c2', eventType: 'workingLocation', ...times })).toBeNull();
  expect(read({ id: 'c3', ...times, attendees: [{ responseStatus: 'accepted' }, { self: true, responseStatus: 'declined' }] })).toBeNull();
  expect(read({ id: 'c4', start: { dateTime: 'not a time' }, end: { dateTime: 'nor this' } })).toBeNull();
  // Accepted, tentative, and events with no guests at all stay.
  expect(read({ id: 'k1', ...times, attendees: [{ self: true, responseStatus: 'accepted' }] })).not.toBeNull();
  expect(read({ id: 'k2', status: 'tentative', ...times })).toMatchObject({ status: 'tentative' });
});

test('a missing title is named, and only a link to Google is passed on', () => {
  const times = { start: { dateTime: '2026-10-07T10:00:00Z' }, end: { dateTime: '2026-10-07T11:00:00Z' } };
  expect(read({ id: 't1', ...times })).toMatchObject({ title: '(No title)', link: null });
  for (const link of ['https://evil.example/calendar', 'javascript:alert(1)', 'http://www.google.com/calendar/event', 'https://google.com.evil.example/x']) {
    expect(read({ id: 't2', htmlLink: link, ...times })!.link, link).toBeNull();
  }
  expect(read({ id: 't3', htmlLink: 'https://calendar.google.com/calendar/event?eid=1', ...times })!.link).toBe('https://calendar.google.com/calendar/event?eid=1');
});

test('nothing beyond titles and times is asked of Google', () => {
  for (const field of ['description', 'location', 'email', 'displayName', 'conferenceData', 'attachments', 'creator', 'organizer']) {
    expect(EVENT_FIELDS, field).not.toContain(field);
  }
});

test('a hidden calendar shows nothing, and two calendars keep their own events', () => {
  const event = read({ id: 'e1', summary: 'Call', start: { dateTime: '2026-10-07T10:00:00Z' }, end: { dateTime: '2026-10-07T11:00:00Z' } })!;
  expect(showingsByDay([event], [calendar({ visible: false })], '2026-10-01', '2026-10-31').size).toBe(0);
  expect(showingsByDay([event], [calendar({ calendarId: 'other@example.com' })], '2026-10-01', '2026-10-31').size).toBe(0);
  const [showing] = showingsByDay([event], [calendar()], '2026-10-01', '2026-10-31').values().next().value!;
  expect(showing).toMatchObject({ key: `x:${event.id}@${showing.date}`, calendar: 'Work' });
});

test('the span that is read: five weeks back, twenty-seven ahead, re-read once it has slipped a week', () => {
  const window = syncWindow('2026-10-07');
  expect(window).toEqual({ from: '2026-09-02', to: '2027-04-14' });
  expect(inZone('Europe/Istanbul', () => spanOfWindow(window))).toEqual({ timeMin: '2026-09-01T21:00:00.000Z', timeMax: '2027-04-14T21:00:00.000Z' });

  const read = { windowFrom: window.from, windowTo: window.to };
  expect(covers(read, '2026-10-07')).toBe(true);
  expect(covers(read, '2026-10-14')).toBe(true);
  expect(covers(read, '2026-10-15')).toBe(false);
  expect(covers({ windowFrom: null, windowTo: null }, '2026-10-07')).toBe(false);
});

test('a change far outside the span is not kept', () => {
  const window = syncWindow('2026-10-07');
  const timed = (day: string) => read({ id: day, start: { dateTime: `${day}T10:00:00Z` }, end: { dateTime: `${day}T11:00:00Z` } })!;
  const allDay = (first: string, after: string) => read({ id: first, start: { date: first }, end: { date: after } })!;
  expect(within(timed('2026-10-07'), window)).toBe(true);
  expect(within(timed('2026-08-01'), window)).toBe(false);
  expect(within(timed('2027-06-01'), window)).toBe(false);
  expect(within(allDay('2026-09-02', '2026-09-03'), window)).toBe(true);
  expect(within(allDay('2026-08-30', '2026-09-03'), window)).toBe(true);
  expect(within(allDay('2026-08-30', '2026-09-02'), window)).toBe(false);
});
