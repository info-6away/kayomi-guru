// Applies the files in migrations/ to the server's database. Each file is safe to send again on
// its own; see the note on 003 below.
//
//   DATABASE_URL="postgres://..." npm run db:migrate                                  shows which database and files
//   DATABASE_URL="postgres://..." npm run db:migrate -- --yes                         sends every file, in order
//   DATABASE_URL="postgres://..." npm run db:migrate -- --only 004_ai_access.sql      shows what --only would send
//   DATABASE_URL="postgres://..." npm run db:migrate -- --only 004_ai_access.sql --yes  sends that one file
//
// --only takes exactly one file name from migrations/ (no path) and sends nothing else. Anything
// it does not accept stops the command with exit code 2 before any database is reached.
//
// There is no record of what has been applied, so a run without --only sends 001–003 again, and
// 003 then drops and rebuilds calendar_connections' primary key (in one transaction; nothing is
// lost, but it is DDL on the live table). A new migration is applied to Production with --only.
// See docs/MCP.md ("Migration 004 and the migration runner").
//
// The calendar itself has no database. This is only for the server's record of connected
// providers and AI access (see migrations/, docs/CALENDAR_CONNECTIONS.md and docs/MCP.md).

import { neon } from '@neondatabase/serverless';
import { runMigrations } from './migrate-core.mjs';

process.exitCode = await runMigrations({
  args: process.argv.slice(2),
  env: process.env,
  connect: (url) => neon(url),
});
