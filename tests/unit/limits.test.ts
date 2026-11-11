import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from '@playwright/test';
import { accessPolicy, mayShare, type AiConfig } from '../../lib/server/ai/config';
import {
  CLIENT_ALLOWANCE,
  GRANT_ALLOWANCE,
  PERSON_ALLOWANCE,
  REGISTRATION_SOURCE_ALLOWANCE,
  TEST_SOURCE_HEADER,
  limitKey,
  sharedClient,
  sourceOf,
  spendCallIn,
} from '../../lib/server/ai/limits';
import { memoryAiStore, sqlAiStore, type AiStore } from '../../lib/server/ai/store';
import { sqlStore, type Sql } from '../../lib/server/connections';

// Phase 8B (docs/MCP.md, "Limits" and "Public access"): who may use AI access and whether with
// Google calendars, the source a registration is counted under, and the limits themselves,
// counted in the database so that they hold across every server at once. The concurrency tests
// fire many spends together, at one store and at two stores on one database (two servers), and
// ask for exactly the allowance to get through.

const KEY = '0123456789abcdef'.repeat(4);
const config: AiConfig = {
  connections: { appUrl: 'https://app.koyomi.guru', tokenKey: KEY, database: 'memory', google: null, microsoft: null, yahoo: null, link: null },
  issuer: 'https://app.koyomi.guru',
  resource: 'https://app.koyomi.guru/mcp',
  allowed: () => true,
  access: () => ({ allowed: true, google: true, via: 'allowlist' }),
};

test.describe('public access', () => {
  const ON = { VERCEL: '1', KOYOMI_MCP_ALLOWLIST: 'owner' };

  test('off unless deliberately on: the allowlist alone, as today', () => {
    const access = accessPolicy(ON);
    expect(access('owner')).toEqual({ allowed: true, google: true, via: 'allowlist' });
    for (const subject of ['someone-else', 'owner2', 'OWNER', '', null, undefined]) expect(access(subject), String(subject)).toEqual({ allowed: false, google: false, via: 'none' });
  });

  test('an unset, empty or invalid setting fails closed; only "on" opens', () => {
    for (const value of [undefined, '', ' ', 'true', 'TRUE', 'On', 'ON', 'yes', '1', 'enabled', 'on,', 'o n', 'off']) {
      const access = accessPolicy({ ...ON, KOYOMI_MCP_PUBLIC: value, KOYOMI_MCP_GOOGLE_PUBLIC: 'on' });
      expect(access('someone-else'), JSON.stringify(value)).toEqual({ allowed: false, google: false, via: 'none' });
    }
    // White space around it aside, as KOYOMI_MCP itself.
    for (const value of ['on', ' on', 'on\n']) expect(accessPolicy({ ...ON, KOYOMI_MCP_PUBLIC: value })('someone-else').allowed, JSON.stringify(value)).toBe(true);
  });

  test('an empty allowlist is nobody, never everyone', () => {
    for (const list of [undefined, '', ' , ']) {
      const access = accessPolicy({ VERCEL: '1', KOYOMI_MCP_ALLOWLIST: list });
      expect(access('anyone').allowed, JSON.stringify(list)).toBe(false);
    }
  });

  test('public access lets in everyone else, without Google calendars until Google is opened too', () => {
    const open = accessPolicy({ ...ON, KOYOMI_MCP_PUBLIC: 'on' });
    expect(open('someone-else')).toEqual({ allowed: true, google: false, via: 'public' });
    // The allowlist is unchanged by it: its people keep Google.
    expect(open('owner')).toEqual({ allowed: true, google: true, via: 'allowlist' });
    for (const value of [undefined, '', 'true', 'ON', 'yes']) expect(accessPolicy({ ...ON, KOYOMI_MCP_PUBLIC: 'on', KOYOMI_MCP_GOOGLE_PUBLIC: value })('someone-else').google, JSON.stringify(value)).toBe(false);
    expect(accessPolicy({ ...ON, KOYOMI_MCP_PUBLIC: 'on', KOYOMI_MCP_GOOGLE_PUBLIC: 'on' })('someone-else')).toEqual({ allowed: true, google: true, via: 'public' });
    // Google's switch means nothing while public access is off.
    expect(accessPolicy({ ...ON, KOYOMI_MCP_GOOGLE_PUBLIC: 'on' })('someone-else').allowed).toBe(false);
  });

  test('the providers a person may share: Google only where opened; Microsoft, Yahoo and links wherever AI access is allowed', () => {
    const publicOnly = { allowed: true, google: false, via: 'public' } as const;
    expect(mayShare(publicOnly, 'google')).toBe(false);
    for (const provider of ['microsoft', 'yahoo', 'link'] as const) expect(mayShare(publicOnly, provider)).toBe(true);
    for (const provider of ['google', 'microsoft', 'yahoo', 'link'] as const) {
      expect(mayShare({ allowed: true, google: true, via: 'allowlist' }, provider)).toBe(true);
      expect(mayShare({ allowed: false, google: false, via: 'none' }, provider)).toBe(false);
      // Not allowed at all is not allowed, whatever else is said.
      expect(mayShare({ allowed: false, google: true, via: 'none' }, provider)).toBe(false);
    }
  });

  test('the browser tests’ public stand-ins are let in only off Vercel', () => {
    expect(accessPolicy({ KOYOMI_TEST_AI_PUBLIC_PREFIX: 'public-' })('public-a1')).toEqual({ allowed: true, google: false, via: 'public' });
    expect(accessPolicy({ KOYOMI_TEST_AI_PUBLIC_PREFIX: 'public-', VERCEL: '1' })('public-a1').allowed).toBe(false);
    expect(accessPolicy({ KOYOMI_TEST_AI_PUBLIC_PREFIX: ' ' })('anyone').allowed).toBe(false);
  });
});

