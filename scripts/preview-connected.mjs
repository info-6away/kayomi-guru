// Runs Koyomi on http://localhost:4310 with calendar connections switched on, against
// stand-ins for 6Away Auth, Google and Microsoft. For looking at the feature by hand: "Add
// calendar account", then Google, signs in as a made-up person and connects a made-up Google
// account, and doing it again connects a second one beside it; Microsoft connects a made-up
// Microsoft account. No real credentials and no real calendar are involved, and nothing is kept
// once this stops.
//
//   npm run preview:connected
//
// To connect the real Google instead, set the real settings and use `npm run preview`
// (docs/CALENDAR_CONNECTIONS.md says which).

import { spawn, spawnSync } from 'node:child_process';
import { DEMO_ACCOUNTS, DEMO_MICROSOFT_ACCOUNTS, DEMO_YAHOO_ACCOUNT, FAKE_PORT, PORT, TEST_ENV } from '../tests/fakes/env.mjs';

const env = { ...process.env, ...TEST_ENV, FAKE_PORT: String(FAKE_PORT) };
const next = ['node_modules/next/dist/bin/next'];

const built = spawnSync(process.execPath, [...next, 'build'], { env, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const fakes = spawn(process.execPath, ['tests/fakes/providers.mjs'], { env, stdio: 'inherit' });
const app = spawn(process.execPath, [...next, 'start', '-p', String(PORT)], { env, stdio: 'inherit' });
const stop = () => {
  fakes.kill();
  app.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
app.on('exit', (code) => process.exit(code ?? 0));

// Whoever adds an account without saying which (see providers.mjs) gets these, in turn: the
// stand-in has no list of accounts to choose from, as Google's own screen has.
const tell = (path, body) => fetch(`http://localhost:${FAKE_PORT}/__fake/${path}`, { method: 'PUT', body: JSON.stringify(body) }).then((response) => response.ok, () => false);
for (let attempt = 0; attempt < 50; attempt++) {
  const ready =
    (await Promise.all(Object.entries(DEMO_ACCOUNTS).map(([id, account]) => tell(`google/${id}`, account)))).every(Boolean) &&
    (await Promise.all(Object.entries(DEMO_MICROSOFT_ACCOUNTS).map(([id, account]) => tell(`microsoft/${id}`, account)))).every(Boolean) &&
    (await tell('turns', Object.keys(DEMO_ACCOUNTS))) &&
    (await tell('microsoft-turns', Object.keys(DEMO_MICROSOFT_ACCOUNTS))) &&
    (await tell(`yahoo/${encodeURIComponent(DEMO_YAHOO_ACCOUNT.email)}`, DEMO_YAHOO_ACCOUNT));
  if (ready) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
console.log(`\nKoyomi with two stand-in Google accounts and a Microsoft one: http://localhost:${PORT}  (Calendars, then Add calendar account)\n`);
