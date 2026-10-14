// Calendars connected from outside Koyomi. They are context: read, shown, never edited.
// A Koyomi event (lib/types.ts) and an external event are different records and never merge.
//
// A person can connect several accounts, and two accounts can hold calendars and events with
// the very same ids at their provider. So everything here is named by its connection first, and
// nothing read from one account can stand in the place of something read from another.

export type Provider = 'google' | 'microsoft';
/** Every provider Koyomi can read from, in the order they are offered and listed. */
export const PROVIDERS: readonly Provider[] = ['google', 'microsoft'];

/** A calendar among everything connected on this device: `${connectionId}:${calendarId}`. */
export const calendarKey = (connectionId: string, calendarId: string) => `${connectionId}:${calendarId}`;
/** An event among everything connected on this device: `${connectionId}:${calendarId}:${providerEventId}`. */
export const eventKey = (connectionId: string, calendarId: string, providerEventId: string) => `${connectionId}:${calendarId}:${providerEventId}`;

/** One event as its provider reported it, reduced to what Koyomi shows. */
export interface ExternalEvent {
  /** `eventKey` of the three below. */
  id: string;
  /** The account it was read through. */
  connectionId: string;
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

/** A calendar an account can see, as the server lists it. */
export interface CalendarInfo {
  calendarId: string;
  name: string;
  primary: boolean;
  /** Whether it is ticked in the provider's own app: the starting point for what Koyomi shows. */
  selected: boolean;
}

/** A calendar as this device remembers it. */
export interface ExternalCalendar extends CalendarInfo {
  /** `calendarKey` of its connection and its id at the provider. */
  id: string;
  connectionId: string;
  provider: Provider;
  visible: boolean;
  /** The provider's cursor for "what changed since", and the days it was taken for. */
  syncToken: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  fetchedAt: string | null;
}

/** An account connected at a provider, as this device remembers it. */
export interface ExternalConnection {
  /** The server's name for the connection: a random word, the same on every device. */
  id: string;
  provider: Provider;
  /** How the person knows the account: its address at the provider. Null until that has been read. */
  account: string | null;
  /**
   * - `reconnect`: the provider no longer honours the permission. What was read before stays.
   * - `blocked`: the provider will not let this account's calendar be read at all, and
   *   consenting again would not change that.
   */
  status: 'connected' | 'reconnect' | 'blocked';
}

/** One connected account as the server lists it, with the calendars it can see. */
export interface ConnectionListing {
  connectionId: string;
  provider: Provider;
  /** The account's address at the provider, read with its calendars and kept nowhere on the server. */
  account: string | null;
  /**
   * - `ok`: its calendars follow.
   * - `reconnect`: the provider no longer honours the permission for this account.
   * - `busy`: it could not be read just now (the provider is failing, or was asked too often).
   * - `blocked`: the provider will not let it be read at all (for Microsoft: no mailbox in the cloud).
   *
   * Each account answers for itself: one that cannot be read says so, and the rest are listed.
   */
  state: 'ok' | 'reconnect' | 'busy' | 'blocked';
  calendars: CalendarInfo[];
}

export interface CalendarsResponse {
  connections: ConnectionListing[];
}

/** What the browser asks the server for: one account, a span of time, and each calendar's cursor if it has one. */
export interface EventsRequest {
  connectionId: string;
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
  | { calendarId: string; gone: true }
  /** This one calendar could not be read. What was read of it before stays as it was. */
  | { calendarId: string; failed: true };

export interface EventsResponse {
  calendars: CalendarResult[];
}

/**
 * Why a request to the server did not produce data.
 * - `signed_out`: no Koyomi session on this device. Says nothing about the connections, which are kept on the server.
 * - `not_connected`: signed in, but the account asked about is not one of this person's connections.
 * - `reconnect`: the provider no longer honours the stored permission for that account.
 * - `busy`: the provider is unavailable or limiting requests; try later.
 * - `slow_down`: this account has been asked about too often, here or by the provider; try later.
 * - `blocked`: the provider will not let that account's calendar be read at all.
 * - `unavailable`: calendar connections are not set up on this server.
 */
export type ApiError = 'signed_out' | 'not_connected' | 'reconnect' | 'busy' | 'slow_down' | 'blocked' | 'unavailable' | 'bad_request';
