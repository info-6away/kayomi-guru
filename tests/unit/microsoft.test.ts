import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { MICROSOFT_EVENT_FIELDS, normalizeMicrosoftEvent, type MicrosoftEvent } from '../../lib/calendars/normalize';
import { accountKey, memoryStore, sqlStore, type Sql } from '../../lib/server/connections';
import { calendarProviders, connectionsConfig } from '../../lib/server/env';
import { beginFlow, finishFlow } from '../../lib/server/flow';
import { describe } from '../../lib/server/log';
import { seal } from '../../lib/server/seal';
import {
  MAX_EVENT_PAGES,
  MICROSOFT_SCOPES,
  MicrosoftError,
  accountOf,
  authorizeUrl,
  exchangeCode,
  grantsCalendars,
  listCalendars,
  listEvents,
  microsoftEndpoints,
  readCalendar,
  refreshAccess,
  type MicrosoftClient,
} from '../../lib/server/microsoft';

// The server's side of a Microsoft connection: what is asked of Microsoft and nothing more, how
// an account is told from another, what each of Microsoft's answers comes to, and how an event
// from Microsoft Graph becomes Koyomi's record of it. Nothing here reaches Microsoft: every
// answer is made up.

const KEY = 'a'.repeat(64);
const CLIENT: MicrosoftClient = { clientId: 'client-id', clientSecret: 'secret', redirectUri: 'https://app.koyomi.guru/api/microsoft/callback', endpoints: microsoftEndpoints() };
const PERSONAL = '9188040d-6c67-4c5b-b112-36a304b66dad';
const WORK = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const SPAN = { timeMin: '2026-09-01T21:00:00.000Z', timeMax: '2027-04-14T21:00:00.000Z' };
const FETCHED = '2026-10-07T09:00:00.000Z';
const A = '11111111-1111-4111-8111-111111111111';

async function withMicrosoft<T>(answer: (url: URL, init: RequestInit) => Response | Promise<Response>, run: (asked: { url: URL; init: RequestInit }[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const asked: { url: URL; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    asked.push({ url, init });
    return answer(url, init);
  }) as typeof fetch;
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = real;
  }
}

/** An ID token as Microsoft's token endpoint returns one. Its signature is not what is checked (see `accountOf`). */
const idToken = (claims: Record<string, unknown>) =>
  ['{"alg":"RS256","typ":"JWT"}', JSON.stringify(claims), 'signature'].map((part, i) => (i < 2 ? Buffer.from(part).toString('base64url') : part)).join('.');
const NOW = Date.parse('2026-10-07T10:00:00Z');
const claims = (over: Record<string, unknown> = {}) => ({
  aud: 'client-id',
  iss: `https://login.microsoftonline.com/${PERSONAL}/v2.0`,
  tid: PERSONAL,
  sub: 'AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ',
  nonce: 'nonce-1',
  exp: NOW / 1000 + 3600,
  ...over,
});

// ---------- What is asked for ----------

test('Koyomi asks Microsoft to sign the person in, to keep reading later, and to read their calendars: nothing more', () => {
  expect(MICROSOFT_SCOPES).toEqual(['openid', 'offline_access', 'https://graph.microsoft.com/Calendars.ReadBasic']);
  // No profile, no address, no User.Read, nothing shared by others, nothing that writes.
  for (const scope of MICROSOFT_SCOPES) expect(scope).not.toMatch(/profile|email|User\.|Shared|Write|\.Read$|Mail|\.default/);

  const url = new URL(authorizeUrl(CLIENT, 'state-1', 'challenge-1', 'nonce-1'));
  expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: 'client-id',
    response_type: 'code',
    redirect_uri: 'https://app.koyomi.guru/api/microsoft/callback',
    response_mode: 'query',
    scope: 'openid offline_access https://graph.microsoft.com/Calendars.ReadBasic',
    state: 'state-1',
    nonce: 'nonce-1',
    code_challenge: 'challenge-1',
    code_challenge_method: 'S256',
    // Microsoft's list of accounts, every time: a second account can be chosen, and the one
    // already signed in at Microsoft is never taken for granted.
    prompt: 'select_account',
  });
  // The client secret is for the server's own calls to Microsoft, never for an address a browser visits.
  expect(url.href).not.toContain('secret');
});

