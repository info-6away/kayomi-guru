import { createHash, randomBytes } from 'node:crypto';
import { EVENT_FIELDS, type GoogleEvent } from '../calendars/normalize';
import type { CalendarInfo } from '../calendars/types';

// Everything Koyomi says to Google, and nothing more: the consent screen, the token exchange,
// and two read-only calls. Plain fetch, so there is no SDK between this file and the wire.
//
// Every address used here comes from this file. Nothing a browser sends is ever treated as an
// address: a calendar's id is put into the path percent-encoded, so it can name a calendar and
// nothing else.

/**
 * The whole permission Koyomi asks for: see which calendars exist, and read their events.
 * Both are read-only, and narrower than `calendar.readonly`, which also covers settings and
 * sharing. Nothing here can create, change or delete anything.
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];

export interface GoogleEndpoints {
  authorize: string;
  token: string;
  revoke: string;
  api: string;
}

/** Google's own addresses, or a stand-in server's when `base` is given (the browser tests). */
export const googleEndpoints = (base?: string): GoogleEndpoints =>
  base
    ? { authorize: `${base}/o/oauth2/v2/auth`, token: `${base}/token`, revoke: `${base}/revoke`, api: `${base}/calendar/v3` }
    : {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        revoke: 'https://oauth2.googleapis.com/revoke',
        api: 'https://www.googleapis.com/calendar/v3',
      };

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  endpoints: GoogleEndpoints;
}

/**
 * Why Google did not give an answer.
 * - `reconnect`: the permission is gone (revoked, expired, or too narrow). Only the person can fix it.
 * - `gone`: the "what changed since" cursor is no longer valid. Fetch everything again.
 * - `not_found`: that calendar is not there for this account any more.
 * - `busy`: Google is unreachable, slow, failing or limiting requests. Nothing is wrong; try later.
 */
export class GoogleError extends Error {
  constructor(public readonly kind: 'reconnect' | 'gone' | 'not_found' | 'busy') {
    super(`Google: ${kind}`);
  }
}

/** No single request to Google is waited on for longer than this. */
export const REQUEST_TIMEOUT_MS = 15_000;
/** A calendar list longer than this is cut short: 250 calendars a page. */
export const MAX_CALENDAR_PAGES = 2;
/** One reading of one calendar stops here: 2,500 events a page, so 10,000 events. */
export const MAX_EVENT_PAGES = 4;

/** Stops at the request's own limit, or when the whole job it is part of runs out of time. */
const limit = (deadline?: AbortSignal) => (deadline ? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), deadline]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS));

/** A one-time secret for the consent round trip, and the hash of it that Google is shown (PKCE). */
export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authorizeUrl(g: GoogleClient, state: string, challenge: string): string {
  const url = new URL(g.endpoints.authorize);
  url.search = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: g.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // A refresh token, so the calendar can be read again later without asking again...
    access_type: 'offline',
    // ...and the consent screen every time, because Google only hands one out when it is shown.
    prompt: 'consent',
  }).toString();
  return url.href;
}

async function token(g: GoogleClient, params: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(g.endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, ...params }),
      cache: 'no-store',
      signal: limit(),
    });
  } catch {
    throw new GoogleError('busy');
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return body;
  // The one answer that means "ask the person again": the grant was revoked or has expired.
  // Whatever else Google said stays here; it is not passed on or logged.
  throw new GoogleError(body.error === 'invalid_grant' ? 'reconnect' : 'busy');
}

/**
 * Trades the code from the consent screen for tokens. Runs on the server only. Google honours
 * it only for this client, this redirect address, and the secret whose hash it was shown.
 */
export async function exchangeCode(g: GoogleClient, code: string, verifier: string) {
  const body = await token(g, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: g.redirectUri });
  return {
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    accessToken: String(body.access_token ?? ''),
    scope: String(body.scope ?? ''),
  };
}

