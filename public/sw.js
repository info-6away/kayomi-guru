// Koyomi's service worker: keeps the app shell available offline.
//
// - The page itself is fetched from the network first, so a new release shows up on the
//   next load, and comes from the cache when there is no connection.
// - Files under /_next/static/ have content-hashed names and never change: cache first.
// - Anything else from this origin (icons, manifest) is served from the cache and
//   refreshed in the background.
//
// The calendar's data is not here. It lives in IndexedDB and never leaves the device. Nothing in
// this file reads, writes or clears IndexedDB: the caches below can be thrown away at any time
// and rebuilt from the network, and the calendar cannot.
//
// Updates need no prompt. The page is fetched fresh on every launch, so a new release is simply
// what the next launch shows. An open session is never reloaded from here.

// The cache names keep the product's first spelling, "kayomi"; they are internal and never shown.
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
  const isShell = new URL(event.request.url).pathname === '/';
  const network = fetch(event.request);
  // The request carries on even when the visitor has been answered from the cache, and whatever
  // it brings back is kept. On a slow connection today's launch may show the saved shell, but the
  // next one has the newest: nobody stays on an old release for want of a fast network.
  event.waitUntil(network.then((response) => (response.ok && isShell ? cache.put('/', response.clone()) : undefined)).catch(() => {}));
  try {
    return await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT_MS))]);
  } catch {
    // Offline, or too slow. With nothing saved yet (a first visit), waiting is all there is.
    return (await cache.match('/')) || network.catch(() => Response.error());
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
