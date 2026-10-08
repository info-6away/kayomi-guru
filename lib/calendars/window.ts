import { addDays, parts } from '../dates';
import type { ExternalCalendar, ExternalEvent } from './types';

// How much of a connected calendar is read. Not its whole history: five weeks back, so last
// month still makes sense in Month view, and twenty-seven weeks ahead, about half a year of
// planning. A meeting that repeats every working day is about 160 events in that span.

export const BACK_DAYS = 35;
export const AHEAD_DAYS = 189;
/** A reading is used until it has slipped a week: then everything is read again for today's span. */
const SLACK_DAYS = 7;

export interface Window {
  /** First and last local day, both included. */
  from: string;
  to: string;
}

export const syncWindow = (today: string): Window => ({ from: addDays(today, -BACK_DAYS), to: addDays(today, AHEAD_DAYS) });

/**
 * Whether a calendar's last full reading still reaches far enough for today. While it does,
 * only what changed since is asked for; once it does not, the span has moved on and it is
 * read in full again.
 */
export const covers = (calendar: Pick<ExternalCalendar, 'windowFrom' | 'windowTo'>, today: string) =>
  !!calendar.windowFrom &&
  !!calendar.windowTo &&
  calendar.windowFrom <= addDays(today, -BACK_DAYS + SLACK_DAYS) &&
  calendar.windowTo >= addDays(today, AHEAD_DAYS - SLACK_DAYS);

const localMidnight = (day: string) => {
  const { y, m, d } = parts(day);
  return new Date(y, m - 1, d);
};

/** The window as instants on this device's clock: from the start of its first day to the end of its last. */
export const spanOfWindow = (window: Window) => ({
  timeMin: localMidnight(window.from).toISOString(),
  timeMax: localMidnight(addDays(window.to, 1)).toISOString(),
});

/** Whether any part of an event falls inside the window. A change far outside it is not kept. */
export function within(event: ExternalEvent, window: Window): boolean {
  if (event.allDay) return event.end >= window.from && event.start <= window.to;
  const { timeMin, timeMax } = spanOfWindow(window);
  return event.end >= timeMin && event.start < timeMax;
}
