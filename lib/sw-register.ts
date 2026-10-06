/** Installs the service worker that keeps Koyomi usable offline. Production only. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (process.env.NODE_ENV !== 'production') {
    // A worker left on this origin by a production build would serve stale code in development.
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
