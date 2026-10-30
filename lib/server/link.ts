import ICAL from 'ical.js';
import { budgetOf, occurrencesOf } from '../calendars/ical';
import { LinkError, canonicalLink, fetchLink, linkOf, type Resolve } from './fetchlink';
import { report } from './log';
import { ProviderError, type CalendarProvider } from './provider';
import { fingerprint } from './seal';

// A calendar link: a published, read-only calendar (an .ics feed) that a person subscribes to by
// its private address, from Outlook or anywhere else that publishes one. There is no account
// and no permission behind it, only the link, and the link is as good as a password: whoever has
// it can read the calendar. So it is kept like one. It is sealed as the connection's secret
// (seal.ts), with the name the person knows the calendar by, and is never sent to a browser,
// logged or put in an error. Each reading opens it, fetches the calendar (fetchlink.ts, which
// keeps the server from being sent anywhere private), works out the events in the span (ical.ts)
// and lets the rest go. Nothing of the calendar is kept on the server.

/** What is sealed for a calendar link: the link, and the name it is shown by. Only the name ever reaches a browser. */
export interface LinkSecret {
  url: string;
  name: string;
}

export interface LinkConfig {
  /** Koyomi's own host, which it never asks itself. */
  own: string;
  /** The browser tests' stand-in, the one address taken as it is. Null on every deployment. */
  test: string | null;
  /** One link is fetched no more often than this by one server. */
  paceMs: number;
  /** How names are looked up. Only the tests give another. */
  resolve?: Resolve;
}

/** A link is one calendar: this is its id. */
export const LINK_CALENDAR = 'calendar';
/** The most calendar links one person keeps. */
export const MAX_LINKS = 20;
/** The longest name a calendar is shown by. */
const NAME_LENGTH = 80;

class LinkProviderError extends ProviderError {
  constructor(kind: ConstructorParameters<typeof ProviderError>[1], retryAfter?: number) {
    super('Calendar link', kind, retryAfter);
  }
}

/** A name as it may be shown: one line of plain text, not too long. Null if nothing is left of it. */
export const nameOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const name = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_LENGTH)
    .trim();
  return name || null;
};

/** The secret as sealed, or a refusal if it is not one. */
export function linkSecretOf(opened: string): LinkSecret {
  try {
    const secret = JSON.parse(opened) as Partial<LinkSecret>;
    if (typeof secret.url === 'string' && typeof secret.name === 'string') return { url: secret.url, name: secret.name };
  } catch {
    // fall through
  }
  throw new LinkProviderError('reconnect');
}

/** The name a calendar gives itself, if any. Throws if the text is not a calendar ical.js can read. */
export function feedName(text: string): string | null {
  const root = new ICAL.Component(ICAL.parse(text));
  if (root.name !== 'vcalendar') throw new LinkError('not_calendar');
  return nameOf(root.getFirstPropertyValue('x-wr-calname'));
}

// A reading's cursor says what the calendar's server said of that version of it (its ETag, its
// Last-Modified), so that the next reading can ask whether anything has changed. It is kept on
// the device with the calendar, as every provider's cursor is, and not on the server. It carries
// a mark of the link it was taken from, made with the server's key, so that once the link is
// replaced it is not taken for the new one's.
const markOf = (tokenKey: string, url: URL) => fingerprint(canonicalLink(url), tokenKey, 'calendar link cursor').slice(0, 22);
const cursorFor = (mark: string, got: { etag: string | null; lastModified: string | null }) =>
  got.etag || got.lastModified ? `v1.${mark}.${Buffer.from(JSON.stringify({ e: got.etag, m: got.lastModified })).toString('base64url')}` : null;
function cursorOf(mark: string, cursor: string | null): { etag: string | null; lastModified: string | null } | null {
  const [version, made, data] = cursor?.split('.') ?? [];
  if (version !== 'v1' || made !== mark || !data) return null;
  try {
    const said = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as { e?: unknown; m?: unknown };
    return { etag: typeof said.e === 'string' ? said.e : null, lastModified: typeof said.m === 'string' ? said.m : null };
  } catch {
    return null;
  }
}

