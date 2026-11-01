import { budgetOf, occurrencesOf } from '../calendars/ical';
import type { CalendarInfo, CalendarResult, ExternalEvent } from '../calendars/types';
import { CALDAV, DAV, DavError, child, children, dav, hrefIn, onOrigin, responses, textOf, type DavRequest } from './caldav';
import { report } from './log';
import { ProviderError, type ProviderErrorKind } from './provider';

// Everything Koyomi says to Yahoo Calendar, and nothing more: CalDAV, as Yahoo documents it, at
// caldav.calendar.yahoo.com, with the person's Yahoo email and an app password they created for
// Koyomi at Yahoo. Read-only, by the client it goes through (caldav.ts): it can only ask what
// is there and what is in a span. No mail, no contacts, nothing else of the account.
//
// Every address is on that one origin. The calendars an account has are what Yahoo's own
// answers say, and a calendar a browser names is read only if it lies in that account's own
// calendar home, found when it was connected.

/** Yahoo's CalDAV server, the one address Koyomi asks. */
export const YAHOO_ORIGIN = 'https://caldav.calendar.yahoo.com';

export interface YahooClient {
  /** Yahoo's origin, or a stand-in's in the browser tests. */
  origin: string;
}

/** Yahoo's own address, or a stand-in server's when `base` is given (the browser tests). */
export const yahooClient = (base?: string): YahooClient => ({ origin: base ? new URL(base).origin : YAHOO_ORIGIN });

/**
 * What Koyomi keeps of a Yahoo connection, sealed (seal.ts) as the connection's secret: the
 * email and app password, which Yahoo needs with every request, and the two addresses found
 * when it was connected. None of it is ever sent to a browser.
 */
export interface YahooCredential {
  email: string;
  password: string;
  principal: string;
  home: string;
}

export class YahooError extends ProviderError {
  constructor(kind: ProviderErrorKind, retryAfter?: number) {
    super('Yahoo', kind, retryAfter);
  }
}

/** Yahoo is asked about at most two of an account's calendars at once. */
export const YAHOO_AT_ONCE = 2;
/**
 * How far before the span repeating events are looked for. Yahoo's server matches a repeating
 * event to a span only by its first occurrence, so a series that began before the span would be
 * missed; this much earlier is asked for, and only repeating events are taken from it.
 */
export const LOOK_BACK_DAYS = 5 * 366;
/** A wrong password is told apart from a moment's refusal by asking once more, after this long. */
const AGAIN_MS = 600;

const basic = (c: Pick<YahooCredential, 'email' | 'password'>) => `Basic ${Buffer.from(`${c.email}:${c.password}`, 'utf8').toString('base64')}`;

/** The credential as it was sealed, or a refusal if it is not one. */
export function credentialOf(sealed: string): YahooCredential {
  try {
    const c = JSON.parse(sealed) as Partial<YahooCredential>;
    if (typeof c.email === 'string' && typeof c.password === 'string' && typeof c.principal === 'string' && typeof c.home === 'string') return c as YahooCredential;
  } catch {
    // fall through
  }
  throw new YahooError('reconnect');
}

/** An email Yahoo can take as a CalDAV user name: one address, nothing that would split the header. */
export const isYahooEmail = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && /^[^\s@:/\\]+@[^\s@:/\\]+\.[^\s@:/\\]+$/.test(value);
/** An app password as Yahoo makes them: letters, which it may show in groups. Spaces are not part of it. */
export const appPasswordOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const bare = value.replace(/\s+/g, '');
  return bare.length >= 8 && bare.length <= 64 && /^[\x21-\x7e]+$/.test(bare) ? bare : null;
};

/** What each of Yahoo's answers comes to. */
function kindOf(error: unknown): YahooError {
  if (error instanceof YahooError) return error;
  if (error instanceof DavError) {
    if (error.status === 401) return new YahooError('reconnect');
    if (error.status === 403) return new YahooError('blocked');
    if (error.status === 404) return new YahooError('not_found');
    if (error.status === 429) return new YahooError('slow_down', error.retryAfter ?? 60);
    if (error.status === 'redirect') report('yahoo', new Error('Yahoo sent Koyomi to an address outside its own server; it was not followed'));
  }
  return new YahooError('busy');
}

/** An answer that came, but cannot be read: said of the one calendar it was for, not the account. */
const unreadable = (error: unknown) => error instanceof DavError && (error.status === 'malformed' || error.status === 'too_large');

/**
 * One request to Yahoo. A refused password is asked once more after a moment before it is taken
 * as refused, so that one bad moment at Yahoo does not ask the person for a new app password.
 * An answer that cannot be read is passed on as it is, for the caller to place.
 */
async function ask(y: YahooClient, c: Pick<YahooCredential, 'email' | 'password'>, request: Omit<DavRequest, 'origin' | 'authorization'>, twice = true): Promise<Document> {
  const once = () => dav({ ...request, origin: y.origin, authorization: basic(c) });
  try {
    return await once();
  } catch (error) {
    if (unreadable(error)) throw error;
    if (!(twice && error instanceof DavError && error.status === 401)) throw kindOf(error);
  }
  await new Promise((resolve) => setTimeout(resolve, AGAIN_MS));
  try {
    return await once();
  } catch (again) {
    throw unreadable(again) ? again : kindOf(again);
  }
}

