// Creates the table calendar connections are kept in. Safe to run again: it changes nothing
// that is already there.
//
//   DATABASE_URL="postgres://..." npm run db:migrate            shows which database it would change
//   DATABASE_URL="postgres://..." npm run db:migrate -- --yes   changes it
//
// The calendar itself has no database. This is only for the server's record of who has
// connected which provider (see migrations/ and docs/CALENDAR_CONNECTIONS.md).

import { readdirSync, readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the Postgres connection string first.');
  process.exit(1);
}

// Say where, and wait to be told: a machine can have this variable set for another project.
const target = new URL(url);
console.log(`Database: ${target.hostname}${target.pathname}`);
if (!process.argv.includes('--yes')) {
  console.log('Nothing was changed. If that is the Koyomi database, run again with: npm run db:migrate -- --yes');
  process.exit(0);
}

const sql = neon(url);
// Each file holds one statement, which is all a single request to Neon carries.
for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await sql.query(readFileSync(`migrations/${file}`, 'utf8'));
  console.log('applied', file);
}
