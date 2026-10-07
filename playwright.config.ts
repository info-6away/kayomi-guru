import { defineConfig, devices } from '@playwright/test';

// The ports, and the settings that switch calendar connections on against the stand-in
// providers, are shared with `npm run preview:connected`. No test talks to the real services.
import { FAKE_PORT, PORT, TEST_ENV } from './tests/fakes/env.mjs';

// `npm test` runs the logic tests alone; they need neither a browser nor a server.
const unitOnly = process.argv.includes('--project=unit');

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  projects: [
    { name: 'unit', testMatch: 'unit/**/*.test.ts' },
    {
      // Runs against the production build in the installed Google Chrome.
      name: 'e2e',
      testMatch: 'e2e/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        baseURL: `http://localhost:${PORT}`,
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: unitOnly
    ? undefined
    : [
        {
          command: 'node tests/fakes/providers.mjs',
          url: `http://localhost:${FAKE_PORT}/__fake/health`,
          env: { FAKE_PORT: String(FAKE_PORT) },
          reuseExistingServer: !process.env.CI,
        },
        {
          command: `npm run build && npx next start -p ${PORT}`,
          url: `http://localhost:${PORT}`,
          env: TEST_ENV,
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
        },
      ],
});
