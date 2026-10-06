import { defineConfig, devices } from '@playwright/test';

export const PORT = 4310;

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
    : {
        command: `npm run build && npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
