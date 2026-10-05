import { addDays, daysInMonth, diffDays, makeKey, parts } from './dates';
import type { Recurrence } from './types';

/**
 * The days in [from, to] on which an event first held on `first` occurs.
 * Monthly and yearly series fall back to the last day of a month that is too short
 * (the 31st becomes the 30th, 29 February becomes the 28th).
 */
export function occurrenceDays(first: string, rec: Recurrence | null, from: string, to: string): string[] {
  if (!rec) return first >= from && first <= to ? [first] : [];

  const last = rec.until && rec.until < to ? rec.until : to;
  const out: string[] = [];
  const push = (day: string) => {
    if (day >= from && day >= first && day <= last && !rec.except.includes(day)) out.push(day);
  };

  if (rec.freq === 'daily' || rec.freq === 'weekly') {
    const step = rec.freq === 'daily' ? 1 : 7;
    const skip = Math.max(0, Math.ceil(diffDays(from, first) / step));
    for (let day = addDays(first, skip * step); day <= last; day = addDays(day, step)) push(day);
    return out;
  }

  const a = parts(first);
  const b = parts(from);
  const c = parts(last);
  const step = rec.freq === 'monthly' ? 1 : 12;
  for (let i = Math.max(0, Math.floor(((b.y - a.y) * 12 + (b.m - a.m)) / step)); ; i++) {
    const months = a.m - 1 + i * step;
    const y = a.y + Math.floor(months / 12);
    const m = (months % 12) + 1;
    if (y > c.y || (y === c.y && m > c.m)) break;
    push(makeKey(y, m, Math.min(a.d, daysInMonth(y, m))));
  }
  return out;
}

/** Moves a whole series by a number of days. */
export function shiftRecurrence(rec: Recurrence | null, days: number): Recurrence | null {
  if (!rec || !days) return rec;
  return {
    ...rec,
    until: rec.until && addDays(rec.until, days),
    except: rec.except.map((d) => addDays(d, days)),
  };
}
