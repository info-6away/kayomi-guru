import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from '@playwright/test';
import { memoryStore, sqlStore, type ConnectionStore, type Sql } from '../../lib/server/connections';
import { connectionsConfig, signInConfigured } from '../../lib/server/env';
import { FLOW_SECONDS, beginFlow, finishFlow } from '../../lib/server/flow';
import { GoogleError, MAX_CALENDAR_PAGES, MAX_EVENT_PAGES, SCOPES, authorizeUrl, googleEndpoints, listCalendars, listEvents, pkce, refreshAccess } from '../../lib/server/google';
import { describe } from '../../lib/server/log';
import { open, seal } from '../../lib/server/seal';

// The server's side of a calendar connection: how a token is sealed, where it is kept, what is
// asked of Google, and when the whole feature is switched off.

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

test('a sealed token opens only with its key, for the person it was sealed for', () => {
  const sealed = seal('1//refresh-token', KEY, 'user-1:google');
  expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  expect(sealed).not.toContain('refresh-token');
  expect(open(sealed, KEY, 'user-1:google')).toBe('1//refresh-token');

  expect(() => open(sealed, OTHER_KEY, 'user-1:google')).toThrow();
  // Copied onto someone else's row, it stays shut.
  expect(() => open(sealed, KEY, 'user-2:google')).toThrow();
  // Any change to it is noticed.
  const parts = sealed.split('.');
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  expect(() => open(parts.join('.'), KEY, 'user-1:google')).toThrow();
  expect(() => open('not sealed', KEY, 'user-1:google')).toThrow();
});

test('the same token never seals to the same text twice, and a short key is refused', () => {
  expect(seal('token', KEY, 'u:google')).not.toBe(seal('token', KEY, 'u:google'));
  expect(() => seal('token', 'abc123', 'u:google')).toThrow(/64 hexadecimal/);
});

/** The real table, created by the real migration, in a Postgres that runs inside the test. */
async function postgres(): Promise<{ store: ConnectionStore; rows: () => Promise<Record<string, unknown>[]> }> {
  const db = new PGlite();
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) await db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const sql: Sql = async (strings, ...values) => (await db.query(strings.reduce((text, part, i) => `${text}$${i}${part}`), values)).rows as Record<string, unknown>[];
  return { store: sqlStore(sql), rows: async () => (await db.query('select * from calendar_connections order by auth_subject')).rows as Record<string, unknown>[] };
}

for (const kind of ['Postgres', 'memory'] as const) {
  test(`the connection store keeps one sealed token per person per provider (${kind})`, async () => {
    const store = kind === 'Postgres' ? (await postgres()).store : memoryStore();
    expect(await store.get('user-1', 'google')).toBeNull();

    await store.save('user-1', 'google', 'sealed-1', 'scope-a scope-b');
    await store.save('user-2', 'google', 'sealed-2', 'scope-a');
    expect(await store.get('user-1', 'google')).toEqual({ subject: 'user-1', provider: 'google', sealedToken: 'sealed-1', scope: 'scope-a scope-b', status: 'active' });

    // The provider refuses the token: remembered, so nothing more is fetched with it.
    await store.setStatus('user-1', 'google', 'reconnect');
    expect((await store.get('user-1', 'google'))!.status).toBe('reconnect');
    // Connecting again replaces the token and clears that.
    await store.save('user-1', 'google', 'sealed-1b', 'scope-a scope-b');
    expect(await store.get('user-1', 'google')).toMatchObject({ sealedToken: 'sealed-1b', status: 'active' });

    // Disconnecting removes that person's row and nobody else's.
    await store.remove('user-1', 'google');
    expect(await store.get('user-1', 'google')).toBeNull();
    expect(await store.get('user-2', 'google')).toMatchObject({ sealedToken: 'sealed-2' });
    await store.remove('user-1', 'google');
    await store.setStatus('nobody', 'google', 'reconnect');
    expect(await store.get('nobody', 'google')).toBeNull();
  });
}

