/**
 * Installs the service worker that keeps Koyomi usable offline. Production builds only, and not a
 * Vercel Preview build, whose "/" is the landing page and whose calendar is at "/app" (next.config.ts).
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (process.env.NODE_ENV !== 'production' || process.env.KOYOMI_PREVIEW === '1') {
    // A worker left on this origin by a production build would serve stale code in development; on
    // a preview it would keep the landing page as the app. One from an earlier preview is removed.
    void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((registration) => registration.unregister()));
    return;
  }

  const loaded = new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });

  navigator.serviceWorker
    .register('/sw.js')
    .then(() => Promise.all([navigator.serviceWorker.ready, document.fonts.ready, loaded]))
    .then(([registration]) => {
      // The first visit loads its scripts, styles and fonts before the worker is in control.
      // Hand it that list so the very first visit is enough to work offline.
      const urls = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => url.startsWith(`${location.origin}/_next/static/`));
      registration.active?.postMessage({ type: 'warm', urls });
    })
    .catch(() => {
      // No service worker here (private window, unsupported browser): the app still works online.
    });
}
