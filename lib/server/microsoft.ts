import { MICROSOFT_EVENT_FIELDS, normalizeMicrosoftEvent, type MicrosoftEvent } from '../calendars/normalize';
import type { CalendarInfo, CalendarResult, ExternalEvent } from '../calendars/types';
import { report } from './log';
import { ProviderError, type ProviderErrorKind } from './provider';

// Everything Koyomi says to Microsoft, and nothing more: the sign-in and consent screen, the
// token exchange, and two read-only calls to Microsoft Graph (v1.0). Plain fetch, so there is no
// SDK between this file and the wire.
//
// Every address used here comes from this file. Nothing a browser sends is ever treated as an
// address: a calendar's id is put into the path percent-encoded, so it can name a calendar and
// nothing else. The one address that comes from elsewhere is the next page of an answer, which
// Microsoft Graph gives; it is followed only if it is on Graph's own origin and path.

/**
 * The whole permission Koyomi asks for. `Calendars.ReadBasic` reads the person's calendars and
 * their events, except bodies, attachments and extensions, and can change nothing. `openid`
 * gives the one identifier that tells one Microsoft account from another (`accountOf`), and
 * `offline_access` a refresh token, so the calendar can be read again later without asking
 * again. No profile, no email address, no `User.Read`, nothing shared by other people.
 */
export const MICROSOFT_SCOPES = ['openid', 'offline_access', 'https://graph.microsoft.com/Calendars.ReadBasic'];

export interface MicrosoftEndpoints {
  authorize: string;
  token: string;
  graph: string;
  /** Who issues ID tokens for a tenant, with `{tid}` standing for the tenant's id. */
  issuer: string;
}

/** Microsoft's own addresses, or a stand-in server's when `base` is given (the browser tests). */
export const microsoftEndpoints = (base?: string): MicrosoftEndpoints =>
  base
    ? { authorize: `${base}/common/oauth2/v2.0/authorize`, token: `${base}/common/oauth2/v2.0/token`, graph: `${base}/graph/v1.0`, issuer: `${base}/{tid}/v2.0` }
    : {
        // `common`: personal Microsoft accounts and work or school accounts alike.
        authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        graph: 'https://graph.microsoft.com/v1.0',
        issuer: 'https://login.microsoftonline.com/{tid}/v2.0',
      };

export interface MicrosoftClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  endpoints: MicrosoftEndpoints;
}

export class MicrosoftError extends ProviderError {
  constructor(kind: ProviderErrorKind, retryAfter?: number) {
    super('Microsoft', kind, retryAfter);
  }
}

/** No single request to Microsoft is waited on for longer than this. */
export const REQUEST_TIMEOUT_MS = 15_000;
/** A calendar list longer than this is cut short. Graph sends ten a page. */
export const MAX_CALENDAR_PAGES = 10;
/** One reading of one calendar stops here: 500 events a page, so 10,000 events. */
export const MAX_EVENT_PAGES = 20;
const EVENT_PAGE = 500;
/** Microsoft lets an app have four requests open at once on one mailbox. Koyomi keeps one in hand. */
export const MICROSOFT_AT_ONCE = 3;
/** The longest pause Microsoft can ask for that is honoured as asked. */
const LONGEST_PAUSE = 3600;

const limit = (deadline?: AbortSignal) => (deadline ? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), deadline]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS));

/**
 * Microsoft's sign-in and consent screen. The account chooser comes first, every time: a person
 * may be adding a second account, and must be the one to say which, rather than Microsoft
 * quietly taking the one already signed in. Consent is asked whenever Microsoft does not already
 * hold it for that account.
 */