test('the table holds a sealed token and nothing that names the person or their calendar', async () => {
  const { store, rows } = await postgres();
  await store.save('3f0c7c1e-subject', 'google', seal('1//refresh-token', KEY, '3f0c7c1e-subject:google'), SCOPES.join(' '));
  const [row] = await rows();
  expect(Object.keys(row).sort()).toEqual(['auth_subject', 'created_at', 'provider', 'refresh_token_sealed', 'scope', 'status', 'updated_at', 'window_spent', 'window_started_at']);
  expect(JSON.stringify(row)).not.toContain('refresh-token');
});

test('Koyomi asks Google for two read-only permissions and no others', () => {
  expect(SCOPES).toEqual([
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ]);
  const { challenge } = pkce();
  const url = new URL(authorizeUrl({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://app.koyomi.guru/api/google/callback', endpoints: googleEndpoints() }, 'state-1', challenge));
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: 'client',
    redirect_uri: 'https://app.koyomi.guru/api/google/callback',
    response_type: 'code',
    scope: SCOPES.join(' '),
    state: 'state-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });
  // The client secret is for the server's own calls to Google, never for an address a browser visits.
  expect(url.href).not.toContain('secret');
  for (const scope of SCOPES) expect(scope).toMatch(/\.readonly$/);
});

test('calendar connections are off unless every setting is there, and sign-in needs only its own', () => {
  const full: Record<string, string> = {
    NEXT_PUBLIC_APP_URL: 'https://app.koyomi.guru/',
    NEXT_PUBLIC_AUTH_URL: 'https://auth.6away.ai',
    AUTH_CLIENT_ID: 'koyomi',
    AUTH_CLIENT_SECRET: 's',
    SESSION_SECRET: 's',
    GOOGLE_CALENDAR_CLIENT_ID: 'id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 's',
    TOKEN_ENCRYPTION_KEY: KEY,
    DATABASE_URL: 'postgres://example',
  };
  const names = [...Object.keys(full), 'VERCEL', 'KOYOMI_TEST_STORE', 'KOYOMI_TEST_GOOGLE_URL'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const withEnv = (env: Record<string, string>) => {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, env);
    return connectionsConfig();
  };
  try {
    expect(withEnv({})).toBeNull();
    for (const missing of Object.keys(full)) {
      const { [missing]: _, ...rest } = full;
      expect(withEnv(rest), `without ${missing}`).toBeNull();
    }
    const config = withEnv(full)!;
    expect(config.appUrl).toBe('https://app.koyomi.guru');
    expect(config.google.redirectUri).toBe('https://app.koyomi.guru/api/google/callback');
    expect(config.google.endpoints.token).toBe('https://oauth2.googleapis.com/token');

    // The stand-ins the browser tests use work on a developer's machine...
    const { DATABASE_URL: _, ...noDatabase } = full;
    const local = withEnv({ ...noDatabase, KOYOMI_TEST_STORE: 'memory', KOYOMI_TEST_GOOGLE_URL: 'http://localhost:9/google' })!;
    expect(local.database).toBe('memory');
    expect(local.google.endpoints.token).toBe('http://localhost:9/google/token');
    // The in-memory store wins over a database address, so a test run cannot reach a real one.
    expect(withEnv({ ...full, KOYOMI_TEST_STORE: 'memory' })!.database).toBe('memory');
    // ...and are ignored on a deployment, whatever its settings say.
    expect(withEnv({ ...noDatabase, KOYOMI_TEST_STORE: 'memory', VERCEL: '1' })).toBeNull();
    expect(withEnv({ ...full, KOYOMI_TEST_GOOGLE_URL: 'http://localhost:9/google', VERCEL: '1' })!.google.endpoints.token).toBe('https://oauth2.googleapis.com/token');

    // Signing in needs five of the nine and nothing of Google's, so it can be on, and be checked,
    // while connections themselves are still off.
    const signIn = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_AUTH_URL', 'AUTH_CLIENT_ID', 'AUTH_CLIENT_SECRET', 'SESSION_SECRET'];
    const five = Object.fromEntries(signIn.map((name) => [name, full[name]]));
    expect(withEnv(five)).toBeNull();
    expect(signInConfigured()).toBe(true);
    for (const missing of signIn) {
      const { [missing]: _, ...rest } = five;
      withEnv(rest);
      expect(signInConfigured(), `without ${missing}`).toBe(false);
    }
    // A setting left blank is a setting that is missing.
    withEnv({ ...five, AUTH_CLIENT_SECRET: '   ' });
    expect(signInConfigured()).toBe(false);
    // Google's settings alone switch nothing on.
    withEnv(Object.fromEntries(Object.entries(full).filter(([name]) => !signIn.includes(name))));
    expect(signInConfigured()).toBe(false);
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

// ---------- The round trip to Google's consent screen ----------

test('each attempt has its own unguessable state and PKCE secret, sealed out of sight', () => {
  const a = beginFlow('user-1', KEY);
  const b = beginFlow('user-1', KEY);
  // 128 random bits for the state, 256 for the secret, and never the same twice.
  expect(Buffer.from(a.flow.state, 'base64url')).toHaveLength(16);
  expect(Buffer.from(a.flow.verifier, 'base64url')).toHaveLength(32);
  expect(a.flow.state).not.toBe(b.flow.state);
  expect(a.flow.verifier).not.toBe(b.flow.verifier);
  // Google is shown the hash of the secret (S256), not the secret.
  expect(a.challenge).toBe(createHash('sha256').update(a.flow.verifier).digest('base64url'));
  expect(a.challenge).not.toBe(a.flow.verifier);
  // The cookie gives none of it away.
  for (const part of [a.flow.state, a.flow.verifier, 'user-1']) expect(a.cookie).not.toContain(part);
  expect(a.cookie).not.toBe(b.cookie);
});

test('a return from Google is honoured only for the attempt, the browser and the person that started it', () => {
  const now = 1_800_000_000_000;
  const { flow, cookie } = beginFlow('user-1', KEY, now);
  const back = { state: flow.state, subject: 'user-1' };
  expect(finishFlow(cookie, KEY, back, now + 1000)).toEqual(flow);

  // No cookie: another browser, or this attempt was already used.
  expect(finishFlow(undefined, KEY, back, now)).toBeNull();
  // Not the state that was sent.
  expect(finishFlow(cookie, KEY, { ...back, state: beginFlow('user-1', KEY).flow.state }, now)).toBeNull();
  expect(finishFlow(cookie, KEY, { ...back, state: null }, now)).toBeNull();
  expect(finishFlow(cookie, KEY, { ...back, state: '' }, now)).toBeNull();
  // Somebody else is signed in now, or nobody is.
  expect(finishFlow(cookie, KEY, { ...back, subject: 'user-2' }, now)).toBeNull();
  expect(finishFlow(cookie, KEY, { ...back, subject: null }, now)).toBeNull();
  // Too late: ten minutes, to the second, even if the cookie was kept.
  expect(finishFlow(cookie, KEY, back, now + FLOW_SECONDS * 1000 - 1)).toEqual(flow);
  expect(finishFlow(cookie, KEY, back, now + FLOW_SECONDS * 1000)).toBeNull();
  // A cookie made with another key, changed in transit, or made up.
  expect(finishFlow(beginFlow('user-1', OTHER_KEY, now).cookie, KEY, back, now)).toBeNull();
  expect(finishFlow(cookie.slice(0, -3) + 'AAA', KEY, back, now)).toBeNull();
  expect(finishFlow(JSON.stringify(flow), KEY, back, now)).toBeNull();
  // A sealed refresh token is not a flow, and a flow is not a refresh token.
  expect(finishFlow(seal(JSON.stringify(flow), KEY, 'user-1:google'), KEY, back, now)).toBeNull();
  expect(() => open(cookie, KEY, 'user-1:google')).toThrow();
});

// ---------- What reaches the log ----------

test('nothing that could be a token, a code or a sealed value is ever logged', () => {
  const refresh = '1//0gAbCdEfGhIjKlMnOpQrStUvWxYz-0123456789_abcdefghijklmnopqrstuvwxyz';
  const sealed = seal(refresh, KEY, 'user-1:google');
  for (const secret of [refresh, sealed, 'ya29.a0AfH6SMBx-very-long-access-token-0123456789abcdefghijklmnop', '4/0AX4XfWh-authorisation-code-0123456789abcdefghij']) {
    const line = describe(new Error(`insert failed for value ${secret} in column`));
    expect(line).not.toContain(secret);
    expect(line).not.toContain(secret.slice(8, 40));
    expect(line).toContain('[withheld]');
  }
  // What an operator needs is still there.
  expect(describe(new Error('relation "calendar_connections" does not exist'))).toBe('Error: relation "calendar_connections" does not exist');
  expect(describe(new TypeError('fetch failed'))).toBe('TypeError: fetch failed');
  expect(describe('x'.repeat(5000)).length).toBeLessThan(230);
  expect(describe(undefined)).toBe('Error: unknown');
});

test('what Google says when it refuses a token goes no further than the word for it', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: 'invalid_grant', error_description: 'Token 1//secret-refresh-token has been expired or revoked.' }, { status: 400 })) as typeof fetch;
  try {
    const error = await refreshAccess(CLIENT, '1//secret-refresh-token').catch((e) => e);
    expect(error).toBeInstanceOf(GoogleError);
    expect(error.kind).toBe('reconnect');
    expect(error.message).toBe('Google: reconnect');
    expect(JSON.stringify(error) + String(error.stack)).not.toContain('secret-refresh-token');
  } finally {
    globalThis.fetch = real;
  }
});

// ---------- How much one person may ask ----------

for (const kind of ['Postgres', 'memory'] as const) {
  test(`reads are counted per person, in the store, and refused past the allowance (${kind})`, async () => {
    const store = kind === 'Postgres' ? (await postgres()).store : memoryStore();
    const few = { units: 5, seconds: 60 };
    // Nobody connected: nothing to count against.
    expect(await store.spend('user-1', 'google', 1, few)).toBeNull();
    await store.save('user-1', 'google', 'sealed-1', 'scope');
    await store.save('user-2', 'google', 'sealed-2', 'scope');

    // The connection comes back with the count, in one step.
    const first = (await store.spend('user-1', 'google', 2, few))!;
    expect(first.connection).toEqual({ subject: 'user-1', provider: 'google', sealedToken: 'sealed-1', scope: 'scope', status: 'active' });
    expect(first.allowed).toBe(true);
    expect((await store.spend('user-1', 'google', 3, few))!.allowed).toBe(true); // 5 of 5
    const over = (await store.spend('user-1', 'google', 1, few))!; // 6
    expect(over.allowed).toBe(false);
    expect(over.retryAfter).toBeGreaterThan(0);
    expect(over.retryAfter).toBeLessThanOrEqual(60);
    expect((await store.spend('user-1', 'google', 1, few))!.allowed).toBe(false);
    // One request too large for what is left is refused whole.
    expect((await store.spend('user-2', 'google', 6, few))!.allowed).toBe(false);

    // Connecting again does not buy a fresh allowance.
    await store.save('user-1', 'google', 'sealed-1b', 'scope');
    expect((await store.spend('user-1', 'google', 1, few))!.allowed).toBe(false);
  });

  test(`the allowance is whole again when its window ends, and each person has their own (${kind})`, async () => {
    const store = kind === 'Postgres' ? (await postgres()).store : memoryStore();
    const brief = { units: 2, seconds: 1 };
    await store.save('user-1', 'google', 'sealed-1', 'scope');
    await store.save('user-2', 'google', 'sealed-2', 'scope');
    expect((await store.spend('user-1', 'google', 2, brief))!.allowed).toBe(true);
    expect((await store.spend('user-1', 'google', 1, brief))!.allowed).toBe(false);
    // Someone else is not affected by it.
    expect((await store.spend('user-2', 'google', 2, brief))!.allowed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await store.spend('user-1', 'google', 2, brief))!.allowed).toBe(true);
    expect((await store.spend('user-1', 'google', 1, brief))!.allowed).toBe(false);
  });

  test(`requests arriving together cannot all slip under the limit (${kind})`, async () => {
    const store = kind === 'Postgres' ? (await postgres()).store : memoryStore();
    await store.save('user-1', 'google', 'sealed-1', 'scope');
    const answers = await Promise.all(Array.from({ length: 12 }, () => store.spend('user-1', 'google', 1, { units: 5, seconds: 60 })));
    expect(answers.filter((answer) => answer!.allowed)).toHaveLength(5);
  });
}

// ---------- What is asked of Google, and for how long ----------

const CLIENT = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://app.koyomi.guru/api/google/callback', endpoints: googleEndpoints() };

/** Stands in for the network: records every address asked for, and answers as told. */
async function withGoogle<T>(answer: (url: URL, init: RequestInit) => Response | Promise<Response>, run: (asked: URL[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const asked: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    asked.push(url);
    return answer(url, init);
  }) as typeof fetch;
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = real;
  }
}
const SPAN = { timeMin: '2026-09-01T21:00:00.000Z', timeMax: '2027-04-14T21:00:00.000Z' };

