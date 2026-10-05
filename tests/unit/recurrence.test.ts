import { expect, test } from '@playwright/test';
import { spanOf, toInstant } from '../../lib/dates';
import { layoutDay, moved, nearestDay, occurrencesByDay } from '../../lib/occurrences';
import { occurrenceDays, shiftRecurrence } from '../../lib/recurrence';
import type { CalendarEvent, Frequency, PlanItem, Recurrence } from '../../lib/types';

const every = (freq: Frequency, rest: Partial<Recurrence> = {}): Recurrence => ({ freq, until: null, except: [], ...rest });

/** An event on `day`; `from` and `to` are minutes from midnight. */
const event = ({ day, from = 450, to = 510, ...over }: Partial<CalendarEvent> & { day: string; from?: number; to?: number }): CalendarEvent => ({
  id: 'e1',
  title: 'Gym',
  start: toInstant(day, from),
  end: toInstant(day, to),
  allDay: false,
  category: 'life',
  planItemId: null,
  recurrence: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

test('an event that does not repeat occurs once', () => {
  expect(occurrenceDays('2026-10-05', null, '2026-10-05', '2026-10-11')).toEqual(['2026-10-05']);
  expect(occurrenceDays('2026-10-05', null, '2026-10-06', '2026-10-11')).toEqual([]);
});

test('daily', () => {
  expect(occurrenceDays('2026-10-05', every('daily'), '2026-10-05', '2026-10-08')).toEqual([
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
  ]);
});

test('weekly keeps its weekday, far from where it began', () => {
  expect(occurrenceDays('2026-10-05', every('weekly'), '2026-10-12', '2026-10-25')).toEqual(['2026-10-12', '2026-10-19']);
  expect(occurrenceDays('2026-10-05', every('weekly'), '2031-03-03', '2031-03-09')).toEqual(['2031-03-03']);
});

test('nothing occurs before the first day', () => {
  expect(occurrenceDays('2026-10-05', every('weekly'), '2026-09-01', '2026-10-06')).toEqual(['2026-10-05']);
  expect(occurrenceDays('2026-10-05', every('daily'), '2026-09-01', '2026-09-30')).toEqual([]);
});

test('monthly on the 31st falls on the last day of shorter months', () => {
  expect(occurrenceDays('2026-01-31', every('monthly'), '2026-01-01', '2026-04-30')).toEqual([
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
  ]);
});

test('yearly on 29 February falls on the 28th outside leap years', () => {
  expect(occurrenceDays('2028-02-29', every('yearly'), '2028-01-01', '2032-12-31')).toEqual([
    '2028-02-29',
    '2029-02-28',
    '2030-02-28',
    '2031-02-28',
    '2032-02-29',
  ]);
});

test('a series stops at its last day', () => {
  expect(occurrenceDays('2026-10-05', every('weekly', { until: '2026-10-19' }), '2026-10-01', '2026-11-30')).toEqual([
    '2026-10-05',
    '2026-10-12',
    '2026-10-19',
  ]);
});

test('removed days are skipped', () => {
  expect(occurrenceDays('2026-10-05', every('weekly', { except: ['2026-10-12'] }), '2026-10-05', '2026-10-25')).toEqual([
    '2026-10-05',
    '2026-10-19',
  ]);
});

test('moving a series moves its end and its removed days with it', () => {
  expect(shiftRecurrence(every('weekly', { until: '2026-11-02', except: ['2026-10-12'] }), 2)).toEqual(
    every('weekly', { until: '2026-11-04', except: ['2026-10-14'] }),
  );
  expect(shiftRecurrence(null, 3)).toBeNull();
});

test('moving one occurrence of a series moves its first day by the same amount', () => {
  const gym = event({ day: '2026-10-05', recurrence: every('weekly') });
  const occurrence = occurrencesByDay([gym], [], '2026-10-19', '2026-10-19').get('2026-10-19')![0];
  const next = moved(occurrence, { date: '2026-10-20', start: 480, end: 540 });
  expect(spanOf(next)).toEqual({ date: '2026-10-06', start: 480, end: 540 });
});

test('a series lists once per day, in order of start', () => {
  const gym = event({ day: '2026-10-05', recurrence: every('weekly') });
  const lunch = event({ id: 'e2', title: 'Lunch', day: '2026-10-12', from: 420, to: 450 });
  const byDay = occurrencesByDay([gym, lunch], [], '2026-10-12', '2026-10-18');
  expect([...byDay.keys()]).toEqual(['2026-10-12']);
  expect(byDay.get('2026-10-12')!.map((o) => o.event.title)).toEqual(['Lunch', 'Gym']);
  expect(byDay.get('2026-10-12')![1].key).toBe('e1@2026-10-12');
});

test('only an event scheduled from a completed Plan item is done', () => {
  const item: PlanItem = { id: 'p1', title: 'Call', status: 'completed', createdAt: '', updatedAt: '' };
  const call = event({ id: 'e2', day: '2026-10-05', planItemId: 'p1' });
  const lunch = event({ id: 'e3', day: '2026-10-05' });
  const [a, b] = occurrencesByDay([call, lunch], [item], '2026-10-05', '2026-10-05').get('2026-10-05')!;
  expect([a.done, b.done]).toEqual([true, false]);
  const reopened = occurrencesByDay([call], [{ ...item, status: 'open' }], '2026-10-05', '2026-10-05').get('2026-10-05')!;
  expect(reopened[0].done).toBe(false);
});

test('search shows the next occurrence, or the last when the series is over', () => {
  const gym = event({ day: '2026-10-05', recurrence: every('weekly') });
  expect(nearestDay(gym, '2026-10-14')).toBe('2026-10-19');
  const ended = event({ day: '2026-10-05', recurrence: every('weekly', { until: '2026-10-19' }) });
  expect(nearestDay(ended, '2026-11-10')).toBe('2026-10-19');
  expect(nearestDay(event({ day: '2026-10-05' }), '2026-11-10')).toBe('2026-10-05');
});

test('overlapping events sit side by side; others keep the full width', () => {
  const placed = layoutDay(
    [
      { id: 'a', start: 540, end: 660 },
      { id: 'b', start: 600, end: 630 },
      { id: 'c', start: 720, end: 780 },
    ],
    24,
  );
  const of = (id: string) => placed.find((p) => p.item.id === id)!;
  expect([of('a').col, of('a').cols]).toEqual([0, 2]);
  expect([of('b').col, of('b').cols]).toEqual([1, 2]);
  expect([of('c').col, of('c').cols]).toEqual([0, 1]);
});

test('a column is reused once the event in it has ended', () => {
  const placed = layoutDay(
    [
      { id: 'a', start: 540, end: 720 },
      { id: 'b', start: 540, end: 600 },
      { id: 'c', start: 600, end: 660 },
    ],
    24,
  );
  expect(placed.map((p) => [p.item.id, p.col, p.cols])).toEqual([
    ['a', 0, 2],
    ['b', 1, 2],
    ['c', 1, 2],
  ]);
});

test('events too short to draw apart are also separated', () => {
  const placed = layoutDay(
    [
      { id: 'a', start: 540, end: 555 },
      { id: 'b', start: 555, end: 570 },
    ],
    24,
  );
  expect(placed.map((p) => p.cols)).toEqual([2, 2]);
});
