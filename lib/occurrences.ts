import { addDays, diffDays, spanOf, toInstant } from './dates';
import { occurrenceDays, shiftRecurrence } from './recurrence';
import type { CalendarEvent, PlanItem } from './types';

/** One showing of an event on one day. A series has many; a plain event has one. */
export interface Occurrence {
  /** `${event.id}@${date}` */
  key: string;
  event: CalendarEvent;
  date: string;
  start: number;
  end: number;
  /** Only an event scheduled from Plan can be done: it is done when its item is completed. */
  done: boolean;
}

export const occurrenceKey = (eventId: string, date: string) => `${eventId}@${date}`;

/** Everything on the calendar between two days, grouped by day and ordered by start. */
export function occurrencesByDay(
  events: CalendarEvent[],
  plan: PlanItem[],
  from: string,
  to: string,
): Map<string, Occurrence[]> {
  const completed = new Set(plan.filter((p) => p.status === 'completed').map((p) => p.id));
  const byDay = new Map<string, Occurrence[]>();
  for (const event of events) {
    const span = spanOf(event);
    const done = !!event.planItemId && completed.has(event.planItemId);
    for (const date of occurrenceDays(span.date, event.recurrence, from, to)) {
      const list = byDay.get(date) ?? [];
      list.push({ key: occurrenceKey(event.id, date), event, date, start: span.start, end: span.end, done });
      byDay.set(date, list);
    }
  }
  for (const list of byDay.values()) list.sort((a, b) => a.start - b.start);
  return byDay;
}

/** The day to show for an event: its next occurrence from `today`, else its last one. */
export function nearestDay(event: CalendarEvent, today: string): string {
  const first = spanOf(event).date;
  if (!event.recurrence) return first;
  const ahead = occurrenceDays(first, event.recurrence, today, addDays(today, 366));
  if (ahead.length) return ahead[0];
  const past = occurrenceDays(first, event.recurrence, first, today);
  return past[past.length - 1] ?? first;
}

/** New start, end and recurrence for an event after one of its occurrences is moved. */
export function moved(o: Occurrence, to: { date: string; start: number; end: number }) {
  const days = diffDays(to.date, o.date);
  const first = addDays(spanOf(o.event).date, days);
  return {
    start: toInstant(first, to.start),
    end: toInstant(first, to.end),
    recurrence: shiftRecurrence(o.event.recurrence, days),
  };
}

export interface Placed<T> {
  item: T;
  col: number;
  cols: number;
}

/**
 * Puts overlapping events side by side. `minSpan` is the shortest an event is drawn,
 * in minutes, so two short events that would touch on screen also get their own columns.
 */
export function layoutDay<T extends { start: number; end: number }>(items: T[], minSpan: number): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const placed of group) placed.cols = ends.length;
    group = [];
    ends = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd) close();
    const end = Math.max(item.end, item.start + minSpan);
    let col = ends.findIndex((e) => e <= item.start);
    if (col < 0) col = ends.length;
    ends[col] = end;
    groupEnd = Math.max(groupEnd, end);
    const placed = { item, col, cols: 1 };
    group.push(placed);
    out.push(placed);
  }
  close();
  return out;
}
