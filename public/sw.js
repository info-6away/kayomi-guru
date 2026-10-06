// Kayomi's service worker: keeps the app shell available offline.
//
// - The page itself is fetched from the network first, so a new release shows up on the
//   next load, and comes from the cache when there is no connection.
// - Files under /_next/static/ have content-hashed names and never change: cache first.
// - Anything else from this origin (icons, manifest) is served from the cache and
//   refreshed in the background.
//
// The calendar's data is not here. It lives in IndexedDB and never leaves the device.

const SHELL = 'kayomi-shell-v1';
const STATIC = 'kayomi-static-v1';
const STATIC_PATH = '/_next/static/';
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('kayomi-') && name !== SHELL && name !== STATIC) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** Stores the page and every static file it names, so one online visit is enough. */
async function precache() {
  const response = await fetch('/', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not fetch the app shell: ${response.status}`);
  const html = await response.clone().text();
  await (await caches.open(SHELL)).put('/', response);
  await addStatic([...new Set(html.match(/\/_next\/static\/[^"'\\\s<>)]+/g) || [])]);
}

async function addStatic(urls) {
  const cache = await caches.open(STATIC);
  await Promise.all(
    urls.map(async (url) => {
      if (!(await cache.match(url))) await cache.add(url).catch(() => {});
    }),
  );
}

// The page reports what it actually loaded (including fonts the HTML does not name).
// Cache those, and drop scripts and styles left over from earlier releases.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'warm' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((url) => typeof url === 'string' && url.startsWith(location.origin + STATIC_PATH));
  event.waitUntil(
    (async () => {
      await addStatic(urls);
      const current = new Set(urls);
      // Match the folder, not the whole path: a local build serves /_next/static/chunks/,
      // while Vercel nests the same files under /_next/static/immutable/chunks/.
      if (![...current].some((url) => url.includes('/chunks/'))) return;
      const cache = await caches.open(STATIC);
      for (const request of await cache.keys()) {
        // Fonts keep the same name across releases and may load later, so they stay.
        if (!current.has(request.url) && !request.url.includes('/media/')) await cache.delete(request);
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') event.respondWith(page(event));
  else if (url.pathname.startsWith(STATIC_PATH)) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(event));
});

async function page(event) {
  const cache = await caches.open(SHELL);
  try {
    const response = await Promise.race([
      fetch(event.request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT_MS)),
    ]);
    if (response.ok && new URL(event.request.url).pathname === '/') event.waitUntil(cache.put('/', response.clone()));
    return response;
  } catch {
    return (await cache.match('/')) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(event.request);
  const fresh = fetch(event.request)
    .then((response) => {
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => cached || Response.error());
  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  return fresh;
}