test('a calendar that never ends is not read for ever', async () => {
  // Google always says there is another page.
  const endless = () => Response.json({ items: [{ id: 'e', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } }], nextPageToken: 'more', nextSyncToken: 'cursor' });
  await withGoogle(endless, async (asked) => {
    const read = await listEvents(CLIENT, 'token', 'me@example.test', SPAN, null);
    expect(asked).toHaveLength(MAX_EVENT_PAGES);
    expect(read.items).toHaveLength(MAX_EVENT_PAGES);
    // Cut short, so not to be trusted as complete: no cursor, and the next reading starts again.
    expect(read.nextSyncToken).toBeNull();
    for (const url of asked) expect(url.searchParams.get('maxResults')).toBe('2500');
  });
  await withGoogle(() => Response.json({ items: [{ id: 'c' }], nextPageToken: 'more' }), async (asked) => {
    expect(await listCalendars(CLIENT, 'token')).toHaveLength(MAX_CALENDAR_PAGES);
    expect(asked).toHaveLength(MAX_CALENDAR_PAGES);
  });
  // One that does end is read to the end, and keeps its cursor.
  let page = 0;
  await withGoogle(
    () => Response.json(++page < 3 ? { items: [{ id: `e${page}` }], nextPageToken: 'more' } : { items: [{ id: 'last' }], nextSyncToken: 'cursor' }),
    async () => expect(await listEvents(CLIENT, 'token', 'me@example.test', SPAN, null)).toMatchObject({ nextSyncToken: 'cursor', items: [{ id: 'e1' }, { id: 'e2' }, { id: 'last' }] }),
  );
});

