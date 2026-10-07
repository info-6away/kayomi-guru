import { useSyncExternalStore } from 'react';

// Installing Koyomi as an app. The browser's own install banner is held back, so nobody is
// greeted with one; a quiet "Install Koyomi" line at the foot of Plan takes its place.

/** Chromium's deferred install prompt, which is not in TypeScript's DOM types. */
interface InstallPrompt extends Event {
  prompt(): Promise<unknown>;
}

/** Koyomi is installed from its own address only, never from a preview or the Vercel address. */
export const canInstallFrom = (hostname: string) => hostname === 'app.koyomi.guru' || hostname === 'localhost' || hostname === '127.0.0.1';

/** Already running as an installed app. The second test is Safari's, which has no `display-mode` here. */
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

let prompt: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const set = (next: InstallPrompt | null) => {
  prompt = next;
  listeners.forEach((listener) => listener());
};

/** Call once, in the browser. Returns a function that stops listening. */
export function watchInstall() {
  const onPrompt = (event: Event) => {
    // Without this, Chrome on Android shows its own "Add to Home screen" bar on a first visit.
    event.preventDefault();
    if (canInstallFrom(location.hostname) && !installed()) set(event as InstallPrompt);
  };
  // Fires once the app is installed, after which there is nothing left to offer.
  const onInstalled = () => set(null);
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

/** Opens the browser's install dialog. A prompt can be used once, so the offer goes away either way. */
export function install() {
  const current = prompt;
  if (!current) return;
  set(null);
  void current.prompt().catch(() => {});
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * True while the browser is ready to install Koyomi here. It never is in a browser without
 * install prompts (Safari, Firefox), or once Koyomi is installed.
 */
export const useCanInstall = () => useSyncExternalStore(subscribe, () => prompt !== null, () => false);