/** When each link was last fetched by this server. */
const fetched = () => ((globalThis as typeof globalThis & { koyomiLinkFetched?: Map<string, number> }).koyomiLinkFetched ??= new Map());
/** A link fetched only a moment ago is not fetched again: the person, or a script, is told to wait. */
function pace(connectionId: string, paceMs: number) {
  const now = Date.now();
  const last = fetched().get(connectionId) ?? 0;
  if (now - last < paceMs) throw new LinkProviderError('slow_down', Math.ceil((last + paceMs - now) / 1000));
  if (fetched().size > 10_000) fetched().clear();
  fetched().set(connectionId, now);
}

/**
 * A failure of the link, as the rest of the server takes it. A link that no longer gives a
 * calendar needs the person to update it, and is not fetched again until they do: that includes
 * one that now leads somewhere Koyomi does not fetch.
 */
function failureOf(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (!(error instanceof LinkError)) return new LinkProviderError('busy');
  if (error.failure === 'slow_down') return new LinkProviderError('slow_down', error.retryAfter ?? 60);
  if (error.failure === 'busy') return new LinkProviderError('busy');
  if (error.failure === 'forbidden' || error.failure === 'bad_link') report('link', new Error('A calendar link now leads somewhere Koyomi does not fetch; it needs updating'));
  return new LinkProviderError('reconnect');
}

/**
 * Calendar links as the routes use every provider (provider.ts). The sealed secret is the
 * "refresh token", and the "access token" is the same, opened: there is nothing to trade it for.
 *
 * @param tokenKey The key secrets are sealed with: here, for the cursor's mark.
 */
export function linkProvider(link: LinkConfig, tokenKey: string): CalendarProvider {
  return {
    atOnce: 1,
    // Held for no time at all (api.ts keeps nothing this short-lived): each reading opens it again.
    refreshAccess: async (opened) => ({ accessToken: opened, expiresIn: 0 }),
    // A published link cannot be withdrawn by anyone but the calendar's owner, where it was published.
    revoke: async () => false,
    // Listing a link reads nothing from where it leads: its one calendar is what was sealed.
    async listCalendars(access) {
      const { name } = linkSecretOf(access);
      return { account: name, calendars: [{ calendarId: LINK_CALENDAR, name, primary: true, selected: true }] };
    },
    async readCalendar(access, { connectionId, calendarId, syncToken, span, fetchedAt }, deadline) {
      if (calendarId !== LINK_CALENDAR) return { calendarId, gone: true };
      const url = linkOf(linkSecretOf(access).url, link.own, link.test);
      if (!url) throw failureOf(new LinkError('bad_link'));
      pace(connectionId, link.paceMs);
      const mark = markOf(tokenKey, url);
      let got;
      try {
        got = await fetchLink(url, { ...cursorOf(mark, syncToken), deadline, own: link.own, resolve: link.resolve, test: link.test });
      } catch (error) {
        // More than Koyomi reads: what was read of it before stays, and the person is not asked
        // for a new link, which would be no smaller.
        if (error instanceof LinkError && error.failure === 'too_large') {
          report('link', new Error('A calendar link sent more than Koyomi reads; what was read before stays'));
          return { calendarId, failed: true };
        }
        throw failureOf(error);
      }
      // Nothing has changed since the cursor's reading: nothing to add, nothing to take away.
      if (got.unchanged) return { calendarId, full: false, events: [], removed: [], syncToken };
      const budget = budgetOf();
      let events;
      try {
        events = occurrencesOf(got.text, { provider: 'link', connectionId, calendarId, fetchedAt, timeMin: span.timeMin, timeMax: span.timeMax, budget });
      } catch {
        // It began and ended as a calendar, and is not one Koyomi can read.
        throw failureOf(new LinkError('not_calendar'));
      }
      if (budget.ranOut) report('link', new Error('A calendar link took longer to work out than Koyomi allows; what was not worked out in time is left out'));
      return { calendarId, full: true, events, removed: [], syncToken: cursorFor(mark, got) };
    },
  };
}
