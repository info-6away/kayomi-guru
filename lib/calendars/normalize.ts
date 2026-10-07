import { addDays } from '../dates';
import type { ExternalEvent } from './types';

// Turns an event as Google's Calendar API returns it into what Koyomi keeps. Only the fields
// read here are ever requested from Google (see EVENT_FIELDS): no description, no location,
// no guest list, no conference details.

/** The parts of a Google event resource that Koyomi asks for. */
export interface GoogleEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  htmlLink?: string;
  updated?: string;
  eventType?: string;
  /** An all-day event has `date`; a timed one has `dateTime` with its offset, and often a zone. */
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  /** Only the signed-in person's own entry is read, to drop what they declined. */
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/** The `fields` mask sent with every events request, so Google returns nothing else. */
export const EVENT_FIELDS =
  'nextPageToken,nextSyncToken,items(id,status,summary,htmlLink,updated,eventType,start,end,attendees(self,responseStatus))';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Only a link back to Google's own calendar is passed on to the browser. */
function googleLink(link: string | undefined): string | null {
  try {
    const url = new URL(link ?? '');
    return url.protocol === 'https:' && /(^|\.)google\.com$/.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Returns the event to keep, or `null` when it should not be on the calendar: cancelled,
 * declined by this person, a "working location" marker rather than an event, or unreadable.
 */
export function normalizeGoogleEvent(item: GoogleEvent, calendarId: string, fetchedAt: string): ExternalEvent | null {
  if (!item.id || item.status === 'cancelled' || item.eventType === 'workingLocation') return null;
  if (item.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;

  const base = {
    id: `google:${calendarId}:${item.id}`,
    provider: 'google' as const,
    providerEventId: item.id,
    calendarId,
    title: item.summary?.trim() || '(No title)',
    status: item.status === 'tentative' ? ('tentative' as const) : ('confirmed' as const),
    link: googleLink(item.htmlLink),
    updatedAt: item.updated ?? fetchedAt,
    fetchedAt,
  };

  // All-day: Google gives the first day and the day after the last. These are days, not
  // instants, and are kept as written: converting them through UTC would move them a day
  // for anyone west of Greenwich.
  const startDay = item.start?.date;
  const endDay = item.end?.date;
  if (startDay) {
    if (!DAY.test(startDay)) return null;
    const last = endDay && DAY.test(endDay) ? addDays(endDay, -1) : startDay;
    return { ...base, start: startDay, end: last < startDay ? startDay : last, allDay: true, timeZone: item.start?.timeZone ?? null };
  }

  // Timed: an instant with its UTC offset. The instant is what is stored; the zone it was
  // written in is kept beside it rather than thrown away.
  const start = Date.parse(item.start?.dateTime ?? '');
  const end = Date.parse(item.end?.dateTime ?? '');
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return {
    ...base,
    start: new Date(start).toISOString(),
    end: new Date(Math.max(end, start)).toISOString(),
    allDay: false,
    timeZone: item.start?.timeZone ?? null,
  };
}
