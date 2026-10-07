import { DAY_MIN, addDays, dayKey, hm } from '../dates';
import type { ExternalCalendar, ExternalEvent } from './types';

// Where external events sit on this device's calendar. Koyomi's own events live within one
// day; events from elsewhere do not have to, so each is cut into one piece per day it touches.

/** One piece of an external event on one day. */
export interface Showing {
  /** `x:${event.id}@${date}`: cannot be mistaken for a Koyomi event's key. */
  key: string;
  event: ExternalEvent;
  /** The name of the calendar it came from. */
  calendar: string;
  date: string;
  /** Minutes from local midnight. An all-day piece covers the whole day. */
  start: number;
  end: number;
  /** Shown in the all-day row: an all-day event, or a timed one lasting a day or longer. */
  allDay: boolean;
}

const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** The local days and times an event occupies, whatever zone it was written in. */
function pieces(event: ExternalEvent): { date: string; start: number; end: number; allDay: boolean }[] {
  if (event.allDay) {
    const out = [];
    for (let day = event.start; day <= event.end; day = addDays(day, 1)) out.push({ date: day, start: 0, end: DAY_MIN, allDay: true });
    return out;
  }

  const s = new Date(event.start);
  const e = new Date(event.end);
  const first = dayKey(s);
  // The end is not part of the event: one that stops at midnight does not reach the next day.
  const last = dayKey(new Date(Math.max(s.getTime(), e.getTime() - 1)));

  // A day or longer: it belongs with the all-day events, as it does in the calendar it came from.
  if (e.getTime() - s.getTime() >= 24 * 3600_000) {
    const out = [];
    for (let day = first; day <= last; day = addDays(day, 1)) out.push({ date: day, start: 0, end: DAY_MIN, allDay: true });
    return out;
  }

  const start = minutes(s);
  if (first === last) {
    const end = dayKey(e) === first ? minutes(e) : DAY_MIN;
    return [{ date: first, start: Math.min(start, DAY_MIN - 15), end: Math.min(DAY_MIN, Math.max(start + 15, end)), allDay: false }];
  }
  // Past midnight: the evening of one day and the small hours of the next.
  return [
    { date: first, start: Math.min(start, DAY_MIN - 15), end: DAY_MIN, allDay: false },
    { date: last, start: 0, end: Math.max(15, minutes(e)), allDay: false },
  ];
}

/** Everything from the calendars being shown, between two days, grouped by day and ordered by start. */
export function showingsByDay(events: ExternalEvent[], calendars: ExternalCalendar[], from: string, to: string): Map<string, Showing[]> {
  const names = new Map(calendars.filter((c) => c.visible).map((c) => [c.calendarId, c.name]));
  const byDay = new Map<string, Showing[]>();
  for (const event of events) {
    const calendar = names.get(event.calendarId);
    if (calendar === undefined) continue;
    for (const piece of pieces(event)) {
      if (piece.date < from || piece.date > to) continue;
      const list = byDay.get(piece.date) ?? [];
      list.push({ key: `x:${event.id}@${piece.date}`, event, calendar, ...piece });
      byDay.set(piece.date, list);
    }
  }
  for (const list of byDay.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
  return byDay;
}

/** An event's own start and end as this device's clock reads them, e.g. "22:00 – 02:00". */
export function timeLabel(event: ExternalEvent): string {
  return `${hm(minutes(new Date(event.start)))} – ${hm(minutes(new Date(event.end)))}`;
}

/** The first and last local day an event touches. */
export function daysOf(event: ExternalEvent): { first: string; last: string } {
  const all = pieces(event);
  return { first: all[0].date, last: all[all.length - 1].date };
}
