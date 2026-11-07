import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test } from '@playwright/test';

// The service worker (public/sw.js), run as it is in a stand-in for the browser's worker scope:
// which requests it answers itself and which it leaves to the network. The browser test of the
// same thing is in pwa.spec.ts ("the page where an AI assistant is allowed never becomes the calendar").

const ORIGIN = 'https://app.koyomi.guru';

/** Loads the worker and returns its fetch handler. */
function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const saved = new Response('<!doctype html><title>Koyomi</title><p>the saved calendar</p>', { headers: { 'content-type': 'text/html' } });
  const cache = { match: async () => saved.clone(), put: async () => undefined, addAll: async () => undefined, keys: async () => [], delete: async () => true };
  const scope = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [] },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => saved.clone() },
    // The network is down: anything the worker sends there fails.
    fetch: async () => {
      throw new TypeError('Failed to fetch');
    },
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    Request,
    Response,
    Error,
    console,
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { ...scope, self: scope });
  const fetchListener = listeners.get('fetch');
  if (!fetchListener) throw new Error('the worker has no fetch handler');
  /** What the worker does with one request: answers it (with what), or leaves it to the network. */
  return async (path: string, mode: 'navigate' | 'cors' = 'navigate', method = 'GET') => {
    let answered: Promise<Response> | null = null;
    fetchListener({
      request: { url: `${ORIGIN}${path}`, method, mode },
      respondWith: (response: Promise<Response>) => (answered = Promise.resolve(response)),
      waitUntil: () => undefined,
    });
    return answered === null ? 'network' : await (answered as Promise<Response>).then((r) => r.text());
  };
}

test('the page where an AI assistant is allowed is never answered by the worker: offline it fails, it never becomes the calendar', async () => {
  const handle = worker();
  for (const path of ['/ai/consent', '/ai/consent?x=1', '/ai/anything']) {
    expect(await handle(path), path).toBe('network');
    // Its own data requests (a refresh of the page) too.
    expect(await handle(`${path}${path.includes('?') ? '&' : '?'}_rsc=abc`, 'cors'), path).toBe('network');
  }
  // As sign-in and every API request are.
  for (const path of ['/api/auth/signin?returnTo=%2Fai%2Fconsent', '/api/oauth/authorize?client_id=x', '/api/ai/grants']) expect(await handle(path), path).toBe('network');
  // What the worker is for is unchanged: the calendar opens from the saved page when offline.
  expect(await handle('/')).toContain('the saved calendar');
  // Nothing is mistaken for /ai/ that is not under it.
  expect(await handle('/aid')).toContain('the saved calendar');
});
