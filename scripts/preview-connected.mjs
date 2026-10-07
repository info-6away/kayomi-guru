// Runs Koyomi on http://localhost:4310 with calendar connections switched on, against
// stand-ins for 6Away Auth and Google. For looking at the feature by hand: "Connect" signs in
// as a made-up person and connects a made-up Google account, with no real credentials and no
// real calendar involved. Nothing is kept once this stops.
//
//   npm run preview:connected
//
// To connect the real Google instead, set the real settings and use `npm run preview`
// (docs/CALENDAR_CONNECTIONS.md says which).

import { spawn, spawnSync } from 'node:child_process';
import { DEMO_ACCOUNT, FAKE_PORT, PORT, TEST_ENV } from '../tests/fakes/env.mjs';

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

// Whoever presses Connect without choosing an account (see providers.mjs) gets this one.
for (let attempt = 0; attempt < 50; attempt++) {
  const ready = await fetch(`http://localhost:${FAKE_PORT}/__fake/google/nobody`, { method: 'PUT', body: JSON.stringify(DEMO_ACCOUNT) }).then(
    (response) => response.ok,
    () => false,
  );
  if (ready) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
console.log(`\nKoyomi with a stand-in Google account: http://localhost:${PORT}  (Plan, then Calendars, then Connect)\n`);
