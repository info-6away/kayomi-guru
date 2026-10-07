import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from '@playwright/test';
import { memoryStore, sqlStore, type ConnectionStore, type Sql } from '../../lib/server/connections';
import { connectionsConfig } from '../../lib/server/env';
import { SCOPES, authorizeUrl, googleEndpoints, pkce } from '../../lib/server/google';
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
  await db.exec(readFileSync('migrations/001_calendar_connections.sql', 'utf8'));
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
  expect(Object.keys(row).sort()).toEqual(['auth_subject', 'created_at', 'provider', 'refresh_token_sealed', 'scope', 'status', 'updated_at']);
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

test('calendar connections are off unless every setting is there', () => {
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
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});
