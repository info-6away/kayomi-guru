import { expect, test } from '@playwright/test';
import { MAX_STEPS, budgetOf, occurrencesOf, type Reading } from '../../lib/calendars/ical';

// iCalendar, as Yahoo's CalDAV server returns it, becoming Koyomi's record of each occurrence in
// the span: single events, all-day ones, repeating ones with their exceptions, in their zones,
// across a change of clocks, and nothing of what Koyomi does not show.

const C = '33333333-3333-4333-8333-333333333333';
const CAL = '/dav/abc/Calendar/Personal/';
const FETCHED = '2026-10-07T09:00:00.000Z';
const SPAN = { timeMin: '2026-09-01T00:00:00.000Z', timeMax: '2027-04-14T00:00:00.000Z' };
const reading = (over: Partial<Reading> = {}): Reading => ({ connectionId: C, calendarId: CAL, fetchedAt: FETCHED, ...SPAN, ...over });
const ics = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yahoo//Calendar//EN', ...lines, 'END:VCALENDAR'].join('\r\n');
const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const read = (text: string, over?: Partial<Reading>) => occurrencesOf(text, reading(over));
const when = (text: string, over?: Partial<Reading>) => read(text, over).map((e) => `${e.start} ${e.end}${e.title === 'Weekly' || e.title === 'Daily' ? '' : ` ${e.title}`}`);

test('a timed event keeps its instant, in the zone it was written in, and nothing that Koyomi does not show', () => {
  const [event, ...rest] = read(
    ics(
      ...vevent(
        'UID:review@yahoo.com',
        'SUMMARY: Design review ',
        'DTSTART;TZID=America/New_York:20261007T090000',
        'DTEND;TZID=America/New_York:20261007T103000',
        'LAST-MODIFIED:20261001T100000Z',
        'STATUS:CONFIRMED',
        'DESCRIPTION:PRIVATE NOTES',
        'LOCATION:PRIVATE PLACE',
        'ORGANIZER;CN=Boss:mailto:boss@private.test',
        'ATTENDEE;PARTSTAT=ACCEPTED:mailto:someone@private.test',
        'URL:https://meet.example/PRIVATE',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:PRIVATE ALARM',
        'TRIGGER:-PT15M',
        'END:VALARM',
      ),
    ),
  );
  expect(rest).toEqual([]);
  expect(event).toEqual({
    id: `${C}:${CAL}:review@yahoo.com`,
    connectionId: C,
    provider: 'yahoo',
    providerEventId: 'review@yahoo.com',
    calendarId: CAL,
    title: 'Design review',
    start: '2026-10-07T13:00:00.000Z',
    end: '2026-10-07T14:30:00.000Z',
    allDay: false,
    timeZone: 'America/New_York',
    status: 'confirmed',
    link: null,
    updatedAt: '2026-10-01T10:00:00.000Z',
    fetchedAt: FETCHED,
  });
  expect(JSON.stringify(event)).not.toMatch(/PRIVATE|private\.test|meet\.example|Boss/);
});

test('UTC, a zone the object defines itself, and a floating time (read as UTC)', () => {
  expect(when(ics(...vevent('UID:a', 'SUMMARY:A', 'DTSTART:20261007T120000Z', 'DTEND:20261007T130000Z')))).toEqual(['2026-10-07T12:00:00.000Z 2026-10-07T13:00:00.000Z A']);
  const own = ics(
    'BEGIN:VTIMEZONE',
    'TZID:Yahoo Custom',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...vevent('UID:b', 'SUMMARY:B', 'DTSTART;TZID=Yahoo Custom:20261007T120000', 'DURATION:PT45M'),
  );
  expect(when(own)).toEqual(['2026-10-07T06:30:00.000Z 2026-10-07T07:15:00.000Z B']);
  expect(when(ics(...vevent('UID:c', 'SUMMARY:C', 'DTSTART:20261007T120000', 'DTEND:20261007T121500')))).toEqual(['2026-10-07T12:00:00.000Z 2026-10-07T12:15:00.000Z C']);
  // An IANA name is read by its own rules even where the object carries a definition of it.
  const both = ics(
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Istanbul',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0300',
    'TZOFFSETTO:+0300',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...vevent('UID:d', 'SUMMARY:D', 'DTSTART;TZID=Europe/Istanbul:20261007T120000', 'DTEND;TZID=Europe/Istanbul:20261007T130000'),
  );
  expect(when(both)).toEqual(['2026-10-07T09:00:00.000Z 2026-10-07T10:00:00.000Z D']);
});