/** A path on Yahoo's server, as it names one in an answer, or null if it names anywhere else. */
const pathOf = (y: YahooClient, href: string) => onOrigin(y.origin, href)?.pathname ?? null;
/** One name in a path, decoded, or null if it is not encoded as a name can be. */
const decoded = (raw: string) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
};
/**
 * Whether a path is a calendar in this account's own calendar home, and nothing outside it. Each
 * name below the home is read as a server might read it, encoded or not, and none may hold a
 * separator or be a step up or across: no `..%2f`, no `..;`, no `%2e%2e`.
 */
const inHome = (y: YahooClient, c: YahooCredential, path: string) => {
  const url = onOrigin(y.origin, path);
  if (!url || url.pathname !== path || url.search || !path.startsWith(c.home)) return false;
  const rest = path.slice(c.home.length).replace(/\/$/, '');
  return (
    rest !== '' &&
    rest.split('/').every((raw) => {
      const name = decoded(raw);
      return !!name && name !== '.' && name !== '..' && !/[/\\;%]/.test(name) && ![...name].some((ch) => ch < ' ');
    })
  );
};

const PRINCIPAL = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const HOME = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
const LIST =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>';

/**
 * Finds the account: who the email and app password sign in as (its principal), and where its
 * calendars are (its calendar home). Standard CalDAV discovery, from Yahoo's documented server:
 * the well-known address first, which Yahoo answers by sending Koyomi to its principals on the
 * same server, then the principal's calendar home.
 *
 * At connecting time a refusal is taken at once: asking twice with a wrong password is no help.
 */
export async function discover(y: YahooClient, c: Pick<YahooCredential, 'email' | 'password'>, deadline?: AbortSignal): Promise<{ principal: string; home: string }> {
  try {
    let found: Document;
    try {
      found = await ask(y, c, { method: 'PROPFIND', path: '/.well-known/caldav', depth: '0', body: PRINCIPAL, deadline }, false);
    } catch (error) {
      if (!(error instanceof YahooError && error.kind === 'not_found')) throw error;
      found = await ask(y, c, { method: 'PROPFIND', path: '/', depth: '0', body: PRINCIPAL, deadline }, false);
    }
    const principal = pathOf(y, responses(found).map((r) => hrefIn(r.prop, DAV, 'current-user-principal')).find(Boolean) ?? '');
    if (!principal) throw new YahooError('blocked');
    const homes = await ask(y, c, { method: 'PROPFIND', path: principal, depth: '0', body: HOME, deadline }, false);
    const home = pathOf(y, responses(homes).map((r) => hrefIn(r.prop, CALDAV, 'calendar-home-set')).find(Boolean) ?? '');
    if (!home) throw new YahooError('blocked');
    return { principal, home: home.endsWith('/') ? home : `${home}/` };
  } catch (error) {
    throw kindOf(error);
  }
}

/**
 * The account's calendars: the collections in its calendar home that hold events. Lists of
 * tasks are left out. One the person may not change (birthdays, holidays, a subscription)
 * starts hidden. Nothing else of a calendar is asked for: no colour, no description.
 */