test('a consent is kept only if it includes reading calendars, however Microsoft writes it', () => {
  expect(grantsCalendars('openid offline_access Calendars.ReadBasic')).toBe(true);
  expect(grantsCalendars('https://graph.microsoft.com/Calendars.ReadBasic https://graph.microsoft.com/User.Read openid')).toBe(true);
  expect(grantsCalendars('openid offline_access')).toBe(false);
  expect(grantsCalendars('')).toBe(false);
  // A wider permission granted some other way is not the one asked for.
  expect(grantsCalendars('Calendars.Read openid')).toBe(false);
});

test('the code is traded on the server, with the secret and the PKCE secret, for the same scopes and nothing else', async () => {
  await withMicrosoft(
    () => Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: 'openid offline_access Calendars.ReadBasic', id_token: 'x.y.z' }),
    async (asked) => {
      expect(await exchangeCode(CLIENT, 'code-1', 'verifier-1')).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3599, scope: 'openid offline_access Calendars.ReadBasic', idToken: 'x.y.z' });
      expect(asked[0].url.href).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
      expect(Object.fromEntries(new URLSearchParams(String(asked[0].init.body)))).toEqual({
        client_id: 'client-id',
        client_secret: 'secret',
        scope: 'openid offline_access https://graph.microsoft.com/Calendars.ReadBasic',
        grant_type: 'authorization_code',
        code: 'code-1',
        code_verifier: 'verifier-1',
        redirect_uri: 'https://app.koyomi.guru/api/microsoft/callback',
      });
    },
  );
});

// ---------- Which account it is ----------

test('which Microsoft account it is comes from the ID token issued for this attempt: its tenant and its subject', () => {
  expect(accountOf(CLIENT, idToken(claims()), 'nonce-1', NOW)).toBe(`${PERSONAL}:AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ`);
  const work = claims({ tid: WORK, iss: `https://login.microsoftonline.com/${WORK}/v2.0`, sub: 'xYz' });
  expect(accountOf(CLIENT, idToken(work), 'nonce-1', NOW)).toBe(`${WORK}:xYz`);
  // Without its own claim, the tenant is the one in the issuer's address.
  expect(accountOf(CLIENT, idToken({ ...work, tid: undefined }), 'nonce-1', NOW)).toBe(`${WORK}:xYz`);

  const refused = (token: string | null, nonce = 'nonce-1') => {
    try {
      accountOf(CLIENT, token, nonce, NOW);
      return 'kept';
    } catch (error) {
      return (error as MicrosoftError).kind;
    }
  };
  // Issued for another app.
  expect(refused(idToken(claims({ aud: 'another-app' })))).toBe('busy');
  // Not by Microsoft, or by Microsoft for another tenant than the one it names.
  expect(refused(idToken(claims({ iss: 'https://evil.example/v2.0' })))).toBe('busy');
  expect(refused(idToken(claims({ iss: `https://login.microsoftonline.com/${WORK}/v2.0` })))).toBe('busy');
  expect(refused(idToken(claims({ tid: 'not-a-tenant', iss: 'https://login.microsoftonline.com/not-a-tenant/v2.0' })))).toBe('busy');
  // For another attempt, or long ago.
  expect(refused(idToken(claims()), 'nonce-2')).toBe('busy');
  expect(refused(idToken(claims({ nonce: undefined })))).toBe('busy');
  expect(refused(idToken(claims({ exp: NOW / 1000 - 3600 })))).toBe('busy');
  // Naming nobody, or not a token at all.
  expect(refused(idToken(claims({ sub: '' })))).toBe('busy');
  expect(refused(idToken(claims({ sub: 7 })))).toBe('busy');
  for (const nonsense of [null, '', 'one-part', 'a.b.c', `x.${Buffer.from('[1,2]').toString('base64url')}.z`]) expect(refused(nonsense), String(nonsense)).toBe('busy');
});

test('a Microsoft subject keeps its case in the table’s word for the account; an address does not', () => {
  const word = accountKey(KEY, 'user-1', 'microsoft', `${PERSONAL}:AbC`);
  expect(accountKey(KEY, 'user-1', 'microsoft', `${PERSONAL}:AbC`)).toBe(word);
  // Two subjects that differ only in case are two accounts.
  expect(accountKey(KEY, 'user-1', 'microsoft', `${PERSONAL}:abc`)).not.toBe(word);
  // The same identifier at Google is another account altogether.
  expect(accountKey(KEY, 'user-1', 'google', `${PERSONAL}:AbC`)).not.toBe(word);
  // Google's, an address, is the same address in any case, as it always was.
  expect(accountKey(KEY, 'user-1', 'google', 'Someone@Example.com')).toBe(accountKey(KEY, 'user-1', 'google', 'someone@example.com'));
  expect(word).toMatch(/^[\w-]{43}$/);
  expect(word).not.toContain('AbC');
});