export function authorizeUrl(m: MicrosoftClient, state: string, challenge: string, nonce: string): string {
  const url = new URL(m.endpoints.authorize);
  url.search = new URLSearchParams({
    client_id: m.clientId,
    response_type: 'code',
    redirect_uri: m.redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.href;
}

/** Answers that mean the permission is gone and only the person, signing in again, can give it back. */
const ASK_AGAIN = ['invalid_grant', 'interaction_required', 'consent_required', 'login_required'];
/** The answer that means Microsoft does not accept Koyomi's own client secret. The operator's to mend. */
const OPERATOR = 'invalid_client';
/**
 * The answer that means this account's organisation does not let Koyomi in (an administrator
 * disabled it, or never let it into the tenant). Neither the person nor the operator mends it
 * by signing in again.
 */
const REFUSED_HERE = 'unauthorized_client';

async function token(m: MicrosoftClient, params: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(m.endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: m.clientId, client_secret: m.clientSecret, scope: MICROSOFT_SCOPES.join(' '), ...params }),
      cache: 'no-store',
      signal: limit(),
    });
  } catch {
    throw new MicrosoftError('busy');
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return body;
  // Whatever else Microsoft said stays here: it is not passed on, and only its codes are logged.
  const error = String(body.error ?? '');
  refused('the token endpoint', response.status, [code(error), /AADSTS\d+/.exec(String(body.error_description ?? ''))?.[0] ?? '']);
  if (ASK_AGAIN.includes(error)) throw new MicrosoftError('reconnect');
  if (error === REFUSED_HERE) throw new MicrosoftError('blocked');
  // A client secret lasts two years at most. When it runs out, every connection looks broken,
  // and none of them is: the log says what to renew.
  if (error === OPERATOR) report('microsoft', new Error('Microsoft refused Koyomi’s client id or secret: a client secret expires, and is renewed in the app registration'));
  throw new MicrosoftError('busy');
}

/** One of Microsoft's error codes, or nothing: anything that is not shaped like a code is not logged. */
const code = (value: unknown) => (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(value) ? value : '');

/**
 * Says in the log that Microsoft refused, with its status and its codes and nothing else: no
 * token, no address, no id, nothing about a calendar or an event. Without it a refusal is only
 * an account that shows nothing, and nobody can tell why.
 */
function refused(what: string, status: number, codes: string[]) {
  report('microsoft', new Error(`${what} answered ${status}${codes.filter(Boolean).map((c) => ` ${c}`).join('')}`));
}

/**
 * Microsoft's short reason for refusing a token, from the header it sends with a 401, as plain
 * words only: anything shaped like an address is dropped, and so is any word with a digit in it
 * or longer than twenty letters, which could be an id or part of a token.
 */
export function reasonIn(header: string | null): string {
  const said = /error_description="([^"]*)"/.exec(header ?? '')?.[1] ?? '';
  const words = said
    .replace(/\S+@\S+/g, ' ')
    .split(/\s+/)
    .filter((word) => /^[A-Za-z.,:;'()-]{1,20}$/.test(word));
  return words.length ? `(${words.join(' ').slice(0, 160)})` : '';
}

/**
 * Trades the code from the consent screen for tokens. Runs on the server only. Microsoft honours
 * it only for this client, this redirect address, and the secret whose hash it was shown.
 */
export async function exchangeCode(m: MicrosoftClient, code: string, verifier: string) {
  const body = await token(m, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: m.redirectUri });
  return {
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    accessToken: String(body.access_token ?? ''),
    expiresIn: Number(body.expires_in) || 3600,
    scope: String(body.scope ?? ''),
    idToken: typeof body.id_token === 'string' ? body.id_token : null,
  };
}

/**
 * A short-lived access token from the stored refresh token. Microsoft hands out a new refresh
 * token every time it is used, and the caller keeps it in place of the old one.
 */
export async function refreshAccess(m: MicrosoftClient, refreshToken: string) {
  const body = await token(m, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (typeof body.access_token !== 'string') throw new MicrosoftError('busy');
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 3600, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined };
}

/** The names of what Microsoft granted, as a log may hold them: permission names alone. */
export const grantedNames = (scope: string) =>
  scope
    .split(/\s+/)
    .map((granted) => granted.split('/').pop() ?? '')
    .filter((name) => /^[A-Za-z][A-Za-z._]{0,63}$/.test(name))
    .join(' ');

/** Whether what Microsoft granted includes reading calendars. It may list more that was granted before; only this one matters. */
export const grantsCalendars = (scope: string) => scope.split(/\s+/).some((granted) => granted.toLowerCase().split('/').pop() === 'calendars.readbasic');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How far apart Koyomi's clock and Microsoft's may be. */
const SKEW_MS = 5 * 60_000;

