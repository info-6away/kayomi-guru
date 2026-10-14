import { addDays } from '../dates';
import { eventKey, type ExternalEvent } from './types';

// Turns an event as Google's Calendar API, or Microsoft Graph, returns it into what Koyomi
// keeps. Only the fields read here are ever requested (see EVENT_FIELDS and
// MICROSOFT_EVENT_FIELDS): no description, no location, no guest list, no conference details.

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
 *
 * @param connectionId The account it was read through. It is part of the event's id here, so
 *   the same id in another account is another event.
 */
export function normalizeGoogleEvent(item: GoogleEvent, connectionId: string, calendarId: string, fetchedAt: string): ExternalEvent | null {
  if (!item.id || item.status === 'cancelled' || item.eventType === 'workingLocation') return null;
  if (item.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;

  const base = {
    id: eventKey(connectionId, calendarId, item.id),
    connectionId,
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

// ---------- Microsoft ----------

// The same, for an event as Microsoft Graph returns it. Only the fields in MICROSOFT_EVENT_FIELDS
// are asked for: no body, no location, no attendees, no online-meeting details.

/** The parts of a Microsoft Graph event resource that Koyomi asks for. */
export interface MicrosoftEvent {
  id?: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  /** free, tentative, busy, oof, workingElsewhere or unknown. */
  showAs?: string;
  /** Only the signed-in person's own reply, to drop what they declined. */
  responseStatus?: { response?: string };
  webLink?: string;
  /** singleInstance, occurrence, exception or seriesMaster. */
  type?: string;
  originalStartTimeZone?: string;
  /** A wall-clock time without an offset, in `timeZone`: UTC, because Koyomi asks for UTC. */
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}

/** The `$select` sent with every events request, so Graph returns nothing else. */
export const MICROSOFT_EVENT_FIELDS = 'id,subject,start,end,isAllDay,isCancelled,showAs,responseStatus,webLink,type,originalStartTimeZone';

/** Only a link to Outlook on the web is passed on to the browser. */
function outlookLink(link: string | undefined): string | null {
  try {
    const url = new URL(link ?? '');
    return url.protocol === 'https:' && /(^|\.)(outlook\.live\.com|outlook\.office365\.com|outlook\.office\.com|outlook\.cloud\.microsoft)$/.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;
const isUtc = (zone: string | undefined) => !zone || /^(utc|etc\/utc|etc\/gmt|z|tzone:\/\/microsoft\/utc)$/i.test(zone.trim());
const pad = (n: number) => String(n).padStart(2, '0');
const dayOfInstant = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** How far ahead of UTC a zone's clocks are at an instant, in milliseconds. Null for a name this runtime does not know. */
function offsetIn(zone: string, ms: number): number | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(ms)
        .map((part) => [part.type, part.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(ms / 1000) * 1000;
  } catch {
    return null;
  }
}

/** A wall-clock time in a zone, as an instant. NaN when either cannot be read. */
function instant(dateTime: string | undefined, zone: string | undefined): number {
  const w = WALL.exec(dateTime ?? '');
  if (!w) return NaN;
  const wall = Date.UTC(+w[1], +w[2] - 1, +w[3], +w[4], +w[5], +(w[6] ?? 0));
  if (isUtc(zone)) return wall;
  const first = offsetIn(zone!, wall);
  if (first === null) return NaN;
  const second = offsetIn(zone!, wall - first);
  return wall - (second ?? first);
}

/**
 * Zones whose midnight, given in UTC, the rule in `dayOf` would put on the wrong day, by the
 * names Windows gives them: the few more than ten hours behind UTC or fourteen ahead.
 */
const FAR_ZONES: Record<string, number> = { 'Line Islands Standard Time': 14 * 60, 'UTC-11': -11 * 60, 'Dateline Standard Time': -12 * 60 };

/**
 * The calendar day an all-day event's start or end stands for. An all-day event begins at
 * midnight in the zone it was written in, and Graph gives that midnight in the zone Koyomi asks
 * for, UTC: at the very least a day boundary, and often some hours either side of one. The zone
 * it was written in is used where this runtime knows it by name. Where it does not (Windows
 * gives zones names of its own), the nearest day boundary is the day: midnight anywhere from ten
 * hours behind UTC to almost fourteen ahead comes to no later than 10:00 UTC on that day, or
 * after 10:00 UTC on the day before.
 */
function dayOf(dateTime: string | undefined, zone: string | undefined, writtenIn: string | undefined): string | null {
  const w = WALL.exec(dateTime ?? '');
  if (!w) return null;
  const day = `${w[1]}-${w[2]}-${w[3]}`;
  const minutes = +w[4] * 60 + +w[5];
  // Midnight as given: that is the day, whatever zone it is in.
  if (minutes === 0 || !isUtc(zone)) return day;
  const ms = Date.UTC(+w[1], +w[2] - 1, +w[3], +w[4], +w[5]);
  const known = writtenIn ? offsetIn(writtenIn, ms) : null;
  if (known !== null) return dayOfInstant(ms + known);
  const far = writtenIn ? FAR_ZONES[writtenIn] : undefined;
  if (far !== undefined) return dayOfInstant(ms + far * 60_000);
  return minutes > 600 ? addDays(day, 1) : day;
}

/**
 * Returns the event to keep, or `null` when it should not be on the calendar: cancelled,
 * declined by this person, the series itself rather than one of its occurrences, or unreadable.
 *
 * @param connectionId The account it was read through. It is part of the event's id here, so
 *   the same id in another account is another event.
 */
export function normalizeMicrosoftEvent(item: MicrosoftEvent, connectionId: string, calendarId: string, fetchedAt: string): ExternalEvent | null {
  if (!item.id || item.isCancelled || item.type === 'seriesMaster') return null;
  const reply = item.responseStatus?.response;
  if (reply === 'declined') return null;

  const base = {
    id: eventKey(connectionId, calendarId, item.id),
    connectionId,
    provider: 'microsoft' as const,
    providerEventId: item.id,
    calendarId,
    title: item.subject?.trim() || '(No title)',
    status: reply === 'tentativelyAccepted' || item.showAs === 'tentative' ? ('tentative' as const) : ('confirmed' as const),
    link: outlookLink(item.webLink),
    // Graph will not send when an event last changed together with a chosen set of fields.
    updatedAt: fetchedAt,
    fetchedAt,
    timeZone: item.originalStartTimeZone || null,
  };

  // All-day: a first day and the day after the last, as days, never moved through a zone again.
  if (item.isAllDay) {
    const first = dayOf(item.start?.dateTime, item.start?.timeZone, item.originalStartTimeZone);
    const after = dayOf(item.end?.dateTime, item.end?.timeZone, item.originalStartTimeZone);
    if (!first || !DAY.test(first)) return null;
    const last = after && DAY.test(after) ? addDays(after, -1) : first;
    return { ...base, start: first, end: last < first ? first : last, allDay: true };
  }

  const start = instant(item.start?.dateTime, item.start?.timeZone);
  const end = instant(item.end?.dateTime, item.end?.timeZone);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { ...base, start: new Date(start).toISOString(), end: new Date(Math.max(end, start)).toISOString(), allDay: false };
}
