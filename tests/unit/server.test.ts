import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from '@playwright/test';
import { accountKey, isConnectionId, memoryStore, sealContext, sqlStore, type Sql } from '../../lib/server/connections';
import { connectionsConfig, signInConfigured } from '../../lib/server/env';
import { FLOW_SECONDS, beginFlow, finishFlow } from '../../lib/server/flow';
import { GoogleError, MAX_CALENDAR_PAGES, MAX_EVENT_PAGES, SCOPES, authorizeUrl, googleEndpoints, listCalendars, listEvents, pkce, primaryCalendarId, refreshAccess } from '../../lib/server/google';
import { describe } from '../../lib/server/log';
import { fingerprint, open, seal } from '../../lib/server/seal';

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

test('an account is known to the table by a word that only this server can make, and never by its address', () => {
  const word = accountKey(KEY, 'user-1', 'google', 'someone@example.com');
  // The same person and the same account always come to the same word, however the address is written.
  expect(accountKey(KEY, 'user-1', 'google', 'someone@example.com')).toBe(word);
  expect(accountKey(KEY, 'user-1', 'google', ' Someone@Example.com ')).toBe(word);
  // Another account, another person, or another server's key: another word.
  expect(accountKey(KEY, 'user-1', 'google', 'someone.else@example.com')).not.toBe(word);
  expect(accountKey(KEY, 'user-2', 'google', 'someone@example.com')).not.toBe(word);
  expect(accountKey(OTHER_KEY, 'user-1', 'google', 'someone@example.com')).not.toBe(word);
  // It gives nothing of the address away: 256 bits that say nothing by themselves.
  expect(word).toMatch(/^[\w-]{43}$/);
  for (const part of ['someone', 'example', 'user-1']) expect(word).not.toContain(part);
  // It is not the plain hash of the address, which anyone could make from a guess.
  expect(word).not.toBe(createHash('sha256').update('someone@example.com').digest('base64url'));
  expect(fingerprint('someone@example.com', KEY, 'one use')).not.toBe(fingerprint('someone@example.com', KEY, 'another use'));
  expect(() => fingerprint('x', 'abc123', 'c')).toThrow(/64 hexadecimal/);

  // A token is sealed for the account's row and no other: not another account of the same person's.
  const row = (account: string) => ({ subject: 'user-1', provider: 'google' as const, accountKey: accountKey(KEY, 'user-1', 'google', account) });
  const sealed = seal('1//refresh-token', KEY, sealContext(row('one@example.com')));
  expect(open(sealed, KEY, sealContext(row('one@example.com')))).toBe('1//refresh-token');
  expect(() => open(sealed, KEY, sealContext(row('two@example.com')))).toThrow();
  expect(() => open(sealed, KEY, sealContext({ ...row('one@example.com'), subject: 'user-2' }))).toThrow();
});