test('nothing a browser sends can change where Koyomi asks: only Google, only the calendar', async () => {
  const hostile = ['../../../oauth2/v1/tokeninfo', 'https://evil.example/steal', '//evil.example', 'a/b?c=d#e', '..%2f..%2fusers%2fme%2fsettings', 'me@example.test/events/../../acl'];
  await withGoogle(
    () => Response.json({ items: [] }),
    async (asked) => {
      for (const id of hostile) await listEvents(CLIENT, 'token', id, SPAN, null);
      expect(asked).toHaveLength(hostile.length);
      asked.forEach((url, i) => {
        expect(url.origin).toBe('https://www.googleapis.com');
        // The id is one path segment, exactly as sent, and the path ends at /events.
        const [, segment] = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname) ?? [];
        expect(decodeURIComponent(segment ?? ''), hostile[i]).toBe(hostile[i]);
        expect(url.hash).toBe('');
        expect([...url.searchParams.keys()].sort()).toEqual(['fields', 'maxResults', 'singleEvents', 'timeMax', 'timeMin']);
      });
    },
  );
  // A cursor and a page token are sent as values, never as part of the address.
  await withGoogle(
    () => Response.json({ items: [] }),
    async (asked) => {
      await listEvents(CLIENT, 'token', 'me@example.test', SPAN, '&calendarId=other&access_token=x');
      expect(asked[0].pathname).toBe('/calendar/v3/calendars/me%40example.test/events');
      expect(asked[0].searchParams.get('syncToken')).toBe('&calendarId=other&access_token=x');
      expect(asked[0].searchParams.has('access_token')).toBe(false);
      expect(asked[0].searchParams.has('timeMin')).toBe(false);
    },
  );
});

