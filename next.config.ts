import type { NextConfig } from 'next';

// One deployment serves two sites, told apart by host name:
//
//   kayomi.guru       the landing page (app/home), shown at "/"
//   app.kayomi.guru   the calendar (app/page.tsx)
//
// Any other host (a Vercel address, localhost) gets the calendar at "/" and the landing page at "/home".
const SITE_HOST = 'kayomi\\.guru';
const APP_HOST = 'app\\.kayomi\\.guru';
const SITE_URL = 'https://kayomi.guru';
const APP_URL = 'https://app.kayomi.guru';

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
      { source: '/:path*', has: [{ type: 'host', value: `www\\.${SITE_HOST}` }], destination: `${SITE_URL}/:path*`, permanent: true },
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
