import type { CalendarInfo, CalendarResult } from '../calendars/types';

// What the rest of the server needs from a provider Koyomi reads calendars from. Each provider
// (google.ts, microsoft.ts) speaks its own protocol to its own addresses; everything that is the
// same for all of them (who is asking, which of their connections, how much may be asked, what
// the browser is told) lives once, in api.ts and the routes, and is not written again per provider.

/**
 * Why a provider did not give an answer.
 * - `reconnect`: the permission is gone (revoked, expired, or too narrow). Only the person can fix it.
 * - `gone`: the "what changed since" cursor is no longer valid. Fetch everything again.
 * - `not_found`: that calendar is not there for this account any more.
 * - `blocked`: the provider will not let this account's calendar be read at all, and asking the
 *   person to consent again would not change that (for Microsoft: an account with no mailbox in
 *   the cloud).
 * - `expired`: the short-lived access token was refused. A new one is asked for next time; the
 *   permission itself may be fine.
 * - `slow_down`: the provider asked for a pause, of `retryAfter` seconds.
 * - `busy`: unreachable, slow or failing. Nothing is wrong; try later.
 */
export type ProviderErrorKind = 'reconnect' | 'gone' | 'not_found' | 'blocked' | 'expired' | 'slow_down' | 'busy';

/** Carries only the kind: whatever the provider said stays where it was said, and is never passed on or logged. */
export class ProviderError extends Error {
  constructor(
    who: string,
    public readonly kind: ProviderErrorKind,
    public readonly retryAfter?: number,
  ) {
    super(`${who}: ${kind}`);
  }
}

/** A short-lived access token, and the refresh token that replaces the stored one where the provider issues a new one on every use. */
export interface Access {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

/** One provider, as the routes and api.ts use it. */
export interface CalendarProvider {
  /** How many of one account's calendars may be read at the same moment. */
  atOnce: number;
  refreshAccess(refreshToken: string): Promise<Access>;
  /** Withdraws the permission at the provider. False where that did not happen, or the provider offers no way to. */
  revoke(refreshToken: string): Promise<boolean>;
  /** The calendars the account can see, and its address, read with them and kept nowhere on the server. */
  listCalendars(accessToken: string, deadline: AbortSignal): Promise<{ account: string | null; calendars: CalendarInfo[] }>;
  /** One calendar's events in the span: everything, or only what changed since `syncToken` where the provider has cursors. */
  readCalendar(
    accessToken: string,
    asked: { connectionId: string; calendarId: string; syncToken: string | null; span: { timeMin: string; timeMax: string }; fetchedAt: string },
    deadline: AbortSignal,
  ): Promise<CalendarResult>;
}
