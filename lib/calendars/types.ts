// Calendars connected from outside Koyomi. They are context: read, shown, never edited.
// A Koyomi event (lib/types.ts) and an external event are different records and never merge.

export type Provider = 'google';

/** One event as its provider reported it, reduced to what Koyomi shows. */
export interface ExternalEvent {
  /** `${provider}:${calendarId}:${providerEventId}` */
  id: string;
  provider: Provider;
  providerEventId: string;
  calendarId: string;
  title: string;
  /**
   * Timed: ISO 8601 UTC instants.
   * All-day: calendar days, 'YYYY-MM-DD', the last one included. A day is a day wherever it is
   * read, so these are never converted through a time zone.
   */
  start: string;
  end: string;
  allDay: boolean;
  /** The zone the event was written in, as the provider gave it. Display follows this device. */
  timeZone: string | null;
  status: 'confirmed' | 'tentative';
  /** Where to open the event at its provider. */
  link: string | null;
  /** When the provider last changed it. */
  updatedAt: string;
  /** When this copy was read from the provider. */
  fetchedAt: string;
}

/** A calendar the connected account can see, as the server lists it. */
export interface CalendarInfo {
  calendarId: string;
  name: string;
  primary: boolean;
  /** Whether it is ticked in the provider's own app: the starting point for what Koyomi shows. */
  selected: boolean;
}

/** A calendar as this device remembers it. */
export interface ExternalCalendar extends CalendarInfo {
  /** `${provider}:${calendarId}` */
  id: string;
  provider: Provider;
  visible: boolean;
  /** The provider's cursor for "what changed since", and the days it was taken for. */
  syncToken: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  fetchedAt: string | null;
}

/** What the browser asks the server for: a span of time, and each calendar's cursor if it has one. */
export interface EventsRequest {
  timeMin: string;
  timeMax: string;
  calendars: { calendarId: string; syncToken: string | null }[];
}

export type CalendarResult =
  | {
      calendarId: string;
      /** True when this is everything in the span; false when it is only what changed. */
      full: boolean;
      events: ExternalEvent[];
      /** Provider ids of events that no longer exist, or no longer belong on a calendar. */
      removed: string[];
      syncToken: string | null;
    }
  /** The calendar is no longer there for this account. */
  | { calendarId: string; gone: true };

export interface EventsResponse {
  calendars: CalendarResult[];
}

/**
 * Why a request to the server did not produce data.
 * - `signed_out`: no Koyomi session on this device.
 * - `not_connected`: signed in, but no calendar account is connected.
 * - `reconnect`: the provider no longer honours the stored permission.
 * - `busy`: the provider is unavailable or limiting requests; try later.
 * - `unavailable`: calendar connections are not set up on this server.
 */
export type ApiError = 'signed_out' | 'not_connected' | 'reconnect' | 'busy' | 'unavailable' | 'bad_request';
