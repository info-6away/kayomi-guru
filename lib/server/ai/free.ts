import { addDays, clockMinutes, dayStart, instantOf, localDay, weekdayOf } from './time';

// Free time, from busy time (docs/MCP.md). Everything is instants in milliseconds; days and
// working hours are taken in the zone the question was asked in.

export interface Interval {
  start: number;
  end: number;
}

/** Overlapping and touching intervals as one, in order. */
export function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const each of sorted) {
    const last = out.at(-1);
    if (last && each.start <= last.end) last.end = Math.max(last.end, each.end);
    else out.push({ ...each });
  }
  return out;
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface WorkingHours {
  /** 'HH:MM'. */
  start: string;
  /** 'HH:MM', after start; '24:00' for the end of the day. */
  end: string;
  /** Which days count. All of them when left out. */
  days?: Weekday[];
}

/** The parts of the window that fall within working hours, day by day in the zone. */
export function workingIntervals(window: Interval, zone: string, hours: WorkingHours): Interval[] {
  const from = clockMinutes(hours.start);
  const to = clockMinutes(hours.end);
  const days = hours.days ? new Set(hours.days) : null;
  const out: Interval[] = [];
  const last = localDay(window.end - 1, zone);
  for (let day = localDay(window.start, zone); day <= last; day = addDays(day, 1)) {
    if (days && !days.has(WEEKDAYS[weekdayOf(day)])) continue;
    const [y, m, d] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
    const start = instantOf(y, m, d, Math.floor(from / 60), from % 60, zone);
    const end = to === 1440 ? dayStart(addDays(day, 1), zone) : instantOf(y, m, d, Math.floor(to / 60), to % 60, zone);
    const clipped = { start: Math.max(start, window.start), end: Math.min(end, window.end) };
    if (clipped.end > clipped.start) out.push(clipped);
  }
  return out;
}

/**
 * The free stretches of at least `minimum` milliseconds: the allowed parts of the window (all of
 * it, or its working hours), less everything busy.
 */
export function freeIntervals(window: Interval, busy: Interval[], minimum: number, allowed: Interval[] = [window]): Interval[] {
  const blocked = merge(busy);
  const out: Interval[] = [];
  for (const part of merge(allowed)) {
    let cursor = Math.max(part.start, window.start);
    const end = Math.min(part.end, window.end);
    for (const b of blocked) {
      if (b.end <= cursor) continue;
      if (b.start >= end) break;
      if (b.start > cursor) out.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
      if (cursor >= end) break;
    }
    if (cursor < end) out.push({ start: cursor, end });
  }
  return out.filter((i) => i.end - i.start >= minimum);
}