/**
 * Which Microsoft account a consent was for: the tenant and the subject in the ID token that
 * came with it. The subject is Microsoft's identifier for this person in this app alone (it is
 * different in every other app, so it cannot be used to follow them about), and it never
 * changes or passes to anyone else. An address can do both, so it is not used for this.
 *
 * The token comes straight from Microsoft's token endpoint, over TLS, in answer to Koyomi's own
 * client secret, which is what OpenID Connect accepts in place of checking its signature. What
 * is checked is that it was issued for Koyomi, by Microsoft for that tenant, for this attempt,
 * and not long ago.
 *
 * @returns `${tid}:${sub}`, or throws if the token is not one to trust.
 */
export function accountOf(m: MicrosoftClient, idToken: string | null, nonce: string, now = Date.now()): string {
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(String(idToken).split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    throw new MicrosoftError('busy');
  }
  // The tenant is in its own claim, and in the issuer's address too, which is checked against it.
  const tid = String(claims.tid ?? /\/([0-9a-f-]{36})\/v2\.0$/i.exec(String(claims.iss ?? ''))?.[1] ?? '');
  const sub = claims.sub;
  const fresh = typeof claims.exp === 'number' && claims.exp * 1000 > now - SKEW_MS;
  if (claims.aud !== m.clientId || !GUID.test(tid) || claims.iss !== m.endpoints.issuer.replace('{tid}', tid) || claims.nonce !== nonce || !fresh) throw new MicrosoftError('busy');
  if (typeof sub !== 'string' || !sub || sub.length > 256) throw new MicrosoftError('busy');
  return `${tid.toLowerCase()}:${sub}`;
}

/** Microsoft's word for an account whose mailbox is not in the cloud, or not there at all. Consenting again does not mend it. */
const NO_MAILBOX = ['MailboxNotEnabledForRESTAPI', 'MailboxNotSupportedForRESTAPI'];

async function graph<T>(m: MicrosoftClient, accessToken: string, url: string, deadline?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      // Times in UTC, whatever zone the person's mailbox is set to.
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', prefer: 'outlook.timezone="UTC"' },
      cache: 'no-store',
      signal: limit(deadline),
    });
  } catch {
    throw new MicrosoftError('busy');
  }
  if (response.ok) return (await response.json()) as T;
  const text = await response.text().catch(() => '');
  let body: { error?: { code?: string } } = {};
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON, or nothing at all: said in the log as such.
  }
  const challenge = response.headers.get('www-authenticate');
  refused(new URL(url).pathname.endsWith('/calendarView') ? 'Graph, asked for a calendar’s events,' : 'Graph, asked for the calendar list,', response.status, [
    code(body.error?.code),
    code(/\berror="([^"]*)"/.exec(challenge ?? '')?.[1]),
    reasonIn(challenge),
    text.trim() ? '' : '(no body)',
  ]);
  // Asked to wait: for as long as Microsoft says, and not a moment less.
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    throw new MicrosoftError('slow_down', seconds > 0 ? Math.min(Math.ceil(seconds), LONGEST_PAUSE) : 60);
  }
  if (NO_MAILBOX.includes(body.error?.code ?? '')) throw new MicrosoftError('blocked');
  // The access token, not the permission: the refresh token is what says whether that is gone.
  if (response.status === 401) throw new MicrosoftError('expired');
  // Forbidden for this account, by its organisation or its kind of mailbox. Not the person's to mend by consenting again.
  if (response.status === 403) throw new MicrosoftError('blocked');
  if (response.status === 404) throw new MicrosoftError('not_found');
  throw new MicrosoftError('busy');
}

