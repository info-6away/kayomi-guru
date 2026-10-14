import { normalizeGoogleEvent } from '../calendars/normalize';
import type { ExternalEvent, Provider } from '../calendars/types';
import type { ConnectionsConfig } from './env';
import * as google from './google';
import * as microsoft from './microsoft';
import type { CalendarProvider } from './provider';

// Each provider as the routes use it: the same few things asked of each, each answered in its
// own way (provider.ts). Which one a connection belongs to is read from its row, never from the
// browser.

function googleProvider(g: google.GoogleClient): CalendarProvider {
  return {
    atOnce: 5,
    refreshAccess: (refreshToken) => google.refreshAccess(g, refreshToken),
    revoke: (refreshToken) => google.revoke(g, refreshToken),
    async listCalendars(accessToken, deadline) {
      const calendars = await google.listCalendars(g, accessToken, deadline);
      // The account is named by its own calendar, which for Google is its address.
      return { account: calendars.find((calendar) => calendar.primary)?.calendarId ?? null, calendars };
    },
    async readCalendar(accessToken, { connectionId, calendarId, syncToken, span, fetchedAt }, deadline) {
      try {
        let full = !syncToken;
        const page = await google.listEvents(g, accessToken, calendarId, span, syncToken, deadline).catch((error) => {
          // Google has let the cursor lapse: start over with everything in the span.
          if (!(error instanceof google.GoogleError && error.kind === 'gone' && syncToken)) throw error;
          full = true;
          return google.listEvents(g, accessToken, calendarId, span, null, deadline);
        });
        const events: ExternalEvent[] = [];
        const removed: string[] = [];
        for (const item of page.items) {
          const event = normalizeGoogleEvent(item, connectionId, calendarId, fetchedAt);
          if (event) events.push(event);
          else if (item.id) removed.push(item.id);
        }
        return { calendarId, full, events, removed: full ? [] : removed, syncToken: page.nextSyncToken };
      } catch (error) {
        if (error instanceof google.GoogleError && error.kind === 'not_found') return { calendarId, gone: true };
        throw error;
      }
    },
  };
}

function microsoftProvider(m: microsoft.MicrosoftClient): CalendarProvider {
  return {
    atOnce: microsoft.MICROSOFT_AT_ONCE,
    refreshAccess: (refreshToken) => microsoft.refreshAccess(m, refreshToken),
    // Microsoft offers an app no way to withdraw its own permission for one person. What
    // Disconnect can do is delete the only copy of the token, which is Koyomi's.
    revoke: async () => false,
    listCalendars: (accessToken, deadline) => microsoft.listCalendars(m, accessToken, deadline),
    readCalendar: (accessToken, asked, deadline) => microsoft.readCalendar(m, accessToken, asked, deadline),
  };
}

/** The provider a connection belongs to, or null where this server is not set up for it (any more). */
export function providerFor(config: ConnectionsConfig, provider: Provider): CalendarProvider | null {
  if (provider === 'google') return config.google ? googleProvider(config.google) : null;
  if (provider === 'microsoft') return config.microsoft ? microsoftProvider(config.microsoft) : null;
  return null;
}
