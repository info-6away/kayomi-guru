import type { NextConfig } from 'next';

// One deployment serves two sites, told apart by host name:
//
//   koyomi.guru       the landing page (app/home), shown at "/"; www.koyomi.guru too
//   app.koyomi.guru   the calendar (app/page.tsx)
//
// Any other host (a Vercel address, localhost) gets the calendar at "/" and the landing page at "/home".
//
// Except a Vercel Preview build. A pull request's preview has only its own *.vercel.app addresses,
// and no domain to tell the two sites apart by, so it is built to show what a change to the site is
// reviewed by: the landing page at "/", and the calendar at "/app". Which build it is comes from
// Vercel itself (VERCEL_ENV, set while building), not from any host name. Production and local
// builds, and so every browser test, never take that branch.
//
// Nothing here redirects between koyomi.guru and www.koyomi.guru. Which one is the main address is a
// domain setting in Vercel, and a second redirect in code can only disagree with it: the two then
// send every visitor back and forth until the browser gives up.
const SITE_HOST = '(?:www\\.)?koyomi\\.guru';
const APP_HOST = 'app\\.koyomi\\.guru';
const SITE_URL = 'https://koyomi.guru';
const APP_URL = 'https://app.koyomi.guru';

/** Where a Preview build serves the calendar, since its "/" is the landing page. */
export const PREVIEW_APP_PATH = '/app';

/** The two sites' rewrites and redirects, for a build made for `vercelEnv`: 'production', 'preview', or none (local). */
export function routing(vercelEnv: string | undefined) {
  const preview = vercelEnv === 'preview';
  return {
    rewrites: {
      beforeFiles: [
        { source: '/', has: [{ type: 'host' as const, value: SITE_HOST }], destination: '/home' },
        // In this order: "/app" becomes "/" only after the rule for "/" has been passed, so it is the calendar.
        ...(preview ? [{ source: '/', destination: '/home' }, { source: PREVIEW_APP_PATH, destination: '/' }] : []),
      ],
      afterFiles: [],
      fallback: [],
    },
    redirects: [
      // The landing page's buttons point at /open, so they work on every host.
      { source: '/open', has: [{ type: 'host' as const, value: SITE_HOST }], destination: `${APP_URL}/`, permanent: false },
      { source: '/open', destination: preview ? PREVIEW_APP_PATH : '/', permanent: false },
      // Each site stays on its own host.
      { source: '/home', has: [{ type: 'host' as const, value: SITE_HOST }], destination: '/', permanent: true },
      { source: '/home', has: [{ type: 'host' as const, value: APP_HOST }], destination: `${SITE_URL}/`, permanent: true },
      // Privacy and Terms are pages of the site. Asked of the calendar's host, they are over there.
      { source: '/privacy', has: [{ type: 'host' as const, value: APP_HOST }], destination: `${SITE_URL}/privacy`, permanent: true },
      { source: '/terms', has: [{ type: 'host' as const, value: APP_HOST }], destination: `${SITE_URL}/terms`, permanent: true },
    ],
    // Read by the page (lib/sw-register.ts): a Preview build installs no service worker, because its
    // calendar is not at "/", the one place the worker keeps and serves as the app.
    env: { KOYOMI_PREVIEW: preview ? '1' : '' },
  };
}

const ROUTING = routing(process.env.VERCEL_ENV);

const nextConfig: NextConfig = {
  env: ROUTING.env,

  async rewrites() {
    return ROUTING.rewrites;
  },

  async redirects() {
    return ROUTING.redirects;
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          // The service worker must never be served stale, or an update could not reach installed apps.
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          // The worker only ever talks to this origin.
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