/** The next page of an answer, only if Graph's own. Anything else ends the reading where it is. */
function nextPage(m: MicrosoftClient, page: { '@odata.nextLink'?: unknown }): string | null {
  const next = page['@odata.nextLink'];
  if (typeof next !== 'string') return null;
  try {
    const url = new URL(next);
    const base = new URL(`${m.endpoints.graph}/`);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

interface CalendarEntry {
  id?: string;
  name?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  owner?: { name?: string; address?: string };
}

/**
 * The account's own calendars, and its address. The address is the owner of its default
 * calendar, read with the list. Calendars someone else owns (shared with this person) are left
 * out: reading them needs a wider permission than Koyomi asks for. Ones the person cannot change
 * (holidays, birthdays, subscriptions) start hidden.
 */
export async function listCalendars(m: MicrosoftClient, accessToken: string, deadline?: AbortSignal): Promise<{ account: string | null; calendars: CalendarInfo[] }> {
  const entries: CalendarEntry[] = [];
  let url: string | null = `${m.endpoints.graph}/me/calendars?$select=id,name,isDefaultCalendar,canEdit,owner`;
  for (let page = 0; url && page < MAX_CALENDAR_PAGES; page++) {
    const result: { value?: CalendarEntry[]; '@odata.nextLink'?: unknown } = await graph(m, accessToken, url, deadline);
    entries.push(...(result.value ?? []));
    url = nextPage(m, result);
  }
  const account = entries.find((entry) => entry.isDefaultCalendar)?.owner?.address?.trim() || null;
  const own = (entry: CalendarEntry) => !account || !entry.owner?.address || entry.owner.address.trim().toLowerCase() === account.toLowerCase();
  const calendars = entries
    .filter((entry) => entry.id && own(entry))
    .map((entry) => ({ calendarId: entry.id!, name: entry.name?.trim() || 'Calendar', primary: !!entry.isDefaultCalendar, selected: !!entry.isDefaultCalendar || entry.canEdit === true }));
  // The account's own calendar first, then by name: the order they are listed in Koyomi.
  return { account, calendars: calendars.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name)) };
}

/**
 * The events of one calendar between `timeMin` and `timeMax`, with repeating events already
 * expanded into their occurrences by Microsoft, so Koyomi has no second set of recurrence rules
 * to get wrong. Graph has no "what changed since" for a calendar other than the default one
 * that can be limited to these fields, so each reading is a whole one. Only the fields Koyomi
 * shows are asked for.
 */
export async function listEvents(m: MicrosoftClient, accessToken: string, calendarId: string, span: { timeMin: string; timeMax: string }, deadline?: AbortSignal): Promise<MicrosoftEvent[]> {
  const items: MicrosoftEvent[] = [];
  const query = `startDateTime=${encodeURIComponent(span.timeMin)}&endDateTime=${encodeURIComponent(span.timeMax)}&$select=${MICROSOFT_EVENT_FIELDS}&$top=${EVENT_PAGE}`;
  let url: string | null = `${m.endpoints.graph}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${query}`;
  for (let page = 0; url && page < MAX_EVENT_PAGES; page++) {
    const result: { value?: MicrosoftEvent[]; '@odata.nextLink'?: unknown } = await graph(m, accessToken, url, deadline);
    items.push(...(result.value ?? []));
    url = nextPage(m, result);
  }
  return items;
}

/** One calendar, read whole and reduced to what Koyomi shows. What goes wrong with it is its own. */
export async function readCalendar(
  m: MicrosoftClient,
  accessToken: string,
  asked: { connectionId: string; calendarId: string; span: { timeMin: string; timeMax: string }; fetchedAt: string },
  deadline?: AbortSignal,
): Promise<CalendarResult> {
  try {
    const items = await listEvents(m, accessToken, asked.calendarId, asked.span, deadline);
    const events = items.map((item) => normalizeMicrosoftEvent(item, asked.connectionId, asked.calendarId, asked.fetchedAt)).filter((event): event is ExternalEvent => event !== null);
    return { calendarId: asked.calendarId, full: true, events, removed: [], syncToken: null };
  } catch (error) {
    if (error instanceof MicrosoftError && error.kind === 'not_found') return { calendarId: asked.calendarId, gone: true };
    // This one calendar may not be read. The account's other calendars are read all the same.
    if (error instanceof MicrosoftError && error.kind === 'blocked') return { calendarId: asked.calendarId, failed: true };
    throw error;
  }
}
