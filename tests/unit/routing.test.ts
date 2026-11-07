import { expect, test } from '@playwright/test';
import { AI_METADATA, PREVIEW_APP_PATH, routing } from '../../next.config';

// Which site a host is shown is decided in next.config.ts, by host name, and in one case by the
// kind of build: a Vercel Preview shows the landing page at "/" and the calendar at /app.

const SITE_HOST = '(?:www\\.)?koyomi\\.guru';
const APP_HOST = 'app\\.koyomi\\.guru';

/** Every rule as it is in production. Local builds, and so every browser test, have exactly these. */
const PRODUCTION = {
  rewrites: {
    beforeFiles: [
      { source: '/', has: [{ type: 'host', value: SITE_HOST }], destination: '/home' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/resource' },
      { source: '/.well-known/oauth-protected-resource/mcp', destination: '/api/oauth/resource' },
    ],
    afterFiles: [],
    fallback: [],
  },
  redirects: [
    { source: '/open', has: [{ type: 'host', value: SITE_HOST }], destination: 'https://app.koyomi.guru/', permanent: false },
    { source: '/open', destination: '/', permanent: false },
    { source: '/home', has: [{ type: 'host', value: SITE_HOST }], destination: '/', permanent: true },
    { source: '/home', has: [{ type: 'host', value: APP_HOST }], destination: 'https://koyomi.guru/', permanent: true },
    { source: '/privacy', has: [{ type: 'host', value: APP_HOST }], destination: 'https://koyomi.guru/privacy', permanent: true },
    { source: '/terms', has: [{ type: 'host', value: APP_HOST }], destination: 'https://koyomi.guru/terms', permanent: true },
  ],
  env: { KOYOMI_PREVIEW: '' },
};

test('production and local builds route exactly as before: koyomi.guru the site, app.koyomi.guru and every other host the calendar', () => {
  expect(routing('production')).toEqual(PRODUCTION);
  expect(routing(undefined)).toEqual(PRODUCTION);
  // Vercel's other kind of build, and anything unexpected, are not a preview either.
  expect(routing('development')).toEqual(PRODUCTION);
  expect(routing('Preview')).toEqual(PRODUCTION);
});

test('a Vercel Preview build shows the landing page at "/" and the calendar at /app, and nothing else differs', () => {
  const preview = routing('preview');
  expect(PREVIEW_APP_PATH).toBe('/app');

  // The site's own host rule first, as in production; then "/" for every host, then /app to the
  // calendar; then the AI discovery documents, as in production.
  expect(preview.rewrites.beforeFiles).toEqual([
    PRODUCTION.rewrites.beforeFiles[0],
    { source: '/', destination: '/home' },
    { source: '/app', destination: '/' },
    ...AI_METADATA,
  ]);
  expect(preview.rewrites.afterFiles).toEqual([]);
  expect(preview.rewrites.fallback).toEqual([]);

  // "Open Koyomi" leads to the calendar where it is: /app. Every rule naming koyomi.guru or
  // app.koyomi.guru is the same as in production.
  expect(preview.redirects).toEqual(PRODUCTION.redirects.map((rule) => (rule.source === '/open' && !rule.has ? { ...rule, destination: '/app' } : rule)));

  // And it installs no service worker (lib/sw-register.ts).
  expect(preview.env).toEqual({ KOYOMI_PREVIEW: '1' });
});

test('nothing in the routing touches sign-in or the calendar connections; only the AI discovery documents lead to /api', () => {
  for (const env of ['production', 'preview', undefined]) {
    const { rewrites, redirects } = routing(env);
    const rules = [...rewrites.beforeFiles, ...rewrites.afterFiles, ...rewrites.fallback, ...redirects];
    const api = rules.filter((rule) => rule.source.startsWith('/api') || rule.destination.includes('/api'));
    expect(api, String(env)).toEqual(AI_METADATA);
    // And those lead to the two metadata documents and nowhere else.
    expect([...new Set(api.map((rule) => rule.destination))].sort()).toEqual(['/api/oauth/metadata', '/api/oauth/resource']);
  }
});