/** A short-lived access token from the stored refresh token. */
export async function refreshAccess(g: GoogleClient, refreshToken: string) {
  const body = await token(g, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (typeof body.access_token !== 'string') throw new GoogleError('busy');
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
}

/** Withdraws the permission at Google. Revoking a refresh token ends its access tokens too. */
export async function revoke(g: GoogleClient, refreshToken: string): Promise<boolean> {
  try {
    const response = await fetch(g.endpoints.revoke, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
      cache: 'no-store',
      signal: limit(),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function api<T>(g: GoogleClient, accessToken: string, path: string, query: Record<string, string>, deadline?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${g.endpoints.api}${path}?${new URLSearchParams(query)}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      cache: 'no-store',
      signal: limit(deadline),
    });
  } catch {
    throw new GoogleError('busy');
  }
  if (response.ok) return (await response.json()) as T;
  if (response.status === 401) throw new GoogleError('reconnect');
  if (response.status === 404) throw new GoogleError('not_found');
  if (response.status === 410) throw new GoogleError('gone');
  if (response.status === 403) {
    const body = (await response.json().catch(() => ({}))) as { error?: { status?: string; errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason ?? '';
    // A scope that was not granted cannot be fixed by waiting. Rate limits can.
    if (reason === 'insufficientPermissions' || body.error?.status === 'PERMISSION_DENIED') throw new GoogleError('reconnect');
  }
  throw new GoogleError('busy');
}

/** The calendars this account has in its list, excluding ones it has deleted. */
export async function listCalendars(g: GoogleClient, accessToken: string, deadline?: AbortSignal): Promise<CalendarInfo[]> {
  interface Entry { id: string; summary?: string; summaryOverride?: string; primary?: boolean; selected?: boolean; deleted?: boolean }
  const out: CalendarInfo[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_CALENDAR_PAGES; page++) {
    const result: { items?: Entry[]; nextPageToken?: string } = await api(
      g,
      accessToken,
      '/users/me/calendarList',
      { maxResults: '250', fields: 'nextPageToken,items(id,summary,summaryOverride,primary,selected,deleted)', ...(pageToken ? { pageToken } : {}) },
      deadline,
    );
    for (const entry of result.items ?? []) {
      if (!entry.id || entry.deleted) continue;
      out.push({ calendarId: entry.id, name: entry.summaryOverride || entry.summary || entry.id, primary: !!entry.primary, selected: !!entry.selected });
    }
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  // The person's own calendar first, then by name: the order they are listed in Koyomi.
  return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
}

/**
 * The events of one calendar, with repeating events already expanded into their instances by
 * Google, so Koyomi has no second set of recurrence rules to get wrong.
 *
 * Without a cursor: everything between `timeMin` and `timeMax`.
 * With one: only what has changed since it was issued, including what was deleted.
 *
 * A calendar with more than MAX_EVENT_PAGES pages in the span is cut short. What was read is
 * returned without a cursor, so the next reading starts again rather than trusting a partial one.
 */
export async function listEvents(
  g: GoogleClient,
  accessToken: string,
  calendarId: string,
  span: { timeMin: string; timeMax: string },
  syncToken: string | null,
  deadline?: AbortSignal,
): Promise<{ items: GoogleEvent[]; nextSyncToken: string | null }> {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const result: { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string } = await api(
      g,
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        singleEvents: 'true',
        maxResults: '2500',
        fields: EVENT_FIELDS,
        // A cursor already carries the span it was issued for, and Google refuses both together.
        ...(syncToken ? { syncToken } : { timeMin: span.timeMin, timeMax: span.timeMax }),
        ...(pageToken ? { pageToken } : {}),
      },
      deadline,
    );
    items.push(...(result.items ?? []));
    pageToken = result.nextPageToken;
    if (!pageToken) return { items, nextSyncToken: result.nextSyncToken ?? null };
  }
  return { items, nextSyncToken: null };
}