test.describe('the source a registration is counted under', () => {
  const request = (headers: Record<string, string>) => new Request('https://app.koyomi.guru/api/oauth/register', { method: 'POST', headers });

  test('on Vercel: Vercel’s own account of the client’s address, which a client cannot choose', () => {
    expect(sourceOf(request({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }), { VERCEL: '1' })).toBe('203.0.113.7');
    expect(sourceOf(request({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }), { VERCEL: '1' })).toBe('198.51.100.1');
    expect(sourceOf(request({ 'x-real-ip': '2001:db8::1' }), { VERCEL: '1' })).toBe('2001:db8::1');
    // Not an address: none.
    for (const value of ['', 'nonsense', '999.1.1.1', '203.0.113.7; drop table']) expect(sourceOf(request({ 'x-real-ip': value }), { VERCEL: '1' }), value).toBeNull();
    // The test header means nothing on Vercel, whatever is set.
    expect(sourceOf(request({ [TEST_SOURCE_HEADER]: 'chosen' }), { VERCEL: '1', KOYOMI_TEST_TRUST_SOURCE: 'on' })).toBeNull();
  });

  test('anywhere else no header is taken: every request is one source, which is only stricter', () => {
    const tries: Record<string, string>[] = [{ 'x-real-ip': '203.0.113.7' }, { 'x-forwarded-for': '198.51.100.1' }, { [TEST_SOURCE_HEADER]: 'chosen' }];
    for (const headers of tries) expect(sourceOf(request(headers), {}), JSON.stringify(headers)).toBeNull();
    // The browser tests name theirs, only where their switch is on.
    expect(sourceOf(request({ [TEST_SOURCE_HEADER]: 'test-a' }), { KOYOMI_TEST_TRUST_SOURCE: 'on' })).toBe('test-a');
    expect(sourceOf(request({ [TEST_SOURCE_HEADER]: 'has space' }), { KOYOMI_TEST_TRUST_SOURCE: 'on' })).toBeNull();
  });
});

test('limits are kept under a keyed hash: never the person, the client or the address itself', () => {
  const keys = [limitKey(config, 'person', 'subject-123'), limitKey(config, 'client', 'kc_abc'), limitKey(config, 'source', '203.0.113.7')];
  for (const key of keys) expect(key).toMatch(/^(person|client|source):[A-Za-z0-9_-]{32}$/);
  expect(keys.join(' ')).not.toMatch(/subject-123|kc_abc|203\.0\.113\.7/);
  expect(limitKey(config, 'person', 'subject-123')).toBe(keys[0]);
  // The same value of another kind is another limit; another key gives another hash.
  expect(limitKey(config, 'client', 'subject-123')).not.toBe(keys[0].replace('person', 'client'));
  expect(limitKey({ ...config, connections: { ...config.connections, tokenKey: 'f'.repeat(64) } }, 'person', 'subject-123')).not.toBe(keys[0]);
  // A platform's client (a metadata document) is shared by all its users; a registered one is not.
  expect(sharedClient('https://chatgpt.com/oauth/client.json')).toBe(true);
  expect(sharedClient('https://claude.ai/oauth/mcp-oauth-client-metadata')).toBe(true);
  expect(sharedClient('kc_YjCTZdNvX6MkWTk0mjZQmUl')).toBe(false);
});