// ---------- What Microsoft's answers come to ----------

test('only a refused grant asks the person to reconnect; a refused client secret is the operator’s, and logged as such', async () => {
  const kind = (status: number, body: unknown) => withMicrosoft(() => Response.json(body, { status }), async () => (await refreshAccess(CLIENT, 'M.C123-secret-refresh-token').catch((e) => e)).kind);
  const logged: string[] = [];
  const real = console.error;
  console.error = (line: string) => void logged.push(line);
  try {
    // Revoked, expired, a password changed, consent withdrawn: Microsoft says invalid_grant.
    expect(await kind(400, { error: 'invalid_grant', error_description: 'AADSTS70000: M.C123-secret-refresh-token is not valid', error_codes: [70000] })).toBe('reconnect');
    // Its organisation now wants the person to sign in again, or to pass another check.
    expect(await kind(400, { error: 'interaction_required', error_codes: [50076] })).toBe('reconnect');
    // Its organisation has shut Koyomi out: nobody's to mend by signing in, and not the secret.
    expect(await kind(400, { error: 'unauthorized_client', error_description: 'AADSTS7000112: Application is disabled.' })).toBe('blocked');
    // Microsoft is down: nothing is wrong with the connection.
    expect(await kind(503, { error: 'temporarily_unavailable' })).toBe('busy');
    expect(await kind(500, { error: 'server_error' })).toBe('busy');
    // The secret has run out. No connection is to blame, so none is marked; the log says what to renew.
    expect(await kind(401, { error: 'invalid_client', error_description: 'AADSTS7000222: secret expired' })).toBe('busy');
    // Each refusal is in the log by its status and Microsoft's codes, and by nothing else.
    expect(logged).toEqual([
      '[calendars] microsoft: Error: the token endpoint answered 400 invalid_grant AADSTS70000',
      '[calendars] microsoft: Error: the token endpoint answered 400 interaction_required',
      '[calendars] microsoft: Error: the token endpoint answered 400 unauthorized_client AADSTS7000112',
      '[calendars] microsoft: Error: the token endpoint answered 503 temporarily_unavailable',
      '[calendars] microsoft: Error: the token endpoint answered 500 server_error',
      '[calendars] microsoft: Error: the token endpoint answered 401 invalid_client AADSTS7000222',
      '[calendars] microsoft: Error: Microsoft refused Koyomi’s client id or secret: a client secret expires, and is renewed in the app registration',
    ]);
    expect(logged.join('\n')).not.toContain('secret-refresh-token');
    // And nothing Microsoft said, nor any token, goes into the error.
    const error = await withMicrosoft(() => Response.json({ error: 'invalid_grant', error_description: 'M.C123-secret-refresh-token' }, { status: 400 }), () => refreshAccess(CLIENT, 'M.C123-secret-refresh-token').catch((e) => e));
    expect(error).toBeInstanceOf(MicrosoftError);
    expect(error.message).toBe('Microsoft: reconnect');
    expect(JSON.stringify(error) + String(error.stack) + describe(error)).not.toContain('secret-refresh-token');
  } finally {
    console.error = real;
  }
  // Unreachable is busy too.
  expect(await withMicrosoft(() => Promise.reject(new TypeError('fetch failed')), async () => (await refreshAccess(CLIENT, 'rt').catch((e) => e)).kind)).toBe('busy');
});

