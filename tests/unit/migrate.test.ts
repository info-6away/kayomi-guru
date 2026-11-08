import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from '@playwright/test';
import { DONE, NO_DATABASE, REFUSED, migrationFiles, planMigration, runMigrations } from '../../scripts/migrate-core.mjs';

// The migration runner (scripts/migrate.mjs, logic in scripts/migrate-core.mjs): `--only <file>`
// sends exactly that file, refuses anything it cannot read for certain before any database is
// reached, and the plain command still sends every file. Against a stand-in that records what is
// sent, against real Postgres (PGlite) on the repository's own migrations, and as the command
// itself. No test here can reach a network database: every DATABASE_URL below is an address
// nothing answers on, and the command is only ever run where it refuses or only shows.

const KNOWN = migrationFiles();
const ONLY = '004_ai_access.sql';
const NOWHERE = 'postgres://nobody:nothing@127.0.0.1:9/none';

test('the migrations are the four this release expects, in order', () => {
  expect(KNOWN).toEqual(['001_calendar_connections.sql', '002_read_allowance.sql', '003_many_accounts.sql', ONLY]);
});

/** Runs the runner against a stand-in database that records each request. */
async function recorded(args: string[], env: Record<string, string | undefined> = { DATABASE_URL: NOWHERE }) {
  const sent: string[] = [];
  const connected: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const code = await runMigrations({
    args,
    env,
    connect: (url) => {
      connected.push(url);
      return { query: async (text) => void sent.push(text) };
    },
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { code, sent, connected, out, err };
}

const fileText = (name: string) => readFileSync(join('migrations', name), 'utf8');

test('--only 004_ai_access.sql sends 004 and nothing else, and says so', async () => {
  for (const args of [['--only', ONLY, '--yes'], ['--yes', '--only', ONLY]]) {
    const run = await recorded(args);
    expect(run.code, args.join(' ')).toBe(DONE);
    expect(run.connected).toEqual([NOWHERE]);
    expect(run.sent).toEqual([fileText(ONLY)]);
    expect(run.err).toEqual([]);
    expect(run.out).toEqual([
      'Database: 127.0.0.1/none',
      `Only ${ONLY}. Not run: 001_calendar_connections.sql, 002_read_allowance.sql, 003_many_accounts.sql.`,
      `applying ${ONLY}`,
      `applied ${ONLY}`,
    ]);
    // The address is never printed whole: it holds the password.
    expect(run.out.join('\n')).not.toContain('nothing');
  }
});

test('without --yes, --only shows what it would send and sends nothing', async () => {
  const run = await recorded(['--only', ONLY]);
  expect(run.code).toBe(DONE);
  expect(run.connected).toEqual([]);
  expect(run.sent).toEqual([]);
  expect(run.out).toEqual([
    'Database: 127.0.0.1/none',
    `Only ${ONLY}. Not run: 001_calendar_connections.sql, 002_read_allowance.sql, 003_many_accounts.sql.`,
    `Nothing was changed. If that is the Koyomi database, run again with: npm run db:migrate -- --only ${ONLY} --yes`,
  ]);
});

test('without --only the command is what it was: every file in order with --yes, nothing without', async () => {
  const all = await recorded(['--yes']);
  expect(all.code).toBe(DONE);
  expect(all.sent).toEqual(KNOWN.map(fileText));
  expect(all.out).toEqual([
    'Database: 127.0.0.1/none',
    `Every migration, in order: ${KNOWN.join(', ')}.`,
    ...KNOWN.flatMap((name) => [`applying ${name}`, `applied ${name}`]),
  ]);
  const shown = await recorded([]);
  expect(shown.code).toBe(DONE);
  expect(shown.connected).toEqual([]);
  expect(shown.out.at(-1)).toBe('Nothing was changed. If that is the Koyomi database, run again with: npm run db:migrate -- --yes');
  // No address: the same message and code as before.
  const none = await recorded(['--yes'], {});
  expect(none.code).toBe(NO_DATABASE);
  expect(none.err).toEqual(['Set DATABASE_URL to the Postgres connection string first.']);
  expect(none.connected).toEqual([]);
});

const REFUSALS: Record<string, string[][]> = {
  'a name that is not a migration': [
    ['--only', '005_missing.sql'],
    ['--only', '004_ai_access'],
    ['--only', '004_AI_ACCESS.sql'],
    ['--only', ' 004_ai_access.sql'],
    ['--only', '004_ai_access.sql '],
    ['--only', '*.sql'],
    ['--only', 'ai_access.sql'],
    ['--only', '004'],
    ['--only', '..'],
    ['--only', '.'],
  ],
  'a path out of migrations/': [
    ['--only', '../004_ai_access.sql'],
    ['--only', '..\\004_ai_access.sql'],
    ['--only', '../migrations/004_ai_access.sql'],
    ['--only', 'migrations/004_ai_access.sql'],
    ['--only', './004_ai_access.sql'],
    ['--only', '.\\004_ai_access.sql'],
    ['--only', '004_ai_access.sql/'],
  ],
  'an absolute path': [
    ['--only', resolve('migrations', ONLY)],
    ['--only', resolve('migrations', ONLY).replaceAll('\\', '/')],
    ['--only', '/migrations/004_ai_access.sql'],
    ['--only', '/004_ai_access.sql'],
    ['--only', 'C:\\dev\\Kayomi-guru\\migrations\\004_ai_access.sql'],
    ['--only', 'C:004_ai_access.sql'],
    ['--only', '\\\\server\\share\\004_ai_access.sql'],
  ],
  'no file after --only': [['--only'], ['--only', ''], ['--only', '--yes'], ['--yes', '--only'], ['--only', '-x']],
  'more than one file': [
    ['--only', ONLY, '--only', ONLY],
    ['--only', ONLY, '--only', '003_many_accounts.sql'],
    ['--only', ONLY, '003_many_accounts.sql'],
  ],
  'a form the runner does not take, which must not mean "everything"': [
    ['--only=004_ai_access.sql'],
    ['--only=' + ONLY, '--yes'],
    ['--onyl', ONLY],
    ['-only', ONLY],
    ['--ONLY', ONLY],
    [ONLY],
    ['--yes', 'please'],
    ['--force'],
  ],
};

test('anything --only cannot read for certain is refused, before any database, with nothing sent', async () => {
  for (const [kind, cases] of Object.entries(REFUSALS)) {
    for (const args of cases) {
      const label = `${kind}: ${JSON.stringify(args)}`;
      expect(planMigration(args, KNOWN).ok, label).toBe(false);
      // Even with --yes and an address at hand: refused, never connected, never "Database:".
      const run = await recorded([...args, '--yes']);
      expect(run.code, label).toBe(REFUSED);
      expect(run.connected, label).toEqual([]);
      expect(run.sent, label).toEqual([]);
      expect(run.out, label).toEqual([]);
      expect(run.err.at(-1), label).toBe('Nothing was sent to any database.');
    }
  }
  // What each kind says.
  expect(planMigration(['--only', '005_missing.sql'], KNOWN)).toEqual({ ok: false, reason: `No migration is named "005_missing.sql". The migrations are: ${KNOWN.join(', ')}.` });
  expect(planMigration(['--only', '../004_ai_access.sql'], KNOWN)).toEqual({ ok: false, reason: '--only takes the name of a file in migrations/, not a path: "../004_ai_access.sql".' });
  expect(planMigration(['--only', '/004_ai_access.sql'], KNOWN)).toEqual({ ok: false, reason: '--only takes the name of a file in migrations/, not a path: "/004_ai_access.sql".' });
  expect(planMigration(['--only'], KNOWN)).toEqual({ ok: false, reason: '--only needs the migration file after it, for example: --only 004_ai_access.sql' });
  expect(planMigration(['--only', ONLY, '--only', ONLY], KNOWN)).toEqual({ ok: false, reason: '--only takes exactly one migration file; it was given more than once.' });
  // And what it accepts: exactly one known name, alone or with --yes.
  expect(planMigration(['--only', ONLY], KNOWN)).toEqual({ ok: true, apply: false, only: ONLY, files: [ONLY] });
  expect(planMigration(['--only', ONLY, '--yes'], KNOWN)).toEqual({ ok: true, apply: true, only: ONLY, files: [ONLY] });
  expect(planMigration([], KNOWN)).toEqual({ ok: true, apply: false, only: null, files: KNOWN });
  expect(planMigration(['--yes'], KNOWN)).toEqual({ ok: true, apply: true, only: null, files: KNOWN });
});

// ---- Against real Postgres, on the repository's own migration files ----

/** Production as it is before this release: 001–003 applied, with rows. */
async function productionToday() {
  const db = new PGlite();
  for (const file of KNOWN.filter((name) => name < '004')) await db.exec(fileText(file));
  for (let i = 0; i < 5; i++) {
    await db.query(
      `insert into calendar_connections (auth_subject, provider, provider_account_id, refresh_token_sealed, scope, window_spent) values ($1, $2, $3, 'sealed', 'scope', $4)`,
      [`person-${i % 3}`, i % 2 ? 'google' : 'microsoft', `account-${i}`, i],
    );
  }
  return db;
}

/** One request per file, as Neon's HTTP driver sends it: a single statement each. */
const pglite = (db: PGlite) => () => ({ query: (text: string) => db.query(text) });

async function snapshot(db: PGlite) {
  const lines = async (sql: string) => (await db.query<{ line: string }>(sql)).rows.map((row) => row.line);
  const schema = [
    ...(await lines(`select format('col %s.%s %s %s %s', table_name, column_name, data_type, is_nullable, coalesce(column_default, '')) line from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`)),
    ...(await lines(`select format('idx %s', indexdef) line from pg_indexes where schemaname = 'public' order by indexname`)),
    ...(await lines(`select format('con %s.%s %s', conrelid::regclass, conname, pg_get_constraintdef(oid)) line from pg_constraint where connamespace = 'public'::regnamespace order by conrelid::regclass::text, conname`)),
  ];
  const one = async <T>(sql: string) => (await db.query<{ v: T }>(sql)).rows[0]?.v;
  return {
    schema,
    tables: await lines(`select table_name line from information_schema.tables where table_schema = 'public' order by 1`),
    // calendar_connections, by identity: the table, its primary key's index and constraint. A key
    // that is dropped and added again gets new ones.
    table: await one<number>(`select 'calendar_connections'::regclass::oid::int v`),
    keyIndex: await one<number>(`select indexrelid::int v from pg_index where indrelid = 'calendar_connections'::regclass and indisprimary`),
    keyConstraint: await one<number>(`select oid::int v from pg_constraint where conrelid = 'calendar_connections'::regclass and contype = 'p'`),
    rows: await one<number>(`select count(*)::int v from calendar_connections`),
    // Every row's content and its row version (xmin): a row that was rewritten gets a new one.
    content: await one<string>(`select md5(coalesce(string_agg(c::text, '|' order by connection_id), '')) v from calendar_connections c`),
    versions: await one<string>(`select coalesce(string_agg(xmin::text, ',' order by connection_id), '') v from calendar_connections`),
    // Two indexes or constraints that are the same apart from their name.
    duplicateIndexes: await one<number>(`select count(*)::int v from (select tablename, regexp_replace(indexdef, 'INDEX \\S+ ON', 'INDEX ON') d from pg_indexes where schemaname = 'public' group by 1, 2 having count(*) > 1) x`),
    duplicateConstraints: await one<number>(`select count(*)::int v from (select conrelid, pg_get_constraintdef(oid) d from pg_constraint where connamespace = 'public'::regnamespace group by 1, 2 having count(*) > 1) x`),
  };
}

const AI_TABLES = ['ai_clients', 'ai_codes', 'ai_grant_calendars', 'ai_grants', 'ai_refresh_tokens'];

test('on Postgres, --only 004_ai_access.sql adds the five AI tables and leaves 001–003 and every row as they were, twice', async () => {
  const db = await productionToday();
  const before = await snapshot(db);
  expect(before.tables).toEqual(['calendar_connections']);
  expect(before.rows).toBe(5);

  const migrate = () => runMigrations({ args: ['--only', ONLY, '--yes'], env: { DATABASE_URL: NOWHERE }, connect: pglite(db), log: () => {}, error: () => {} });

  expect(await migrate()).toBe(DONE);
  const first = await snapshot(db);
  expect(first.tables).toEqual([...AI_TABLES, 'calendar_connections']);
  // Everything that was there is still there, unchanged; all that was added is AI access.
  expect(before.schema.filter((line) => !first.schema.includes(line))).toEqual([]);
  const added = first.schema.filter((line) => !before.schema.includes(line));
  expect(added.length).toBeGreaterThan(0);
  for (const line of added) expect(line, line).toMatch(/\bai_/);
  expect(added.filter((line) => line.includes('calendar_connections'))).toEqual([]);
  // calendar_connections: the same table, the same key (not rebuilt), the same rows, not rewritten.
  for (const key of ['table', 'keyIndex', 'keyConstraint', 'rows', 'content', 'versions'] as const) expect(first[key], key).toEqual(before[key]);

  // The same command again: no drift, nothing doubled.
  expect(await migrate()).toBe(DONE);
  const second = await snapshot(db);
  expect(second).toEqual(first);
  expect(second.duplicateIndexes).toBe(0);
  expect(second.duplicateConstraints).toBe(0);

  // Rollback: the five tables dropped, and the schema is what it was.
  await db.exec(`drop table ${AI_TABLES.slice().reverse().join(', ')};`);
  const rolledBack = await snapshot(db);
  expect(rolledBack).toEqual(before);
  await db.close();
});

test('on Postgres, the plain command still sends every file, and that is what rebuilds calendar_connections\' key', async () => {
  // Why --only exists: 003 drops and adds the primary key whenever it is sent again. Nothing is
  // lost (one transaction), but the key is a new one each time.
  const db = await productionToday();
  const before = await snapshot(db);
  expect(await runMigrations({ args: ['--yes'], env: { DATABASE_URL: NOWHERE }, connect: pglite(db), log: () => {}, error: () => {} })).toBe(DONE);
  const after = await snapshot(db);
  expect(after.tables).toEqual([...AI_TABLES, 'calendar_connections']);
  expect(after.rows).toBe(before.rows);
  expect(after.content).toBe(before.content);
  expect(after.keyIndex).not.toBe(before.keyIndex);
  expect(after.keyConstraint).not.toBe(before.keyConstraint);
  await db.close();
});

// ---- The command itself ----

/** Runs `node scripts/migrate.mjs` with an address nothing answers on. */
function command(args: string[]) {
  const result = spawnSync(process.execPath, ['scripts/migrate.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: NOWHERE },
    timeout: 30_000,
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('the command exits non-zero on anything it refuses, and never says it is applying anything', () => {
  for (const args of [
    ['--only', '../004_ai_access.sql', '--yes'],
    ['--only', resolve('migrations', ONLY), '--yes'],
    ['--only', '005_missing.sql', '--yes'],
    ['--only', '--yes'],
    ['--only=004_ai_access.sql', '--yes'],
  ]) {
    const run = command(args);
    expect(run.code, JSON.stringify(args)).toBe(REFUSED);
    expect(run.out, JSON.stringify(args)).toBe('');
    expect(run.err, JSON.stringify(args)).toContain('Nothing was sent to any database.');
  }
  // What it accepts, shown without --yes: which database, which file, and nothing changed.
  const shown = command(['--only', ONLY]);
  expect(shown.code).toBe(DONE);
  expect(shown.err).toBe('');
  expect(shown.out).toBe(
    [
      'Database: 127.0.0.1/none',
      `Only ${ONLY}. Not run: 001_calendar_connections.sql, 002_read_allowance.sql, 003_many_accounts.sql.`,
      `Nothing was changed. If that is the Koyomi database, run again with: npm run db:migrate -- --only ${ONLY} --yes`,
      '',
    ].join('\n'),
  );
});