const MIGRATIONS = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
async function postgres() {
  const db = new PGlite();
  for (const file of MIGRATIONS) await db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const sql: Sql = async (strings, ...values) => (await db.query(strings.reduce((text, part, i) => `${text}$${i}${part}`), values)).rows as Record<string, unknown>[];
  return { db, sql };
}

test('migration 005 adds one table of counters, applies again and again, and holds nothing but a hash, a window and a count', async () => {
  const { db } = await postgres();
  for (const file of MIGRATIONS) await db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const columns = (await db.query<{ column_name: string; data_type: string }>(`select column_name, data_type from information_schema.columns where table_name = 'ai_limits' order by ordinal_position`)).rows;
  expect(columns.map((c) => `${c.column_name} ${c.data_type}`)).toEqual(['limit_key text', 'window_started_at timestamp with time zone', 'spent integer']);
});

for (const kind of ['Postgres', 'memory'] as const) {
  test.describe(`limits (${kind})`, () => {
    async function stores(): Promise<{ one: AiStore; two: AiStore; sql: Sql | null; connections?: ReturnType<typeof sqlStore> }> {
      if (kind === 'memory') {
        const store = memoryAiStore();
        return { one: store, two: store, sql: null };
      }
      const { sql } = await postgres();
      // Two stores on one database: two servers.
      return { one: sqlAiStore(sql), two: sqlAiStore(sql), sql, connections: sqlStore(sql) };
    }

    test('many spends at once, at two servers: exactly the allowance gets through, and the rest are told when to try again', async () => {
      const { one, two } = await stores();
      const allowance = { units: 30, seconds: 60 };
      const results = await Promise.all(Array.from({ length: 50 }, (_, i) => (i % 2 ? one : two).spendLimit('person:k1', 1, allowance)));
      expect(results.filter((r) => r.allowed)).toHaveLength(30);
      expect(results.filter((r) => !r.allowed)).toHaveLength(20);
      for (const r of results) expect(r.retryAfter).toBeGreaterThanOrEqual(1);
      for (const r of results) expect(r.retryAfter).toBeLessThanOrEqual(60);
      // Another key is another limit, untouched.
      expect((await one.spendLimit('person:k2', 1, allowance)).allowed).toBe(true);
    });

    test('exactly at the boundary: the last unit of the allowance is allowed, the next is not, and a new window starts afresh', async () => {
      const { one, sql } = await stores();
      const allowance = { units: 3, seconds: 60 };
      expect((await one.spendLimit('k', 1, allowance)).allowed).toBe(true);
      expect((await one.spendLimit('k', 2, allowance)).allowed).toBe(true);
      expect((await one.spendLimit('k', 1, allowance)).allowed).toBe(false);
      if (sql) {
        // The window ends (moved back past its length): counting starts again.
        await sql`update ai_limits set window_started_at = now() - interval '61 seconds' where limit_key = 'k'`;
        expect((await one.spendLimit('k', 1, allowance)).allowed).toBe(true);
        expect((await one.spendLimit('k', 2, allowance)).allowed).toBe(true);
        expect((await one.spendLimit('k', 1, allowance)).allowed).toBe(false);
        // A day later it is tidied away; a current one is kept.
        await one.spendLimit('fresh', 1, allowance);
        await sql`update ai_limits set window_started_at = now() - interval '25 hours' where limit_key = 'k'`;
        expect(await one.pruneLimits()).toBe(1);
        expect((await sql`select limit_key from ai_limits order by limit_key`).map((r) => r.limit_key)).toEqual(['fresh']);
      }
    });

    test('many people on one platform’s client do not limit each other; one person’s assistants share one allowance', async () => {
      const { one, two, connections } = await stores();
      // Grants need rows to spend against.
      const grant = async (store: AiStore, subject: string, clientId: string) => {
        const connectionId = connections ? await connections.save(subject, 'link', `acct-${subject}-${clientId}`, 'sealed', 'scope') : '00000000-0000-4000-8000-000000000000';
        return store.createGrant({ subject, clientId, clientLabel: 'X', redirectHost: 'x.example', timeZone: 'UTC', calendars: [{ connectionId, fingerprint: 'fp' }] });
      };
      const CHATGPT = 'https://chatgpt.com/oauth/client.json';
      const busyGrant = { id: await grant(one, 'busy-person', CHATGPT), subject: 'busy-person', clientId: CHATGPT };
      const otherGrant = { id: await grant(one, 'other-person', CHATGPT), subject: 'other-person', clientId: CHATGPT };
      // The busy person's assistant uses its whole allowance, at two servers.
      const busy = await Promise.all(Array.from({ length: GRANT_ALLOWANCE.units + 10 }, (_, i) => spendCallIn(i % 2 ? one : two, config, busyGrant)));
      expect(busy.filter((r) => r && r.refused === null)).toHaveLength(GRANT_ALLOWANCE.units);
      expect(busy.filter((r) => r && r.refused === 'grant')).toHaveLength(10);
      // Someone else on the same client is untouched.
      expect(await spendCallIn(two, config, otherGrant)).toEqual({ refused: null });

      // One person's assistants together share the person's allowance.
      const claude = { id: await grant(one, 'many-assistants', 'https://claude.ai/oauth/mcp-oauth-client-metadata'), subject: 'many-assistants', clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata' };
      const chatgpt = { id: await grant(one, 'many-assistants', CHATGPT), subject: 'many-assistants', clientId: CHATGPT };
      const grok = { id: await grant(one, 'many-assistants', 'kc_grok_registration'), subject: 'many-assistants', clientId: 'kc_grok_registration' };
      const all = await Promise.all(Array.from({ length: 75 }, (_, i) => spendCallIn(i % 2 ? one : two, config, [claude, chatgpt, grok][i % 3])));
      expect(all.filter((r) => r && r.refused === null)).toHaveLength(PERSON_ALLOWANCE.units);
      expect(all.filter((r) => r && r.refused === 'person')).toHaveLength(75 - PERSON_ALLOWANCE.units);
      // A revoked grant spends nothing at all, of any limit.
      await one.revokeGrant(grok.id);
      expect(await spendCallIn(one, config, grok)).toBeNull();
    });

    test('one self-registered client is limited across all the people who use it', async () => {
      const { one, two, connections } = await stores();
      const SHARED_APP = 'kc_one_installed_app';
      const people = Array.from({ length: 12 }, (_, i) => `person-${i}`);
      const grants = [];
      for (const subject of people) {
        const connectionId = connections ? await connections.save(subject, 'link', `acct-${subject}`, 'sealed', 'scope') : '00000000-0000-4000-8000-000000000000';
        grants.push({ id: await one.createGrant({ subject, clientId: SHARED_APP, clientLabel: 'X', redirectHost: 'x.example', timeZone: 'UTC', calendars: [{ connectionId, fingerprint: 'fp' }] }), subject, clientId: SHARED_APP });
      }
      // 12 people × 26 calls = 312: under each grant's and each person's allowance, over the client's 300.
      const calls = grants.flatMap((g) => Array.from({ length: 26 }, () => g));
      const results = await Promise.all(calls.map((g, i) => spendCallIn(i % 2 ? one : two, config, g)));
      expect(results.filter((r) => r && r.refused === null)).toHaveLength(CLIENT_ALLOWANCE.units);
      expect(results.filter((r) => r && r.refused === 'client')).toHaveLength(312 - CLIENT_ALLOWANCE.units);
      expect(results.filter((r) => r && (r.refused === 'grant' || r.refused === 'person'))).toHaveLength(0);
    });

    test('registrations from one source are counted together, at any server', async () => {
      const { one, two } = await stores();
      const from = (source: string) => limitKey(config, 'source', source);
      const results = await Promise.all(Array.from({ length: 15 }, (_, i) => (i % 2 ? one : two).spendLimit(from('203.0.113.7'), 1, REGISTRATION_SOURCE_ALLOWANCE)));
      expect(results.filter((r) => r.allowed)).toHaveLength(REGISTRATION_SOURCE_ALLOWANCE.units);
      expect((await one.spendLimit(from('198.51.100.9'), 1, REGISTRATION_SOURCE_ALLOWANCE)).allowed).toBe(true);
    });
  });
}
