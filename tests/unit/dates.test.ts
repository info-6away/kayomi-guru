import { expect, test } from '@playwright/test';
import { addDays, addMonths, diffDays, hm, mondayOf, monthGrid, parseTime, spanOf, toInstant, weekday } from '../../lib/dates';

test('adds days across month, year and leap-day boundaries', () => {
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  expect(diffDays('2026-11-02', '2026-10-26')).toBe(7);
});

test('a daylight-saving change never shifts a date', () => {
  // Clocks change on these days in Europe and the US.
  for (const day of ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01']) {
    expect(addDays(addDays(day, -1), 1)).toBe(day);
    expect(diffDays(addDays(day, 1), addDays(day, -1))).toBe(2);
  }
});

test('weeks start on Monday', () => {
  expect(weekday('2026-10-05')).toBe(1);
  expect(mondayOf('2026-10-05')).toBe('2026-10-05');
  expect(mondayOf('2026-10-11')).toBe('2026-10-05');
  expect(mondayOf('2026-10-12')).toBe('2026-10-12');
});

test('the month grid covers the whole month in full weeks', () => {
  expect(monthGrid('2026-10-15')).toEqual({ start: '2026-09-28', rows: 5 });
  // February 2027 starts on a Monday and has exactly four weeks.
  expect(monthGrid('2027-02-10')).toEqual({ start: '2027-02-01', rows: 4 });
  // August 2026 starts on a Saturday and needs six rows.
  expect(monthGrid('2026-08-01')).toEqual({ start: '2026-07-27', rows: 6 });
});

test('steps months across a year', () => {
  expect(addMonths('2026-12-19', 1)).toBe('2027-01-01');
  expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
  expect(addMonths('2026-10-05', 0)).toBe('2026-10-01');
});

test('reads typed times', () => {
  expect(parseTime('9')).toBe(540);
  expect(parseTime('09:30')).toBe(570);
  expect(parseTime('930')).toBe(570);
  expect(parseTime('1430')).toBe(870);
  expect(parseTime('14.05')).toBe(845);
  expect(parseTime('24:00')).toBe(1440);
  expect(parseTime(' 7 ')).toBe(420);
});

test('rejects what is not a time', () => {
  for (const text of ['', 'noon', '25', '12:60', '24:01', '1:2:3', '-3']) expect(parseTime(text)).toBeNull();
});

test('formats minutes as a 24-hour time', () => {
  expect(hm(0)).toBe('00:00');
  expect(hm(570)).toBe('09:30');
  expect(hm(1440)).toBe('24:00');
});

test('a stored event comes back on the same day at the same time', () => {
  const event = { start: toInstant('2026-10-05', 14 * 60), end: toInstant('2026-10-05', 15 * 60 + 30) };
  expect(spanOf(event)).toEqual({ date: '2026-10-05', start: 840, end: 930 });
});

test('an event that ends at midnight stays on its own day', () => {
  const event = { start: toInstant('2026-10-05', 23 * 60), end: toInstant('2026-10-05', 1440) };
  expect(spanOf(event)).toEqual({ date: '2026-10-05', start: 1380, end: 1440 });
});