test('a refresh brings a new refresh token, which is handed back to be kept', async () => {
  await withMicrosoft(
    () => Response.json({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3599 }),
    async (asked) => {
      expect(await refreshAccess(CLIENT, 'rt-1')).toEqual({ accessToken: 'at-2', expiresIn: 3599, refreshToken: 'rt-2' });
      expect(Object.fromEntries(new URLSearchParams(String(asked[0].init.body)))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1', scope: MICROSOFT_SCOPES.join(' ') });
    },
  );
});

test('what Microsoft says beside its codes never reaches the log: no token, no address, no id', async () => {
  const logged: string[] = [];
  const real = console.error;
  console.error = (line: string) => void logged.push(line);
  try {
    const told = { error: { code: 'ErrorAccessDenied', message: 'Access to mailbox pat@example.com with token eyJ0eXAiOiJKV1QiLCJub25jZSI6IjEyMzQ1Njc4OTAifQ denied' } };
    await withMicrosoft(() => Response.json(told, { status: 403 }), () => listCalendars(CLIENT, 'token').catch(() => {}));
    await withMicrosoft(() => Response.json(told, { status: 403 }), () => listEvents(CLIENT, 'token', 'AAMkADefault=', SPAN).catch(() => {}));
    // A code that is not shaped like one is left out, whatever it holds.
    await withMicrosoft(() => Response.json({ error: { code: 'pat@example.com' } }, { status: 400 }), () => listCalendars(CLIENT, 'token').catch(() => {}));
    await withMicrosoft(() => Response.json({ error: 'invalid_grant', error_description: 'Token for pat@example.com is gone' }, { status: 400 }), () => refreshAccess(CLIENT, 'rt').catch(() => {}));
    expect(logged).toEqual([
      '[calendars] microsoft: Error: Graph, asked for the calendar list, answered 403 ErrorAccessDenied',
      '[calendars] microsoft: Error: Graph, asked for a calendar’s events, answered 403 ErrorAccessDenied',
      '[calendars] microsoft: Error: Graph, asked for the calendar list, answered 400',
      '[calendars] microsoft: Error: the token endpoint answered 400 invalid_grant',
    ]);
  } finally {
    console.error = real;
  }
});

test('each of Graph’s refusals has its own word: wait, a new access token, an account that cannot be read, a calendar that is gone', async () => {
  const kind = (status: number, body: unknown, headers?: Record<string, string>) =>
    withMicrosoft(() => Response.json(body, { status, headers }), async () => {
      const error = await listCalendars(CLIENT, 'token').catch((e) => e);
      return error.kind === 'slow_down' ? `${error.kind} ${error.retryAfter}` : error.kind;
    });
  // Throttled: as long as Microsoft says, never longer than an hour, a minute where it does not say.
  expect(await kind(429, { error: { code: 'ApplicationThrottled' } }, { 'retry-after': '30' })).toBe('slow_down 30');
  expect(await kind(429, { error: { code: 'ApplicationThrottled' } }, { 'retry-after': '99999' })).toBe('slow_down 3600');
  expect(await kind(429, { error: { code: 'ApplicationThrottled' } })).toBe('slow_down 60');
  // The access token, not the permission: a new token is asked for, and the refresh token's answer decides.
  expect(await kind(401, { error: { code: 'InvalidAuthenticationToken' } })).toBe('expired');
  // An account with no mailbox in the cloud, however Microsoft sends it: consenting again would not help.
  expect(await kind(404, { error: { code: 'MailboxNotEnabledForRESTAPI' } })).toBe('blocked');
  expect(await kind(401, { error: { code: 'MailboxNotEnabledForRESTAPI' } })).toBe('blocked');
  expect(await kind(403, { error: { code: 'ErrorAccessDenied' } })).toBe('blocked');
  expect(await kind(404, { error: { code: 'ErrorItemNotFound' } })).toBe('not_found');
  expect(await kind(503, { error: { code: 'ServiceNotAvailable' } })).toBe('busy');
  expect(await kind(500, {})).toBe('busy');
});

// ---------- Calendars and events ----------

test('the calendar list: the account’s own calendars, its own one first, its address read with them; others’ are left out', async () => {
  const page1 = {
    value: [
      { id: 'cal-work', name: 'Work', isDefaultCalendar: false, canEdit: true, owner: { name: 'Pat', address: 'Pat@Example.com' } },
      { id: 'cal-default', name: 'Calendar', isDefaultCalendar: true, canEdit: true, owner: { name: 'Pat', address: 'pat@example.com' } },
    ],
    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$select=id&$skiptoken=2',
  };
  const page2 = {
    value: [
      { id: 'cal-holidays', name: 'United States holidays', isDefaultCalendar: false, canEdit: false, owner: { name: 'Pat', address: 'pat@example.com' } },
      // Shared by someone else: reading it needs a permission Koyomi does not ask for.
      { id: 'cal-shared', name: 'Alex’s calendar', isDefaultCalendar: false, canEdit: false, owner: { name: 'Alex', address: 'alex@example.com' } },
    ],
  };
  await withMicrosoft(
    (url) => Response.json(url.searchParams.has('$skiptoken') ? page2 : page1),
    async (asked) => {
      expect(await listCalendars(CLIENT, 'token')).toEqual({
        account: 'pat@example.com',
        calendars: [
          { calendarId: 'cal-default', name: 'Calendar', primary: true, selected: true },
          // One the person cannot change (holidays, birthdays, a subscription) starts hidden.
          { calendarId: 'cal-holidays', name: 'United States holidays', primary: false, selected: false },
          { calendarId: 'cal-work', name: 'Work', primary: false, selected: true },
        ],
      });
      expect(asked.map(({ url }) => url.origin + url.pathname)).toEqual(['https://graph.microsoft.com/v1.0/me/calendars', 'https://graph.microsoft.com/v1.0/me/calendars']);
      expect(asked[0].url.search).toBe('?$select=id,name,isDefaultCalendar,canEdit,owner');
      expect(asked[0].init.headers).toMatchObject({ authorization: 'Bearer token', prefer: 'outlook.timezone="UTC"' });
    },
  );
});

test('a next page is followed only on Graph’s own address, and only so far', async () => {
  for (const next of ['https://evil.example/v1.0/me/calendars?$skiptoken=2', 'https://graph.microsoft.com/beta/me/calendars', 'http://graph.microsoft.com/v1.0/me/calendars', 'not a url']) {
    await withMicrosoft(
      () => Response.json({ value: [{ id: 'c', name: 'Calendar', isDefaultCalendar: true }], '@odata.nextLink': next }),
      async (asked) => {
        await listCalendars(CLIENT, 'token');
        expect(asked, next).toHaveLength(1);
      },
    );
  }
  // A calendar that never ends is not read for ever.
  await withMicrosoft(
    (url) => Response.json({ value: [{ id: `e${url.searchParams.get('$skiptoken') ?? 0}` }], '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/calendars/c/calendarView?$skiptoken=${Math.random()}` }),
    async (asked) => {
      expect(await listEvents(CLIENT, 'token', 'c', SPAN)).toHaveLength(MAX_EVENT_PAGES);
      expect(asked).toHaveLength(MAX_EVENT_PAGES);
    },
  );
});

test('nothing a browser sends can change where Koyomi asks: only Graph, only that calendar, only those fields', async () => {
  const hostile = ['../../../me/messages', 'https://evil.example/steal', '//evil.example', 'a/b?c=d#e', '..%2f..%2fme%2fmessages', 'AAMkAGI2TGuLAAA='];
  await withMicrosoft(
    () => Response.json({ value: [] }),
    async (asked) => {
      for (const id of hostile) await listEvents(CLIENT, 'token', id, SPAN);
      asked.forEach(({ url }, i) => {
        expect(url.origin).toBe('https://graph.microsoft.com');
        const [, segment] = /^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/.exec(url.pathname) ?? [];
        expect(decodeURIComponent(segment ?? ''), hostile[i]).toBe(hostile[i]);
        expect(url.hash).toBe('');
        expect(Object.fromEntries(url.searchParams)).toEqual({ startDateTime: SPAN.timeMin, endDateTime: SPAN.timeMax, $select: MICROSOFT_EVENT_FIELDS, $top: '500' });
      });
    },
  );
  // Only what Koyomi shows: no body, no location, no attendees, no meeting details.
  expect(MICROSOFT_EVENT_FIELDS.split(',')).toEqual(['id', 'subject', 'start', 'end', 'isAllDay', 'isCancelled', 'showAs', 'responseStatus', 'webLink', 'type', 'originalStartTimeZone']);
});

test('a calendar that is gone, or that may not be read, is that calendar’s own business', async () => {
  const asked = { connectionId: A, calendarId: 'c', span: SPAN, fetchedAt: FETCHED };
  expect(await withMicrosoft(() => Response.json({ error: { code: 'ErrorItemNotFound' } }, { status: 404 }), () => readCalendar(CLIENT, 'token', asked))).toEqual({ calendarId: 'c', gone: true });
  expect(await withMicrosoft(() => Response.json({ error: { code: 'ErrorAccessDenied' } }, { status: 403 }), () => readCalendar(CLIENT, 'token', asked))).toEqual({ calendarId: 'c', failed: true });
  // Anything that is about the account, not the calendar, is the account's.
  expect((await withMicrosoft(() => Response.json({}, { status: 503 }), () => readCalendar(CLIENT, 'token', asked).catch((e) => e))).kind).toBe('busy');
  // A whole reading, always: Graph has no cursor for this.
  const whole = await withMicrosoft(
    () => Response.json({ value: [{ id: 'e1', subject: 'Standup', start: { dateTime: '2026-10-07T07:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-07T07:15:00.0000000', timeZone: 'UTC' } }] }),
    () => readCalendar(CLIENT, 'token', asked),
  );
  expect(whole).toMatchObject({ calendarId: 'c', full: true, removed: [], syncToken: null, events: [{ id: `${A}:c:e1`, provider: 'microsoft', title: 'Standup' }] });
});

// ---------- Events ----------

const mread = (item: MicrosoftEvent) => normalizeMicrosoftEvent(item, A, 'cal-1', FETCHED);
const timed = (start: string, end: string, over: Partial<MicrosoftEvent> = {}): MicrosoftEvent => ({ id: 'e1', subject: 'Review', start: { dateTime: start, timeZone: 'UTC' }, end: { dateTime: end, timeZone: 'UTC' }, ...over });
const allDay = (start: string, end: string, zone?: string): MicrosoftEvent => ({ id: 'd1', subject: 'Holiday', isAllDay: true, originalStartTimeZone: zone, start: { dateTime: start, timeZone: 'UTC' }, end: { dateTime: end, timeZone: 'UTC' } });

test('a timed event from Microsoft keeps its instant, read as UTC, and the zone it was written in', () => {
  expect(mread(timed('2026-10-07T12:00:00.0000000', '2026-10-07T13:30:00.0000000', { originalStartTimeZone: 'Turkey Standard Time', webLink: 'https://outlook.live.com/owa/?itemid=AAMk&exvsurl=1&path=/calendar/item', showAs: 'busy' }))).toEqual({
    id: `${A}:cal-1:e1`,
    connectionId: A,
    provider: 'microsoft',
    providerEventId: 'e1',
    calendarId: 'cal-1',
    title: 'Review',
    start: '2026-10-07T12:00:00.000Z',
    end: '2026-10-07T13:30:00.000Z',
    allDay: false,
    timeZone: 'Turkey Standard Time',
    status: 'confirmed',
    link: 'https://outlook.live.com/owa/?itemid=AAMk&exvsurl=1&path=/calendar/item',
    updatedAt: FETCHED,
    fetchedAt: FETCHED,
  });
  // Given in a named zone instead of UTC, it is the same instant.
  expect(mread({ ...timed('', ''), start: { dateTime: '2026-10-07T15:00:00.0000000', timeZone: 'Europe/Istanbul' }, end: { dateTime: '2026-10-07T16:30:00.0000000', timeZone: 'Europe/Istanbul' } })).toMatchObject({
    start: '2026-10-07T12:00:00.000Z',
    end: '2026-10-07T13:30:00.000Z',
  });
  // A repeating meeting arrives as its occurrences, each an event of its own.
  expect(mread(timed('2026-10-14T07:00:00.0000000', '2026-10-14T07:15:00.0000000', { id: 'occ-2', type: 'occurrence' }))).toMatchObject({ id: `${A}:cal-1:occ-2`, start: '2026-10-14T07:00:00.000Z' });
});

test('an all-day event from Microsoft is on its own day, wherever it was written', () => {
  const days = (event: MicrosoftEvent) => {
    const kept = mread(event)!;
    return `${kept.start}..${kept.end} ${kept.allDay ? 'all day' : 'timed'}`;
  };
  // Midnight to midnight as given: the day itself.
  expect(days(allDay('2026-10-09T00:00:00.0000000', '2026-10-10T00:00:00.0000000', 'UTC'))).toBe('2026-10-09..2026-10-09 all day');
  // Written in Istanbul and given in UTC: 21:00 the evening before.
  expect(days(allDay('2026-10-08T21:00:00.0000000', '2026-10-09T21:00:00.0000000', 'Turkey Standard Time'))).toBe('2026-10-09..2026-10-09 all day');
  expect(days(allDay('2026-10-08T21:00:00.0000000', '2026-10-09T21:00:00.0000000', 'Europe/Istanbul'))).toBe('2026-10-09..2026-10-09 all day');
  // Written in New York: four in the morning of the day itself.
  expect(days(allDay('2026-10-09T04:00:00.0000000', '2026-10-10T04:00:00.0000000', 'Eastern Standard Time'))).toBe('2026-10-09..2026-10-09 all day');
  // Written in Hawaii, ten hours behind, and in New Zealand in summer, thirteen ahead.
  expect(days(allDay('2026-10-09T10:00:00.0000000', '2026-10-10T10:00:00.0000000', 'Hawaiian Standard Time'))).toBe('2026-10-09..2026-10-09 all day');
  expect(days(allDay('2027-01-08T11:00:00.0000000', '2027-01-09T11:00:00.0000000', 'New Zealand Standard Time'))).toBe('2027-01-09..2027-01-09 all day');
  // The few zones further out than that, by the names Windows gives them, and by their own names.
  expect(days(allDay('2026-10-08T10:00:00.0000000', '2026-10-09T10:00:00.0000000', 'Line Islands Standard Time'))).toBe('2026-10-09..2026-10-09 all day');
  expect(days(allDay('2026-10-09T11:00:00.0000000', '2026-10-10T11:00:00.0000000', 'UTC-11'))).toBe('2026-10-09..2026-10-09 all day');
  expect(days(allDay('2026-10-09T11:00:00.0000000', '2026-10-10T11:00:00.0000000', 'Pacific/Pago_Pago'))).toBe('2026-10-09..2026-10-09 all day');
  // Several days: the first and the last, both included.
  expect(days(allDay('2026-10-08T21:00:00.0000000', '2026-10-11T21:00:00.0000000', 'Turkey Standard Time'))).toBe('2026-10-09..2026-10-11 all day');
});

test('what should not be on the calendar is left out: cancelled, declined, the series itself, unreadable', () => {
  const at = ['2026-10-07T12:00:00.0000000', '2026-10-07T13:00:00.0000000'] as const;
  expect(mread(timed(...at, { isCancelled: true }))).toBeNull();
  expect(mread(timed(...at, { responseStatus: { response: 'declined' } }))).toBeNull();
  expect(mread(timed(...at, { type: 'seriesMaster' }))).toBeNull();
  expect(mread(timed(...at, { id: undefined }))).toBeNull();
  expect(mread(timed('not a time', at[1]))).toBeNull();
  expect(mread({ ...allDay('nonsense', 'nonsense') })).toBeNull();
  // Accepted, organised, not answered: on the calendar. Tentative is said so.
  for (const response of ['accepted', 'organizer', 'notResponded', 'none']) expect(mread(timed(...at, { responseStatus: { response } }))?.status).toBe('confirmed');
  expect(mread(timed(...at, { responseStatus: { response: 'tentativelyAccepted' } }))?.status).toBe('tentative');
  expect(mread(timed(...at, { showAs: 'tentative' }))?.status).toBe('tentative');
});

test('a missing title is named, and only a link to Outlook is passed on', () => {
  const at = ['2026-10-07T12:00:00.0000000', '2026-10-07T13:00:00.0000000'] as const;
  expect(mread(timed(...at, { subject: '  ' }))?.title).toBe('(No title)');
  for (const good of ['https://outlook.live.com/owa/?itemid=x', 'https://outlook.office365.com/owa/?itemid=x', 'https://outlook.office.com/calendar/item/x', 'https://outlook.cloud.microsoft/calendar/item/x']) expect(mread(timed(...at, { webLink: good }))?.link).toBe(good);
  for (const bad of ['http://outlook.live.com/owa/?itemid=x', 'https://outlook.live.com.evil.example/x', 'https://evil.example/?outlook.live.com', 'javascript:alert(1)', '']) expect(mread(timed(...at, { webLink: bad }))?.link, bad).toBeNull();
});

// ---------- The round trip, and the settings ----------

test('a round trip to Microsoft can only be finished at Microsoft’s address, and Google’s only at Google’s', () => {
  const now = Date.now();
  const ms = beginFlow('user-1', KEY, now, 'microsoft');
  const back = { state: ms.flow.state, subject: 'user-1' };
  expect(finishFlow(ms.cookie, KEY, back, now + 1000, 'microsoft')).toEqual(ms.flow);
  expect(finishFlow(ms.cookie, KEY, back, now + 1000, 'google')).toBeNull();
  const g = beginFlow('user-1', KEY, now);
  expect(finishFlow(g.cookie, KEY, { state: g.flow.state, subject: 'user-1' }, now + 1000, 'microsoft')).toBeNull();
  // A Google attempt begun before nonces were sealed in is honoured as it was; a Microsoft one without a nonce is not.
  const before = { state: 'state-old', verifier: 'v', subject: 'user-1', expires: now + 60_000 };
  expect(finishFlow(seal(JSON.stringify(before), KEY, 'google-consent-flow'), KEY, { state: 'state-old', subject: 'user-1' }, now)).toEqual(before);
  expect(finishFlow(seal(JSON.stringify(before), KEY, 'microsoft-consent-flow'), KEY, { state: 'state-old', subject: 'user-1' }, now, 'microsoft')).toBeNull();
  // Every attempt has a nonce of its own, for the ID token to carry back.
  expect(ms.flow.nonce).toMatch(/^[\w-]{22}$/);
  expect(beginFlow('user-1', KEY, now, 'microsoft').flow.nonce).not.toBe(ms.flow.nonce);
  expect(ms.cookie).not.toContain(ms.flow.nonce);
});

test('Microsoft is offered by its own two settings, beside Google or without it', () => {
  const base: Record<string, string> = {
    NEXT_PUBLIC_APP_URL: 'https://app.koyomi.guru',
    NEXT_PUBLIC_AUTH_URL: 'https://auth.6away.ai',
    AUTH_CLIENT_ID: 'koyomi',
    AUTH_CLIENT_SECRET: 's',
    SESSION_SECRET: 's',
    TOKEN_ENCRYPTION_KEY: KEY,
    DATABASE_URL: 'postgres://example',
  };
  const google = { GOOGLE_CALENDAR_CLIENT_ID: 'g', GOOGLE_CALENDAR_CLIENT_SECRET: 'gs' };
  const microsoft = { MICROSOFT_CALENDAR_CLIENT_ID: 'm', MICROSOFT_CALENDAR_CLIENT_SECRET: 'ms' };
  const names = [...Object.keys(base), ...Object.keys(google), ...Object.keys(microsoft), 'VERCEL', 'KOYOMI_TEST_STORE', 'KOYOMI_TEST_GOOGLE_URL', 'KOYOMI_TEST_MICROSOFT_URL'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const withEnv = (env: Record<string, string>) => {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, env);
    return { config: connectionsConfig(), providers: calendarProviders() };
  };
  try {
    expect(withEnv(base)).toEqual({ config: null, providers: [] });
    expect(withEnv({ ...base, ...google }).providers).toEqual(['google']);
    expect(withEnv({ ...base, ...google, ...microsoft }).providers).toEqual(['google', 'microsoft']);
    const only = withEnv({ ...base, ...microsoft });
    expect(only.providers).toEqual(['microsoft']);
    expect(only.config!.google).toBeNull();
    expect(only.config!.microsoft).toMatchObject({ clientId: 'm', clientSecret: 'ms', redirectUri: 'https://app.koyomi.guru/api/microsoft/callback' });
    expect(only.config!.microsoft!.endpoints.token).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    // Half of Microsoft's settings is none of them.
    expect(withEnv({ ...base, MICROSOFT_CALENDAR_CLIENT_ID: 'm' }).providers).toEqual([]);
    // The stand-in is used on a developer's machine and ignored on a deployment.
    expect(withEnv({ ...base, ...microsoft, KOYOMI_TEST_MICROSOFT_URL: 'http://localhost:9/microsoft' }).config!.microsoft!.endpoints.graph).toBe('http://localhost:9/microsoft/graph/v1.0');
    expect(withEnv({ ...base, ...microsoft, KOYOMI_TEST_MICROSOFT_URL: 'http://localhost:9/microsoft', VERCEL: '1' }).config!.microsoft!.endpoints.graph).toBe('https://graph.microsoft.com/v1.0');
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

// ---------- A refresh token that is replaced with every use ----------

const MIGRATIONS = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
async function postgresStore() {
  const db = new PGlite();
  for (const file of MIGRATIONS) await db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const sql: Sql = async (strings, ...values) => (await db.query(strings.reduce((text, part, i) => `${text}$${i}${part}`), values)).rows as Record<string, unknown>[];
  return sqlStore(sql);
}

for (const kind of ['Postgres', 'memory'] as const) {
  test(`a new refresh token takes the old one’s place, and only while the old one is still there (${kind})`, async () => {
    const store = kind === 'Postgres' ? await postgresStore() : memoryStore();
    const id = await store.save('user-1', 'microsoft', 'account-a', 'sealed-1', 'scope');
    const other = await store.save('user-1', 'google', 'account-b', 'sealed-g', 'scope');
    await store.renewToken('user-1', id, 'sealed-1', 'sealed-2');
    expect((await store.get('user-1', id))!.sealedToken).toBe('sealed-2');
    // A late renewal from before a reconnection does not undo the reconnection.
    await store.save('user-1', 'microsoft', 'account-a', 'sealed-reconnected', 'scope');
    await store.renewToken('user-1', id, 'sealed-2', 'sealed-3');
    expect((await store.get('user-1', id))!.sealedToken).toBe('sealed-reconnected');
    // Nobody else's row, and no other row of the same person's.
    await store.renewToken('user-2', id, 'sealed-reconnected', 'stolen');
    await store.renewToken('user-1', 'not-an-id', 'sealed-reconnected', 'stolen');
    expect((await store.get('user-1', id))!.sealedToken).toBe('sealed-reconnected');
    expect((await store.get('user-1', other))!.sealedToken).toBe('sealed-g');
  });
}