export async function listCalendars(y: YahooClient, c: YahooCredential, deadline?: AbortSignal): Promise<{ account: string | null; calendars: CalendarInfo[] }> {
  let found;
  try {
    found = responses(await ask(y, c, { method: 'PROPFIND', path: c.home, depth: '1', body: LIST, deadline }));
  } catch (error) {
    throw kindOf(error);
  }
  const calendars: CalendarInfo[] = [];
  for (const { href, prop } of found) {
    const path = pathOf(y, href);
    if (!path || !prop || !inHome(y, c, path)) continue;
    if (!child(child(prop, DAV, 'resourcetype'), CALDAV, 'calendar')) continue;
    const components = children(child(prop, CALDAV, 'supported-calendar-component-set'), CALDAV, 'comp').map((comp) => (comp.getAttribute('name') ?? '').toUpperCase());
    if (components.length && !components.includes('VEVENT')) continue;
    const privileges = child(prop, DAV, 'current-user-privilege-set');
    const granted = children(privileges, DAV, 'privilege').flatMap((p) => Array.from(p.childNodes).filter((n) => n.nodeType === 1).map((n) => (n as Element).localName));
    const canChange = !privileges || granted.some((name) => ['write', 'write-content', 'all'].includes(name));
    const fallback = decoded(path.replace(/\/+$/, '').split('/').pop() ?? '') || 'Calendar';
    calendars.push({ calendarId: path, name: textOf(child(prop, DAV, 'displayname')) || fallback, primary: false, selected: canChange });
  }
  return { account: c.email, calendars: calendars.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** A span's end as CalDAV writes it: UTC, to the second, no punctuation. */
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, '');

/**
 * The part of each event Koyomi reads, asked for by name (RFC 4791, section 9.6). A server that
 * sends whole events anyway is answered the same way: the rest is dropped as it is read.
 */
const FIELDS = ['UID', 'SUMMARY', 'DTSTART', 'DTEND', 'DURATION', 'RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID', 'STATUS', 'LAST-MODIFIED'];
const DATA_PARTS = `<c:calendar-data><c:comp name="VCALENDAR"><c:prop name="VERSION"/><c:comp name="VEVENT">${FIELDS.map((name) => `<c:prop name="${name}"/>`).join('')}</c:comp><c:comp name="VTIMEZONE"/></c:comp></c:calendar-data>`;

const query = (start: string, end: string, repeatingOnly: boolean, parts: boolean) =>
  '<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
  `<d:prop><d:getetag/>${parts ? DATA_PARTS : '<c:calendar-data/>'}</d:prop>` +
  `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(start)}" end="${stamp(end)}"/>` +
  `${repeatingOnly ? '<c:prop-filter name="RRULE"/>' : ''}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;

/** The calendar objects in a span: their addresses and their iCalendar text. */
async function objects(y: YahooClient, c: YahooCredential, calendar: string, start: string, end: string, repeatingOnly: boolean, deadline?: AbortSignal) {
  const read = async (parts: boolean) => {
    const doc = await ask(y, c, { method: 'REPORT', path: calendar, depth: '1', body: query(start, end, repeatingOnly, parts), deadline });
    return responses(doc).map(({ href, prop }) => ({ href, text: textOf(child(prop, CALDAV, 'calendar-data')) }));
  };
  const found = await read(true);
  // A server that took the request for parts as a request for nothing: everything, then, and
  // what is not needed is dropped as it is read.
  return found.length && found.every((item) => !item.text) ? read(false) : found;
}

/**
 * One calendar's events in the span, each occurrence of a repeating event as an event of its
 * own. Always a whole reading: Yahoo keeps no "what changed since". A calendar outside the
 * account's own calendar home is never asked about.
 */
export async function readCalendar(
  y: YahooClient,
  c: YahooCredential,
  asked: { connectionId: string; calendarId: string; span: { timeMin: string; timeMax: string }; fetchedAt: string },
  deadline?: AbortSignal,
): Promise<CalendarResult> {
  const { calendarId, span } = asked;
  if (!inHome(y, c, calendarId)) return { calendarId, gone: true };
  const earlier = new Date(Date.parse(span.timeMin) - LOOK_BACK_DAYS * 864e5).toISOString();
  try {
    const inSpan = await objects(y, c, calendarId, span.timeMin, span.timeMax, false, deadline);
    // Repeating events that began before the span. If the server will not filter on RRULE, the
    // same look back without it: whatever does not repeat is dropped as it is read. If the look
    // back cannot be had at all (too much of it, or not allowed), the span is read without it.
    const before = await objects(y, c, calendarId, earlier, span.timeMin, true, deadline)
      .catch((error) => {
        if (error instanceof YahooError && error.kind === 'busy') return objects(y, c, calendarId, earlier, span.timeMin, false, deadline);
        throw error;
      })
      .catch((error) => {
        if (!(unreadable(error) || (error instanceof YahooError && error.kind === 'blocked'))) throw error;
        report('yahoo', new Error('A Yahoo calendar could not be looked back on for its repeating events; its span was read without them'));
        return [];
      });
    const events = new Map<string, ExternalEvent>();
    const budget = budgetOf();
    const reading = { provider: 'yahoo' as const, connectionId: asked.connectionId, calendarId, fetchedAt: asked.fetchedAt, timeMin: span.timeMin, timeMax: span.timeMax, budget };
    let breath = performance.now();
    for (const [list, repeatingOnly] of [
      [inSpan, false],
      [before, true],
    ] as const) {
      for (const item of list) {
        if (budget.left <= 0) budget.ranOut = true;
        if (budget.ranOut) break;
        if (!item.text) continue;
        try {
          for (const event of occurrencesOf(item.text, { ...reading, repeatingOnly })) events.set(event.id, event);
        } catch {
          // One object that is not iCalendar is left out; the calendar's others are read.
        }
        // Working out a large calendar does not hold up everyone else this server is answering.
        if (performance.now() - breath > 20) {
          await new Promise((resolve) => setImmediate(resolve));
          breath = performance.now();
        }
      }
    }
    if (budget.ranOut) report('yahoo', new Error('A Yahoo calendar took longer to work out than Koyomi allows; what was not worked out in time is left out'));
    return { calendarId, full: true, events: [...events.values()], removed: [], syncToken: null };
  } catch (error) {
    // This one calendar could not be read: an answer that was not to be trusted.
    if (unreadable(error)) return { calendarId, failed: true };
    const kind = kindOf(error);
    if (kind.kind === 'not_found') return { calendarId, gone: true };
    // Or forbidden, for this one.
    if (kind.kind === 'blocked') return { calendarId, failed: true };
    throw kind;
  }
}