test('all-day events are days, the last one included, and never instants', () => {
  expect(read(ics(...vevent('UID:h', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261029', 'DTEND;VALUE=DATE:20261030')))).toMatchObject([{ start: '2026-10-29', end: '2026-10-29', allDay: true, timeZone: null }]);
  expect(read(ics(...vevent('UID:t', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20261009', 'DTEND;VALUE=DATE:20261012')))).toMatchObject([{ start: '2026-10-09', end: '2026-10-11', allDay: true }]);
  expect(read(ics(...vevent('UID:o', 'SUMMARY:One day', 'DTSTART;VALUE=DATE:20261009')))).toMatchObject([{ start: '2026-10-09', end: '2026-10-09' }]);
  expect(read(ics(...vevent('UID:p', 'SUMMARY:Two days', 'DTSTART;VALUE=DATE:20261009', 'DURATION:P2D')))).toMatchObject([{ start: '2026-10-09', end: '2026-10-10' }]);
});

test('a weekly meeting stays at nine in New York across the change of clocks', () => {
  const weekly = ics(
    ...vevent('UID:w', 'SUMMARY:Weekly', 'DTSTART;TZID=America/New_York:20261019T090000', 'DTEND;TZID=America/New_York:20261019T093000', 'RRULE:FREQ=WEEKLY;COUNT=4'),
  );
  // Summer time ends on 1 November 2026: nine o'clock is 13:00 UTC before and 14:00 UTC after.
  expect(when(weekly)).toEqual([
    '2026-10-19T13:00:00.000Z 2026-10-19T13:30:00.000Z',
    '2026-10-26T13:00:00.000Z 2026-10-26T13:30:00.000Z',
    '2026-11-02T14:00:00.000Z 2026-11-02T14:30:00.000Z',
    '2026-11-09T14:00:00.000Z 2026-11-09T14:30:00.000Z',
  ]);
  // Each occurrence is an event of its own, named by the series and its own start. The series
  // itself is not one more.
  expect(read(weekly).map((e) => e.providerEventId)).toEqual(['w::20261019T130000Z', 'w::20261026T130000Z', 'w::20261102T140000Z', 'w::20261109T140000Z']);
  // In the spring, in Europe, the other way.
  const berlin = ics(...vevent('UID:b', 'SUMMARY:Weekly', 'DTSTART;TZID=Europe/Berlin:20270322T090000', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;COUNT=2'));
  expect(when(berlin, { timeMax: '2027-04-30T00:00:00.000Z' })).toEqual(['2027-03-22T08:00:00.000Z 2027-03-22T09:00:00.000Z', '2027-03-29T07:00:00.000Z 2027-03-29T08:00:00.000Z']);
});

test('exceptions: an occurrence excluded, one moved and renamed, one cancelled, one added', () => {
  const series = ics(
    ...vevent(
      'UID:s',
      'SUMMARY:Weekly',
      'DTSTART;TZID=America/New_York:20261019T090000',
      'DTEND;TZID=America/New_York:20261019T093000',
      // Until the morning of 23 November, written in UTC: that one is the last.
      'RRULE:FREQ=WEEKLY;UNTIL=20261123T140000Z',
      // Excluded, written in UTC while the series is in New York: the same instant all the same.
      'EXDATE:20261026T130000Z',
      'RDATE;TZID=America/New_York:20261104T160000',
    ),
    ...vevent('UID:s', 'RECURRENCE-ID;TZID=America/New_York:20261102T090000', 'SUMMARY:Weekly (moved)', 'DTSTART;TZID=America/New_York:20261102T110000', 'DTEND;TZID=America/New_York:20261102T120000'),
    ...vevent('UID:s', 'RECURRENCE-ID;TZID=America/New_York:20261109T090000', 'SUMMARY:Weekly', 'STATUS:CANCELLED', 'DTSTART;TZID=America/New_York:20261109T090000', 'DTEND;TZID=America/New_York:20261109T093000'),
  );
  expect(when(series)).toEqual([
    '2026-10-19T13:00:00.000Z 2026-10-19T13:30:00.000Z',
    '2026-11-02T16:00:00.000Z 2026-11-02T17:00:00.000Z Weekly (moved)',
    '2026-11-16T14:00:00.000Z 2026-11-16T14:30:00.000Z',
    '2026-11-23T14:00:00.000Z 2026-11-23T14:30:00.000Z',
    '2026-11-04T21:00:00.000Z 2026-11-04T21:30:00.000Z',
  ]);
  // The moved one keeps the id of the occurrence it stands in for.
  expect(read(series).find((e) => e.title === 'Weekly (moved)')!.providerEventId).toBe('s::20261102T140000Z');
});

test('a series that began long ago is read only within the span; one moved into the span from before it still shows', () => {
  const daily = ics(
    ...vevent('UID:d', 'SUMMARY:Daily', 'DTSTART:20150101T080000Z', 'DTEND:20150101T081500Z', 'RRULE:FREQ=DAILY'),
    ...vevent('UID:d', 'RECURRENCE-ID:20200101T080000Z', 'SUMMARY:Moved here', 'DTSTART:20261008T150000Z', 'DTEND:20261008T160000Z'),
  );
  const span = { timeMin: '2026-10-05T00:00:00.000Z', timeMax: '2026-10-08T00:00:00.000Z' };
  expect(when(daily, span)).toEqual(['2026-10-05T08:00:00.000Z 2026-10-05T08:15:00.000Z', '2026-10-06T08:00:00.000Z 2026-10-06T08:15:00.000Z', '2026-10-07T08:00:00.000Z 2026-10-07T08:15:00.000Z']);
  expect(when(daily, { timeMin: '2026-10-08T12:00:00.000Z', timeMax: '2026-10-09T00:00:00.000Z' })).toEqual(['2026-10-08T15:00:00.000Z 2026-10-08T16:00:00.000Z Moved here']);
});

test('a series with no end is stepped through no further than the span, and never for ever', () => {
  const hourly = ics(...vevent('UID:x', 'SUMMARY:Ping', 'DTSTART:19700101T000000Z', 'DURATION:PT1M', 'RRULE:FREQ=MINUTELY'));
  const started = Date.now();
  expect(read(hourly)).toEqual([]);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(MAX_STEPS).toBeLessThanOrEqual(20_000);
});

test('rules that can never happen, or hardly ever, end at once', () => {
  // Each of these once kept ical.js looking for ever, or for seconds: anyone who can send an
  // invitation can put one in a calendar.
  const rules = [
    'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=DAILY;BYMONTH=4;BYMONTHDAY=31',
    'FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30;COUNT=5',
    'FREQ=DAILY;BYYEARDAY=1;BYMONTH=2',
    'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=29;BYDAY=MO;COUNT=3',
    'FREQ=YEARLY;BYMONTH=4;BYDAY=1MO;BYMONTHDAY=15,16,17,18,19,20,21',
    'FREQ=MONTHLY;BYMONTHDAY=31;BYMONTH=2,4',
    'FREQ=SECONDLY;BYMONTH=12',
    'FREQ=MINUTELY',
  ];
  const started = Date.now();
  for (const [i, rule] of rules.entries()) {
    // Begun long ago, and again in the span: once in the span, the start itself is still shown.
    expect(read(ics(...vevent(`UID:never${i}`, 'SUMMARY:Never', 'DTSTART:20000105T090000Z', 'DURATION:PT1H', `RRULE:${rule}`)))).toEqual([]);
    expect(when(ics(...vevent(`UID:once${i}`, 'SUMMARY:Never', 'DTSTART:20261005T090000Z', 'DURATION:PT1H', `RRULE:${rule}`)))[0]).toBe('2026-10-05T09:00:00.000Z 2026-10-05T10:00:00.000Z Never');
  }
  expect(Date.now() - started).toBeLessThan(4000);
});

test('a daily series of years, in a named zone, is worked out at once, and the same as day by day', () => {
  const daily = ics(...vevent('UID:d', 'SUMMARY:Daily', 'DTSTART;TZID=America/New_York:20160104T090000', 'DTEND;TZID=America/New_York:20160104T091500', 'RRULE:FREQ=DAILY'));
  const started = Date.now();
  const all = read(daily);
  expect(Date.now() - started).toBeLessThan(1000);
  // Every day of the span, at nine in New York, summer time or not.
  expect(all).toHaveLength(225);
  const nine = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  expect(new Set(all.map((e) => nine.format(new Date(e.start))))).toEqual(new Set(['09:00']));
  expect([all[0].start, all.at(-1)!.start]).toEqual(['2026-09-01T13:00:00.000Z', '2027-04-13T13:00:00.000Z']);
  expect(all.find((e) => e.start.startsWith('2026-12-01'))!.start).toBe('2026-12-01T14:00:00.000Z');
});

test('a series stepped from just before the span has the occurrences it would have from its start', () => {
  // Every other week, Monday, Wednesday and Friday, at nine in Berlin, since January 2019; one
  // left out in the span, and one from 2020 moved into it.
  const lines = [
    'UID:fortnight',
    'SUMMARY:Weekly',
    'DTSTART;TZID=Europe/Berlin:20190107T090000',
    'DURATION:PT30M',
    'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR',
    'EXDATE;TZID=Europe/Berlin:20261111T090000',
  ];
  const moved = vevent('UID:fortnight', 'RECURRENCE-ID;TZID=Europe/Berlin:20200106T090000', 'SUMMARY:Moved here', 'DTSTART;TZID=Europe/Berlin:20261007T180000', 'DURATION:PT1H');
  const span = { timeMin: '2026-10-01T00:00:00.000Z', timeMax: '2026-12-01T00:00:00.000Z' };
  const got = read(ics(...vevent(...lines), ...moved), span);
  // Worked out day by day instead: what the rule says, from its start.
  const expected: string[] = [];
  for (let day = Date.UTC(2019, 0, 7); day < Date.parse(span.timeMax); day += 864e5) {
    const weekday = new Date(day).getUTCDay();
    const fortnight = Math.floor((day - Date.UTC(2019, 0, 7)) / (7 * 864e5)) % 2 === 0;
    const iso = new Date(day).toISOString().slice(0, 10);
    if (fortnight && [1, 3, 5].includes(weekday) && iso >= '2026-10-01' && iso !== '2026-11-11') expected.push(iso);
  }
  const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const series = got.filter((e) => e.title === 'Weekly');
  expect(series.map((e) => berlin.format(new Date(e.start)).slice(0, 10))).toEqual(expected);
  expect(new Set(series.map((e) => berlin.format(new Date(e.start)).slice(-5)))).toEqual(new Set(['09:00']));
  expect(got.filter((e) => e.title === 'Moved here')).toMatchObject([{ providerEventId: 'fortnight::20200106T080000Z', start: '2026-10-07T16:00:00.000Z', end: '2026-10-07T17:00:00.000Z' }]);
  // Counted from its start, a series is still stepped from there.
  const counted = read(ics(...vevent('UID:c', 'SUMMARY:Daily', 'DTSTART:20260101T080000Z', 'DURATION:PT15M', 'RRULE:FREQ=DAILY;COUNT=400')));
  expect([counted.length, counted[0].start, counted.at(-1)!.start]).toEqual([157, '2026-09-01T08:00:00.000Z', '2027-02-04T08:00:00.000Z']);
});

test('one calendar has only so long for all of its events, and says when it ran out', () => {
  const weekly = ics(...vevent('UID:w', 'SUMMARY:Weekly', 'DTSTART:20261005T090000Z', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY'));
  const spent = budgetOf(0);
  expect(read(weekly, { budget: spent })).toEqual([]);
  expect(spent.ranOut).toBe(true);
  const ample = budgetOf();
  expect(read(weekly, { budget: ample })).toHaveLength(28);
  expect(ample.ranOut).toBe(false);
  expect(ample.left).toBeLessThan(budgetOf().left);
});

test('yearly all-day days, with one year left out', () => {
  const birthday = ics(...vevent('UID:b', 'SUMMARY:Sam’s birthday', 'DTSTART;VALUE=DATE:20201029', 'DTEND;VALUE=DATE:20201030', 'RRULE:FREQ=YEARLY', 'EXDATE;VALUE=DATE:20271029'));
  expect(read(birthday, { timeMax: '2028-12-31T00:00:00.000Z' }).map((e) => `${e.start} ${e.providerEventId}`)).toEqual(['2026-10-29 b::20261029', '2028-10-29 b::20281029']);
});

test('what should not be on the calendar is left out: cancelled, tasks, and with a look back, what does not repeat', () => {
  expect(read(ics(...vevent('UID:c', 'SUMMARY:Off', 'STATUS:CANCELLED', 'DTSTART:20261007T120000Z')))).toEqual([]);
  expect(read(ics(...vevent('UID:m', 'SUMMARY:Weekly', 'STATUS:CANCELLED', 'DTSTART:20261007T120000Z', 'RRULE:FREQ=WEEKLY;COUNT=3')))).toEqual([]);
  expect(read(ics('BEGIN:VTODO', 'UID:t', 'SUMMARY:Task', 'DUE:20261007T120000Z', 'END:VTODO'))).toEqual([]);
  expect(read(ics(...vevent('SUMMARY:No uid', 'DTSTART:20261007T120000Z')))).toEqual([]);
  expect(read(ics(...vevent('UID:old', 'SUMMARY:Old', 'DTSTART:20200101T120000Z')))).toEqual([]);
  const single = ics(...vevent('UID:s', 'SUMMARY:Single', 'DTSTART:20261007T120000Z'));
  expect(read(single)).toHaveLength(1);
  expect(read(single, { repeatingOnly: true })).toEqual([]);
  expect(read(ics(...vevent('UID:t2', 'SUMMARY:Maybe', 'STATUS:TENTATIVE', 'DTSTART:20261007T120000Z')))[0].status).toBe('tentative');
  expect(read(ics(...vevent('UID:n', 'SUMMARY:  ', 'DTSTART:20261007T120000Z')))[0].title).toBe('(No title)');
  // Not iCalendar at all.
  expect(() => read('not a calendar')).toThrow();
});

test('one occurrence sent without its series is an event by itself', () => {
  const orphan = ics(...vevent('UID:inv', 'RECURRENCE-ID:20261008T100000Z', 'SUMMARY:One of theirs', 'DTSTART:20261008T110000Z', 'DTEND:20261008T113000Z'));
  expect(read(orphan)).toMatchObject([{ providerEventId: 'inv::20261008T100000Z', start: '2026-10-08T11:00:00.000Z', title: 'One of theirs' }]);
});

test('the same UID in another account, or another calendar, is another event', () => {
  const one = ics(...vevent('UID:dentist', 'SUMMARY:Dentist', 'DTSTART:20261007T120000Z'));
  const ids = [read(one)[0].id, read(one, { connectionId: '44444444-4444-4444-8444-444444444444' })[0].id, read(one, { calendarId: '/dav/abc/Calendar/Family/' })[0].id];
  expect(new Set(ids).size).toBe(3);
});