test('only a missing permission asks the person to reconnect: the API switched off for the project does not', async () => {
  // Google's own words for each, as the Calendar API sends them with a 403.
  const forbidden = (reason: string, detail: string) =>
    Response.json({ error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ domain: 'global', reason }], details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: detail }] } }, { status: 403 });
  const kind = (answer: Response) => withGoogle(() => answer, async () => (await listCalendars(CLIENT, 'token').catch((e) => e)).kind);
  const logged: string[] = [];
  const real = console.error;
  console.error = (line: string) => void logged.push(line);
  try {
    // The Calendar API is not enabled in the app's own Google Cloud project. Consenting again
    // cannot mend that, so the connection must not be marked as needing it.
    expect(await kind(forbidden('accessNotConfigured', 'SERVICE_DISABLED'))).toBe('busy');
    // It is the operator's to mend, so the log says what to switch on, and nothing else.
    expect(logged).toEqual(['[calendars] google: Error: the Google Calendar API is not enabled for this app’s Google Cloud project']);
    // Limits pass by themselves.
    expect(await kind(forbidden('rateLimitExceeded', 'RATE_LIMIT_EXCEEDED'))).toBe('busy');
    expect(await kind(Response.json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, { status: 403 }))).toBe('busy');
    expect(logged).toHaveLength(1);
    // A permission that was never granted is the one thing here only the person can mend.
    expect(await kind(forbidden('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'))).toBe('reconnect');
    expect(await kind(Response.json({ error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }, { status: 403 }))).toBe('reconnect');
    // And a token Google no longer honours, as before.
    expect(await kind(Response.json({ error: { code: 401, status: 'UNAUTHENTICATED' } }, { status: 401 }))).toBe('reconnect');
  } finally {
    console.error = real;
  }
});

test('a request Google does not answer is given up on', async () => {
  // A network that never answers, but lets go when told to.
  const silent = (_: URL, init: RequestInit) =>
    new Promise<Response>((_, reject) => {
      const stop = () => reject(new DOMException('aborted', 'AbortError'));
      if (init.signal?.aborted) stop();
      init.signal?.addEventListener('abort', stop);
    });
  await withGoogle(silent, async () => {
    const started = Date.now();
    // The whole job has 50ms left.
    const error = await listEvents(CLIENT, 'token', 'me@example.test', SPAN, null, AbortSignal.timeout(50)).catch((e) => e);
    expect(error).toBeInstanceOf(GoogleError);
    expect(error.kind).toBe('busy');
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await listCalendars(CLIENT, 'token', AbortSignal.abort()).catch((e) => e)).kind).toBe('busy');
  });
});