const MIGRATIONS = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
/** The real table, created by the real migrations, in a Postgres that runs inside the test. */
async function postgres(files = MIGRATIONS) {
  const db = new PGlite();
  const migrate = async (names = files) => {
    for (const file of names) await db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  };
  await migrate();
  const sql: Sql = async (strings, ...values) => (await db.query(strings.reduce((text, part, i) => `${text}$${i}${part}`), values)).rows as Record<string, unknown>[];
  const rows = async () => (await db.query('select * from calendar_connections order by auth_subject, created_at')).rows as Record<string, unknown>[];
  return { db, migrate, store: sqlStore(sql), rows };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A connection id that is well formed and belongs to nobody. */
const NOBODYS = '00000000-0000-4000-8000-000000000000';

for (const kind of ['Postgres', 'memory'] as const) {
  test(`the connection store keeps one sealed token for each account a person connects (${kind})`, async () => {
    const store = kind === 'Postgres' ? (await postgres()).store : memoryStore();
    expect(await store.list('user-1')).toEqual([]);
    expect(await store.get('user-1', NOBODYS)).toBeNull();

    // One person, two accounts at the same provider; and someone else with the very same account.
    const personal = await store.save('user-1', 'google', 'account-a', 'sealed-1a', 'scope-a scope-b');
    const work = await store.save('user-1', 'google', 'account-b', 'sealed-1b', 'scope-a scope-b');
    const theirs = await store.save('user-2', 'google', 'account-a', 'sealed-2a', 'scope-a');
    for (const id of [personal, work, theirs]) expect(id).toMatch(UUID);
    expect(new Set([personal, work, theirs]).size).toBe(3);
    expect(await store.get('user-1', personal)).toEqual({ id: personal, subject: 'user-1', provider: 'google', accountKey: 'account-a', sealedToken: 'sealed-1a', scope: 'scope-a scope-b', status: 'active' });
    // In the order they were connected.
    expect((await store.list('user-1')).map((c) => [c.id, c.accountKey, c.sealedToken])).toEqual([[personal, 'account-a', 'sealed-1a'], [work, 'account-b', 'sealed-1b']]);
    expect((await store.list('user-2')).map((c) => c.id)).toEqual([theirs]);

    // A connection is its owner's alone: named by anyone else, it is not there.
    expect(await store.get('user-2', personal)).toBeNull();
    expect(await store.spend('user-2', personal, 1, { units: 5, seconds: 60 })).toBeNull();
    await store.setStatus('user-2', personal, 'reconnect');
    await store.remove('user-2', personal);
    expect(await store.get('user-1', personal)).toMatchObject({ sealedToken: 'sealed-1a', status: 'active' });
    // Something that is not an id at all is never put to the database, and finds nothing.
    for (const bad of ['', 'personal', "'; drop table calendar_connections; --", `${personal}x`]) {
      expect(await store.get('user-1', bad), bad).toBeNull();
      expect(await store.spend('user-1', bad, 1, { units: 5, seconds: 60 }), bad).toBeNull();
      await store.setStatus('user-1', bad, 'reconnect');
      await store.remove('user-1', bad);
    }
    expect(await store.list('user-1')).toHaveLength(2);

    // The provider refuses one account's token: remembered for that account, and not the other.
    await store.setStatus('user-1', personal, 'reconnect');
    expect((await store.list('user-1')).map((c) => c.status)).toEqual(['reconnect', 'active']);
    // Connecting the same account again is the same connection: its token is replaced, that is
    // cleared, and nothing is doubled. The other account is exactly as it was.
    expect(await store.save('user-1', 'google', 'account-a', 'sealed-1a-new', 'scope-a scope-b')).toBe(personal);
    expect((await store.list('user-1')).map((c) => [c.id, c.sealedToken, c.status])).toEqual([[personal, 'sealed-1a-new', 'active'], [work, 'sealed-1b', 'active']]);

    // Disconnecting one account removes that row and no other: not the person's other account,
    // and not someone else's connection to the same account.
    await store.remove('user-1', personal);
    expect(await store.get('user-1', personal)).toBeNull();
    expect((await store.list('user-1')).map((c) => [c.id, c.sealedToken])).toEqual([[work, 'sealed-1b']]);
    expect(await store.get('user-2', theirs)).toMatchObject({ sealedToken: 'sealed-2a' });
    await store.remove('user-1', personal);
    await store.setStatus('nobody', NOBODYS, 'reconnect');
    expect(await store.list('nobody')).toEqual([]);
    // Connected again after that, it is a new connection, with a name of its own.
    expect(await store.save('user-1', 'google', 'account-a', 'sealed-again', 'scope')).not.toBe(personal);
  });
}

for (const kind of ['Postgres', 'memory'] as const) {
  test(`a calendar link given a new link keeps its connection, and one person's links never share a key (${kind})`, async () => {
    const store = kind === 'Postgres' ? (await postgres()).store : memoryStore();
    const work = await store.save('user-1', 'link', 'key-work', 'sealed-work', 'link');
    const family = await store.save('user-1', 'link', 'key-family', 'sealed-family', 'link');
    const theirs = await store.save('user-2', 'link', 'key-new', 'sealed-theirs', 'link');
    await store.setStatus('user-1', work, 'reconnect');

    // In place: the same connection, its new key and secret, and active again.
    expect(await store.relink('user-1', work, 'key-new', 'sealed-new')).toBe('done');
    expect(await store.get('user-1', work)).toMatchObject({ id: work, provider: 'link', accountKey: 'key-new', sealedToken: 'sealed-new', status: 'active' });
    // The same link again is the same connection's own.
    expect(await store.relink('user-1', work, 'key-new', 'sealed-newer')).toBe('done');
    // Another of the person's calendars already has that link: refused, and nothing changes.
    expect(await store.relink('user-1', work, 'key-family', 'sealed-x')).toBe('taken');
    expect(await store.get('user-1', work)).toMatchObject({ accountKey: 'key-new', sealedToken: 'sealed-newer' });
    // Someone else's connection, or none at all, is not there to change.
    expect(await store.relink('user-2', work, 'key-z', 'sealed-z')).toBe('missing');
    expect(await store.relink('user-1', NOBODYS, 'key-z', 'sealed-z')).toBe('missing');
    expect(await store.relink('user-1', 'not-an-id', 'key-z', 'sealed-z')).toBe('missing');
    expect(await store.get('user-2', theirs)).toMatchObject({ accountKey: 'key-new', sealedToken: 'sealed-theirs' });
    expect((await store.list('user-1')).map((c) => [c.id, c.accountKey])).toEqual([
      [work, 'key-new'],
      [family, 'key-family'],
    ]);
  });
}

test('the table holds a sealed token and nothing that names the person, their account or their calendar', async () => {
  const { store, rows } = await postgres();
  const row = { subject: '3f0c7c1e-subject', provider: 'google' as const, accountKey: accountKey(KEY, '3f0c7c1e-subject', 'google', 'someone@example.com') };
  await store.save(row.subject, row.provider, row.accountKey, seal('1//refresh-token', KEY, sealContext(row)), SCOPES.join(' '));
  const [stored] = await rows();
  expect(Object.keys(stored).sort()).toEqual([
    'auth_subject',
    'connection_id',
    'created_at',
    'provider',
    'provider_account_id',
    'refresh_token_sealed',
    'scope',
    'status',
    'updated_at',
    'window_spent',
    'window_started_at',
  ]);
  const everything = JSON.stringify(stored);
  for (const secret of ['refresh-token', 'someone', 'example.com']) expect(everything).not.toContain(secret);
});

// ---------- From one account for each person to several ----------

test('the table’s rule is one row for each account a person connects, and the database holds it to that', async () => {
  const { db, store } = await postgres();
  const keys = (await db.query(`select indexdef from pg_indexes where tablename = 'calendar_connections' order by indexname`)).rows.map((row) => (row as { indexdef: string }).indexdef);
  // Named by its own id, and unique by person, provider and account. Nothing else is unique:
  // in particular not person and provider, which was the rule before.
  expect(keys).toHaveLength(2);
  expect(keys.join('\n')).toMatch(/UNIQUE INDEX calendar_connections_one_per_account .*\(auth_subject, provider, provider_account_id\)/);
  expect(keys.join('\n')).toMatch(/UNIQUE INDEX calendar_connections_pkey .*\(connection_id\)/);

  // The rule is the database's own, whatever the code above it does.
  const insert = (subject: string, account: string) =>
    db.query(`insert into calendar_connections (auth_subject, provider, provider_account_id, refresh_token_sealed, scope) values ($1, 'google', $2, 'sealed', 'scope')`, [subject, account]);
  await insert('user-1', 'account-a');
  await insert('user-1', 'account-b');
  await insert('user-2', 'account-a');
  await expect(insert('user-1', 'account-a')).rejects.toThrow(/calendar_connections_one_per_account/);
  await expect(db.query(`insert into calendar_connections (auth_subject, provider, refresh_token_sealed, scope) values ('user-3', 'google', 'sealed', 'scope')`)).rejects.toThrow(/provider_account_id/);
  expect(await store.list('user-1')).toHaveLength(2);
});

test('moving to several accounts is applied whole, can be run again, and lets go of rows that cannot say which account they were', async () => {
  // The table as production has it: the first two files, and a connection made under them.
  const { db, migrate, store } = await postgres(MIGRATIONS.slice(0, 2));
  expect(MIGRATIONS.slice(2)).toEqual(['003_many_accounts.sql']);
  await db.query(`insert into calendar_connections (auth_subject, provider, refresh_token_sealed, scope) values ('user-old', 'google', 'sealed-old', 'scope')`);
  await db.query(`update calendar_connections set window_started_at = now(), window_spent = 7`);

  await migrate(MIGRATIONS.slice(2));
  // It had no account to its name and nothing here could ask Google which, so it is gone, and
  // the table is ready: the person connects again, and may connect a second account as well.
  expect(await store.list('user-old')).toEqual([]);
  const first = await store.save('user-old', 'google', 'account-a', 'sealed-a', 'scope');
  const second = await store.save('user-old', 'google', 'account-b', 'sealed-b', 'scope');
  expect((await store.spend('user-old', first, 3, { units: 5, seconds: 60 }))!.allowed).toBe(true);

  // Run again, as the repository's migrations always may be: every file, twice more.
  const before = JSON.stringify((await db.query('select * from calendar_connections order by created_at')).rows);
  await migrate(MIGRATIONS);
  await migrate(MIGRATIONS);
  expect(JSON.stringify((await db.query('select * from calendar_connections order by created_at')).rows)).toBe(before);
  expect((await store.list('user-old')).map((c) => c.id)).toEqual([first, second]);
  // Still held to the rule afterwards, and the count that was under way is still counted.
  expect(await store.save('user-old', 'google', 'account-a', 'sealed-a2', 'scope')).toBe(first);
  expect((await store.spend('user-old', first, 3, { units: 5, seconds: 60 }))!.allowed).toBe(false);
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
    // Which account, then its consent, asked every time: a second account can be chosen, and
    // a first is never taken for granted.
    prompt: 'consent select_account',
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
    expect(config.google!.redirectUri).toBe('https://app.koyomi.guru/api/google/callback');
    expect(config.google!.endpoints.token).toBe('https://oauth2.googleapis.com/token');
    // Microsoft is not set up here, so it is not offered.
    expect(config.microsoft).toBeNull();

    // The stand-ins the browser tests use work on a developer's machine...
    const { DATABASE_URL: _, ...noDatabase } = full;
    const local = withEnv({ ...noDatabase, KOYOMI_TEST_STORE: 'memory', KOYOMI_TEST_GOOGLE_URL: 'http://localhost:9/google' })!;
    expect(local.database).toBe('memory');
    expect(local.google!.endpoints.token).toBe('http://localhost:9/google/token');
    // The in-memory store wins over a database address, so a test run cannot reach a real one.
    expect(withEnv({ ...full, KOYOMI_TEST_STORE: 'memory' })!.database).toBe('memory');
    // ...and are ignored on a deployment, whatever its settings say.
    expect(withEnv({ ...noDatabase, KOYOMI_TEST_STORE: 'memory', VERCEL: '1' })).toBeNull();
    expect(withEnv({ ...full, KOYOMI_TEST_GOOGLE_URL: 'http://localhost:9/google', VERCEL: '1' })!.google!.endpoints.token).toBe('https://oauth2.googleapis.com/token');

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

// ---------- How much may be asked about one account ----------

for (const kind of ['Postgres', 'memory'] as const) {
  test(`reads are counted per account, in the store, and refused past the allowance (${kind})`, async () => {
    const store = kind === 'Postgres' ? (await postgres()).store : memoryStore();
    const few = { units: 5, seconds: 60 };
    // Not a connection of anyone's: nothing to count against.
    expect(await store.spend('user-1', NOBODYS, 1, few)).toBeNull();
    const mine = await store.save('user-1', 'google', 'account-a', 'sealed-1', 'scope');
    const theirs = await store.save('user-2', 'google', 'account-a', 'sealed-2', 'scope');

    // The connection comes back with the count, in one step.
    const first = (await store.spend('user-1', mine, 2, few))!;
    expect(first.connection).toEqual({ id: mine, subject: 'user-1', provider: 'google', accountKey: 'account-a', sealedToken: 'sealed-1', scope: 'scope', status: 'active' });
    expect(first.allowed).toBe(true);
    expect((await store.spend('user-1', mine, 3, few))!.allowed).toBe(true); // 5 of 5
    const over = (await store.spend('user-1', mine, 1, few))!; // 6
    expect(over.allowed).toBe(false);
    expect(over.retryAfter).toBeGreaterThan(0);
    expect(over.retryAfter).toBeLessThanOrEqual(60);
    expect((await store.spend('user-1', mine, 1, few))!.allowed).toBe(false);
    // One request too large for what is left is refused whole.
    expect((await store.spend('user-2', theirs, 6, few))!.allowed).toBe(false);

    // Connecting the same account again does not buy a fresh allowance.
    expect(await store.save('user-1', 'google', 'account-a', 'sealed-1b', 'scope')).toBe(mine);
    expect((await store.spend('user-1', mine, 1, few))!.allowed).toBe(false);
  });

  test(`the allowance is whole again when its window ends, and each account has its own (${kind})`, async () => {
    const store = kind === 'Postgres' ? (await postgres()).store : memoryStore();
    const brief = { units: 2, seconds: 1 };
    const personal = await store.save('user-1', 'google', 'account-a', 'sealed-1a', 'scope');
    const work = await store.save('user-1', 'google', 'account-b', 'sealed-1b', 'scope');
    const theirs = await store.save('user-2', 'google', 'account-a', 'sealed-2', 'scope');
    expect((await store.spend('user-1', personal, 2, brief))!.allowed).toBe(true);
    expect((await store.spend('user-1', personal, 1, brief))!.allowed).toBe(false);
    // The same person's other account is not held back by it, and neither is anyone else.
    expect((await store.spend('user-1', work, 2, brief))!.allowed).toBe(true);
    expect((await store.spend('user-2', theirs, 2, brief))!.allowed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await store.spend('user-1', personal, 2, brief))!.allowed).toBe(true);
    expect((await store.spend('user-1', personal, 1, brief))!.allowed).toBe(false);
  });

  test(`requests arriving together cannot all slip under the limit (${kind})`, async () => {
    const store = kind === 'Postgres' ? (await postgres()).store : memoryStore();
    const id = await store.save('user-1', 'google', 'account-a', 'sealed-1', 'scope');
    const answers = await Promise.all(Array.from({ length: 12 }, () => store.spend('user-1', id, 1, { units: 5, seconds: 60 })));
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

test('which account it is comes from its own calendar: one field, asked with the permission to list calendars', async () => {
  await withGoogle(
    () => Response.json({ id: 'someone@example.com' }),
    async (asked) => {
      expect(await primaryCalendarId(CLIENT, 'token')).toBe('someone@example.com');
      expect(asked).toHaveLength(1);
      // The calendar list, which the first of the two permissions covers. Not a profile, not a
      // sign-in, not an address book: Koyomi asks Google for no permission that would reach one.
      expect(asked[0].origin + asked[0].pathname).toBe('https://www.googleapis.com/calendar/v3/users/me/calendarList/primary');
      expect(Object.fromEntries(asked[0].searchParams)).toEqual({ fields: 'id' });
    },
  );
  for (const scope of SCOPES) expect(scope).not.toMatch(/openid|email|profile|userinfo/);
  // No answer, or an answer that names nothing, is no account: there is nothing to connect it as.
  const kind = (answer: Response) => withGoogle(() => answer, async () => (await primaryCalendarId(CLIENT, 'token').catch((e) => e)).kind);
  expect(await kind(Response.json({}))).toBe('busy');
  expect(await kind(Response.json({ error: { code: 503 } }, { status: 503 }))).toBe('busy');
  expect(await kind(Response.json({ error: { code: 401 } }, { status: 401 }))).toBe('reconnect');
});

test('only something shaped like a connection’s id is ever looked up', () => {
  expect(isConnectionId('3f0c7c1e-8a2b-4c1d-9e0f-123456789abc')).toBe(true);
  for (const bad of [undefined, null, 7, '', 'google', '3f0c7c1e8a2b4c1d9e0f123456789abc', '3F0C7C1E-8A2B-4C1D-9E0F-123456789ABC', ['3f0c7c1e-8a2b-4c1d-9e0f-123456789abc'], '3f0c7c1e-8a2b-4c1d-9e0f-123456789abc ']) {
    expect(isConnectionId(bad), String(bad)).toBe(false);
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

