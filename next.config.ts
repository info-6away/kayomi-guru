import type { NextConfig } from 'next';

// One deployment serves two sites, told apart by host name:
//
//   koyomi.guru       the landing page (app/home), shown at "/"; www.koyomi.guru too
//   app.koyomi.guru   the calendar (app/page.tsx)
//
// Any other host (a Vercel address, localhost) gets the calendar at "/" and the landing page at "/home".
//
// Nothing here redirects between koyomi.guru and www.koyomi.guru. Which one is the main address is a
// domain setting in Vercel, and a second redirect in code can only disagree with it: the two then
// send every visitor back and forth until the browser gives up.
const SITE_HOST = '(?:www\\.)?koyomi\\.guru';
const APP_HOST = 'app\\.koyomi\\.guru';
const SITE_URL = 'https://koyomi.guru';
const APP_URL = 'https://app.koyomi.guru';

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', has: [{ type: 'host', value: SITE_HOST }], destination: '/home' }],
      afterFiles: [],
      fallback: [],
    };
  },

  async redirects() {
    return [
      // The landing page's buttons point at /open, so they work on every host.
      { source: '/open', has: [{ type: 'host', value: SITE_HOST }], destination: `${APP_URL}/`, permanent: false },
      { source: '/open', destination: '/', permanent: false },
      // Each site stays on its own host.
      { source: '/home', has: [{ type: 'host', value: SITE_HOST }], destination: '/', permanent: true },
      { source: '/home', has: [{ type: 'host', value: APP_HOST }], destination: `${SITE_URL}/`, permanent: true },
    ];
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
