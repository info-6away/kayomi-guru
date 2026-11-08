// What `npm run db:migrate` does, apart from the database driver so that it can be tested
// against a stand-in (tests/unit/migrate.test.ts). The command itself is scripts/migrate.mjs.
//
// Without --only it sends every file in migrations/, in name order, as it always has. With
// `--only <file>` it sends that one file and nothing else. Anything it cannot read for certain is
// refused before it touches a database: a mistake never falls back to running every file.

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';

export const MIGRATIONS_DIR = 'migrations';

/** Exit codes: done (or nothing asked), cannot reach a database, refused arguments. */
export const DONE = 0;
export const NO_DATABASE = 1;
export const REFUSED = 2;

/** The migration files, in the order a full run sends them. */
export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
}

/** Why `name` is not something --only accepts, or null if it is exactly one of `known`. */
function refusalFor(name, known) {
  if (posix.isAbsolute(name) || win32.isAbsolute(name) || /^[a-zA-Z]:/.test(name)) {
    return `--only takes the name of a file in ${MIGRATIONS_DIR}/, not a path: ${JSON.stringify(name)}.`;
  }
  if (name.includes('/') || name.includes('\\') || name.split(/[/\\]/).includes('..') || name === '.') {
    return `--only takes the name of a file in ${MIGRATIONS_DIR}/, not a path: ${JSON.stringify(name)}.`;
  }
  if (!known.includes(name)) {
    return `No migration is named ${JSON.stringify(name)}. The migrations are: ${known.join(', ')}.`;
  }
  return null;
}

/**
 * Reads the command's arguments: what to send, and whether to send it. Returns a refusal for
 * anything else, including an argument it does not know, so that a typo (`--onyl`, `--only=…`)
 * cannot turn into a run of every file.
 *
 * @param {readonly string[]} args the arguments after the script name
 * @param {readonly string[]} known the migration files (migrationFiles())
 * @returns {{ ok: true, apply: boolean, only: string | null, files: string[] } | { ok: false, reason: string }}
 */
export function planMigration(args, known) {
  let apply = false;
  /** @type {string | null} */
  let only = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--yes') {
      apply = true;
    } else if (arg === '--only') {
      if (only !== null) return { ok: false, reason: '--only takes exactly one migration file; it was given more than once.' };
      const name = args[i + 1];
      if (name === undefined || name === '' || name.startsWith('-')) {
        return { ok: false, reason: '--only needs the migration file after it, for example: --only 004_ai_access.sql' };
      }
      const refusal = refusalFor(name, known);
      if (refusal) return { ok: false, reason: refusal };
      only = name;
      i++;
    } else if (arg.startsWith('--only')) {
      return { ok: false, reason: `Write --only and the file as two words, for example: --only 004_ai_access.sql (not ${JSON.stringify(arg)}).` };
    } else {
      return { ok: false, reason: `Unknown argument ${JSON.stringify(arg)}. The runner takes --yes, and --only <migration file>.` };
    }
  }
  return { ok: true, apply, only, files: only === null ? [...known] : [only] };
}

/**
 * Runs the command. Returns the exit code.
 *
 * @param {{
 *   args: readonly string[],
 *   env: Record<string, string | undefined>,
 *   connect: (url: string) => { query: (text: string) => Promise<unknown> },
 *   dir?: string,
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 * }} options
 */
export async function runMigrations({ args, env, connect, dir = MIGRATIONS_DIR, log = console.log, error = console.error }) {
  const known = migrationFiles(dir);
  const plan = planMigration(args, known);
  if (!plan.ok) {
    error(plan.reason);
    error('Nothing was sent to any database.');
    return REFUSED;
  }

  const url = env.DATABASE_URL;
  if (!url) {
    error('Set DATABASE_URL to the Postgres connection string first.');
    return NO_DATABASE;
  }
  // Say where, and wait to be told: a machine can have this variable set for another project.
  // The address is never printed whole: it holds the password.
  let target;
  try {
    target = new URL(url);
  } catch {
    error('DATABASE_URL is not a connection string.');
    return NO_DATABASE;
  }
  log(`Database: ${target.hostname}${target.pathname}`);
  if (plan.only !== null) {
    const others = known.filter((name) => name !== plan.only);
    log(`Only ${plan.only}. Not run: ${others.length ? others.join(', ') : 'none'}.`);
  } else {
    log(`Every migration, in order: ${known.join(', ')}.`);
  }
  if (!plan.apply) {
    const again = plan.only !== null ? `--only ${plan.only} --yes` : '--yes';
    log(`Nothing was changed. If that is the Koyomi database, run again with: npm run db:migrate -- ${again}`);
    return DONE;
  }

  const sql = connect(url);
  // Each file holds one statement, which is all a single request to Neon carries, so each file is
  // applied whole or not at all.
  for (const file of plan.files) {
    log(`applying ${file}`);
    await sql.query(readFileSync(join(dir, file), 'utf8'));
    log(`applied ${file}`);
  }
  return DONE;
}
