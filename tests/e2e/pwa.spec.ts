import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, request as overHttp } from 'node:http';
import { request as overHttps } from 'node:https';
import { chromium, expect, test, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import {
  addEvent,
  addToPlan,
  at,
  columns,
  event,
  fits,
  offlineReady,
  open,
  placeFromPlan,
  plan,
  popover,
  reload,
  renderedFonts,
  seed,
  stored,
  storedTitles,
  today,
  wordmark,
} from './helpers';

// Koyomi as an installed app: what the browser is told about it, how it starts, how it is offered,
// how it behaves in a window of its own, with no connection, and from one release to the next.

// A stand-in for a preview or the Vercel address: one more name for the test server, known only to
// this file's browser. (Playwright allows launch options per file, not per group.)
const OTHER_HOST = 'koyomi-preview.example';
test.use({ launchOptions: { args: [`--host-resolver-rules=MAP ${OTHER_HOST} 127.0.0.1`] } });

const standalone = (page: Page) => page.evaluate(() => matchMedia('(display-mode: standalone)').matches);
const installOffer = (page: Page) => plan(page).getByRole('button', { name: 'Install Koyomi' });

/**
 * Does what Chrome does when the app can be installed. Left alone, Chrome follows this event with
 * a banner of its own; the result says whether Koyomi held that back.
 */
const browserOffersInstall = (page: Page) =>
  page.evaluate(() => {
    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {
        document.body.dataset.installDialogs = String(Number(document.body.dataset.installDialogs ?? 0) + 1);
      },
    });
    window.dispatchEvent(offer);
    return offer.defaultPrevented;
  });

test.describe('manifest and icons', () => {
  test('the manifest describes Koyomi, and every image in it is what it says', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.headers()['content-type']).toContain('application/manifest+json');
    const manifest = await response.json();
    // id, start_url and scope are what make an installed Koyomi the same app after every release.
    expect(manifest).toMatchObject({
      name: 'Koyomi',
      short_name: 'Koyomi',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#F5F1E8',
      theme_color: '#F5F1E8',
    });
    expect(manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes} ${icon.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    expect(manifest.screenshots.map((shot: { sizes: string; form_factor: string }) => `${shot.sizes} ${shot.form_factor}`)).toEqual([
      '1440x900 wide',
      '780x1688 narrow',
    ]);
    for (const image of [...manifest.icons, ...manifest.screenshots] as { src: string; sizes: string }[]) {
      const file = await request.get(image.src);
      expect(file.status(), image.src).toBe(200);
      expect(file.headers()['content-type'], image.src).toBe('image/png');
      // A PNG states its own width and height, at bytes 16 and 20.
      const png = await file.body();
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, image.src).toBe(image.sizes);
    }

    const worker = await request.get('/sw.js');
    expect(worker.status()).toBe(200);
    expect(worker.headers()['cache-control']).toContain('no-cache');
  });

  test('every icon is the vermilion dot on paper', async ({ page }) => {
    await open(page);
    await expect(page.locator('meta[name="application-name"]')).toHaveAttribute('content', 'Koyomi');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Koyomi');

    const icons = await page.evaluate(async () => {
      const manifest = await (await fetch('/manifest.webmanifest')).json();
      const sources: string[] = [
        ...manifest.icons.map((icon: { src: string }) => icon.src),
        ...[...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((link) => link.getAttribute('href')!),
      ];
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      const out = [];
      for (const src of sources) {
        const image = new Image();
        image.src = src;
        await image.decode();
        context.clearRect(0, 0, 64, 64);
        context.drawImage(image, 0, 0, 64, 64);
        const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data].join(' ');
        out.push({ src: src.split('?')[0], centre: pixel(32, 32), corner: pixel(1, 1) });
      }
      return out;
    });

    expect(icons.map((icon) => icon.src).sort()).toEqual([
      '/apple-icon.png',
      '/favicon.ico',
      '/icon.svg',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/icon-maskable-512.png',
    ]);
    for (const icon of icons) expect(icon.centre, icon.src).toBe('196 88 69 255');
    // The two a launcher cuts to its own shape are paper to the edge, and solid: iOS paints transparency black.
    for (const src of ['/icons/icon-maskable-512.png', '/apple-icon.png']) {
      expect(icons.find((icon) => icon.src === src)!.corner, src).toBe('245 241 232 255');
    }
  });
});

test.describe('starting up', () => {
  // Without the worker, so that the stylesheet really is held back.
  test.use({ serviceWorkers: 'block' });

  for (const [scheme, colour] of [
    ['light', 'rgb(245, 241, 232)'],
    ['dark', 'rgb(29, 29, 27)'],
  ] as const) {
    test(`the window is the right colour before any stylesheet arrives (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.route('**/*.css', (route) => route.abort());
      await page.goto('/');
      await expect(page.locator('html')).toHaveCSS('background-color', colour);
      // The stylesheet is what colours the body, so this shows it never came.
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    });
  }

  test('asks nothing of any other server, fonts included', async ({ page, baseURL }) => {
    const elsewhere: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(baseURL!) && !url.startsWith('data:') && !url.startsWith('blob:')) elsewhere.push(url);
    });
    await open(page);
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => renderedFonts(page, 'header span.font-mincho')).toEqual(['Shippori Mincho']);
    await expect.poll(() => renderedFonts(page, 'header nav button')).toEqual(['Zen Kaku Gothic New']);
    expect(elsewhere).toEqual([]);
  });
});

test.describe('install', () => {
  test('is offered quietly in Plan, only when the browser can install, and never on its own', async ({ page }) => {
    await open(page);
    await page.keyboard.press('p');
    await expect(plan(page)).toBeVisible();
    await expect(installOffer(page)).toHaveCount(0);

    // Koyomi holds back the browser's banner and puts one line at the foot of Plan instead.
    expect(await browserOffersInstall(page)).toBe(true);
    await expect(installOffer(page)).toBeVisible();
    await expect(page.locator('body')).not.toHaveAttribute('data-install-dialogs');

    await installOffer(page).click();
    await expect(page.locator('body')).toHaveAttribute('data-install-dialogs', '1');
    await expect(installOffer(page)).toHaveCount(0);

    // Offered again later, then installed: nothing is left to offer.
    await browserOffersInstall(page);
    await expect(installOffer(page)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(installOffer(page)).toHaveCount(0);
  });

  test('is never offered at any other address', async ({ page, baseURL }) => {
    await open(page, `http://${OTHER_HOST}:${new URL(baseURL!).port}/`);
    await page.keyboard.press('p');
    await expect(plan(page)).toBeVisible();
    // The browser's own banner is still held back; Koyomi just has nothing to add.
    expect(await browserOffersInstall(page)).toBe(true);
    await expect(plan(page)).toContainText('Nothing waiting.');
    await expect(installOffer(page)).toHaveCount(0);
  });
});

test.describe('in a window of its own', () => {
  /** Opens Koyomi the way an installed app opens: its own window, no tabs, no address bar. */
  async function appWindow(testInfo: TestInfo, url: string, options: BrowserContextOptions) {
    const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), { channel: 'chrome', args: [`--app=${url}`], ...options });
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    await open(page, url);
    return { context, page };
  }

  test('on a desktop, nothing leans on the browser around it', async ({ baseURL }, testInfo) => {
    test.setTimeout(90_000);
    const { context, page } = await appWindow(testInfo, baseURL!, { viewport: { width: 1280, height: 800 } });
    try {
      expect(await standalone(page)).toBe(true);
      await expect(columns(page)).toHaveCount(7);
      // With no address bar, tabs or back button, nothing may lead out of the calendar.
      await expect(page.locator('a[href]')).toHaveCount(0);

      await addEvent(page, 'Standup', '10:00');
      await page.keyboard.press('p');
      await addToPlan(page, 'Send documents');
      expect(await fits(page)).toBe(true);

      // It is installed already: whatever the browser says, there is nothing to install.
      await browserOffersInstall(page);
      await expect(plan(page).getByRole('button', { name: 'Send documents', exact: true })).toBeVisible();
      await expect(installOffer(page)).toHaveCount(0);

      await reload(page);
      expect(await standalone(page)).toBe(true);
      await expect(event(page, 'Standup')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('on a phone, it keeps clear of the notch and the home bar, at any height', async ({ baseURL }, testInfo) => {
    test.setTimeout(90_000);
    // Sized like a phone and touched like one, but without Playwright's "mobile" switch: with it,
    // Chrome reports an ordinary tab rather than an app window.
    const { context, page } = await appWindow(testInfo, baseURL!, { viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
      expect(await standalone(page)).toBe(true);
      // An iPhone's cut-outs: 47px under the status bar, 34px over the home bar.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34 } });

      const bar = page.getByRole('button', { name: /^Plan/ });
      await expect.poll(async () => (await wordmark(page).boundingBox())!.y).toBeGreaterThanOrEqual(47);
      // The bar's paper runs to the bottom edge; its words stop above the home bar.
      const box = (await bar.boundingBox())!;
      expect(box.y + box.height).toBe(844);
      const label = (await bar.getByText('Plan', { exact: true }).boundingBox())!;
      expect(label.y + label.height).toBeLessThanOrEqual(844 - 34);
      await expect(columns(page)).toHaveCount(1);
      expect(await fits(page)).toBe(true);

      await bar.tap();
      await expect(plan(page)).toHaveCSS('padding-bottom', '34px');
      await plan(page).getByRole('button', { name: 'Close plan' }).tap();
      await expect(plan(page)).toBeHidden();

      // A shorter phone: the bar is still at the bottom and a time can still be tapped.
      await page.setViewportSize({ width: 360, height: 600 });
      await expect.poll(async () => (await bar.boundingBox())!.y + (await bar.boundingBox())!.height).toBe(600);
      const slot = await at(page, today(), '09:00');
      await slot.column.tap({ position: slot.position });
      await page.getByPlaceholder('What are you doing?').fill('School run');
      await page.keyboard.press('Enter');
      await expect(event(page, 'School run')).toBeVisible();
      expect(await fits(page)).toBe(true);

      // On its side, the notch is at one end: the week moves in from both.
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 21, left: 47, right: 47 } });
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(columns(page)).toHaveCount(7);
      await expect.poll(async () => (await wordmark(page).boundingBox())!.x).toBeGreaterThanOrEqual(47);
      const sunday = (await columns(page).last().boundingBox())!;
      expect(sunday.x + sunday.width).toBeLessThanOrEqual(844 - 47);
      expect(await fits(page)).toBe(true);
    } finally {
      await context.close();
    }
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('no field is small enough to make iOS zoom in', async ({ page }) => {
    await open(page);
    /** Every field on screen, with its type size. iOS zooms the page for anything under 16px. */
    const fields = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('input, select, textarea')].map((field) => ({
          field: field.getAttribute('aria-label') ?? field.getAttribute('placeholder') ?? field.tagName,
          size: parseFloat(getComputedStyle(field).fontSize),
        })),
      );
    const seen = new Set<string>();
    const check = async () => {
      for (const { field, size } of await fields()) {
        seen.add(field);
        expect(size, field).toBeGreaterThanOrEqual(16);
      }
    };

    const slot = await at(page, today(), '09:00');
    await slot.column.tap({ position: slot.position });
    await expect(page.getByPlaceholder('What are you doing?')).toBeVisible();
    await check();
    await page.getByPlaceholder('What are you doing?').fill('School run');
    await page.keyboard.press('Enter');

    await event(page, 'School run').tap();
    await expect(popover(page)).toBeVisible();
    await check();
    await page.getByRole('button', { name: 'Search' }).tap();
    await expect(page.getByRole('search')).toBeVisible();
    await check();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /^Plan/ }).tap();
    await plan(page).getByRole('button', { name: /Add$/ }).tap();
    await expect(page.getByPlaceholder('Something to do')).toBeVisible();
    await check();
    expect([...seen].sort()).toEqual(['Date', 'End', 'New Plan item', 'New event', 'Repeat', 'Search', 'Start', 'Title']);
  });
});

test.describe('the worker', () => {
  test('one visit installs it, and it answers the next', async ({ page, baseURL }) => {
    await open(page);
    // It takes over the page it was installed from, with no reload.
    await offlineReady(page);
    expect(await page.evaluate(() => navigator.serviceWorker.controller!.scriptURL)).toBe(`${baseURL}/sw.js`);
    const response = await page.reload();
    expect(response!.fromServiceWorker()).toBe(true);
    await expect(wordmark(page)).toBeVisible();
  });

  test('survives a browser restart, and Chrome finds it installable', async ({ baseURL }, testInfo) => {
    // Starts Chrome twice with a real profile, which is slow when the other tests are running too.
    test.setTimeout(90_000);
    const profile = testInfo.outputPath('profile');
    const launch = () => chromium.launchPersistentContext(profile, { channel: 'chrome', viewport: { width: 1440, height: 900 } });

    let context = await launch();
    let page = context.pages()[0] ?? (await context.newPage());
    await open(page, baseURL!);
    await addEvent(page, 'Flight to Lisbon', '06:00');
    await page.keyboard.press('p');
    await addToPlan(page, 'Pack');
    await expect.poll(async () => (await stored(page)).planItems.length).toBe(1);

    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);
    expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
    // This is a real profile, so Chrome really does offer to install, and Koyomi's one line appears.
    await expect(installOffer(page)).toBeVisible({ timeout: 15_000 });
    await context.close();

    context = await launch();
    page = context.pages()[0] ?? (await context.newPage());
    await open(page, baseURL!);
    await expect(event(page, 'Flight to Lisbon')).toContainText('06:00 – 07:00');
    await page.keyboard.press('p');
    await expect(plan(page).getByRole('button', { name: 'Pack', exact: true })).toBeVisible();
    await context.close();
  });

  test('the offline cache drops files from older releases, on a host that nests them too', async ({ page }) => {
    await open(page);
    // Let the page finish handing its own files to the worker first.
    await offlineReady(page);

    // Vercel serves hashed files one folder deeper than a local build: /_next/static/immutable/.
    const kept = await page.evaluate(async () => {
      const base = `${location.origin}/_next/static/immutable/`;
      const cache = await caches.open('kayomi-static-v1');
      for (const file of ['chunks/old-release.js', 'chunks/current.js', 'media/font.woff2']) await cache.put(base + file, new Response('x'));
      navigator.serviceWorker.controller!.postMessage({ type: 'warm', urls: [`${base}chunks/current.js`] });
      for (let i = 0; i < 40 && (await cache.match(`${base}chunks/old-release.js`)); i++) await new Promise((r) => setTimeout(r, 100));
      const has = async (file: string) => !!(await cache.match(base + file));
      return { oldRelease: await has('chunks/old-release.js'), current: await has('chunks/current.js'), font: await has('media/font.woff2') };
    });
    expect(kept).toEqual({ oldRelease: false, current: true, font: true });
  });

  test('works with no connection after one visit', async ({ page }) => {
    test.setTimeout(120_000);
    // Its own server, so that it can be taken away.
    const origin = 'http://localhost:4311';
    const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '4311'], { stdio: 'ignore' });
    const reachable = () =>
      fetch(origin).then(
        (r) => r.ok,
        () => false,
      );
    try {
      await expect.poll(reachable, { timeout: 60_000 }).toBe(true);
      await open(page, origin);
      await addEvent(page, 'Before the tunnel', '10:00');
      await offlineReady(page);

      server.kill();
      await expect.poll(reachable, { timeout: 30_000 }).toBe(false);

      await reload(page);
      await expect(event(page, 'Before the tunnel')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => renderedFonts(page, 'header span.font-mincho')).toEqual(['Shippori Mincho']);
      await expect.poll(() => renderedFonts(page, 'header nav button')).toEqual(['Zen Kaku Gothic New']);

      await addEvent(page, 'In the tunnel', '12:00');
      await page.keyboard.press('p');
      await addToPlan(page, 'Reply when back online');
      await expect.poll(() => storedTitles(page)).toEqual(['Before the tunnel', 'In the tunnel']);

      await reload(page);
      await expect(event(page, 'In the tunnel')).toBeVisible();
      await page.keyboard.press('p');
      await expect(plan(page).getByRole('button', { name: 'Reply when back online', exact: true })).toBeVisible();

      // The rest of the calendar works in the tunnel too: editing, scheduling from Plan, sending back.
      await event(page, 'In the tunnel').click();
      await popover(page).getByLabel('Start').fill('13:00');
      await page.keyboard.press('Enter');
      await expect(event(page, 'In the tunnel')).toContainText('13:00 – 14:00');
      await placeFromPlan(page, 'Reply when back online', '16:00');
      await event(page, 'Reply when back online').click();
      await popover(page).getByRole('button', { name: 'Back to Plan' }).click();
      await expect(event(page, 'Reply when back online')).toHaveCount(0);
      await expect(plan(page).getByRole('button', { name: 'Reply when back online', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Toggle ink mode' }).click();
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(29, 29, 27)');
      // Having no connection is not a failure, and nothing on screen treats it as one.
      await expect(page.getByText(/offline|no connection|couldn’t save/i)).toHaveCount(0);

      await reload(page);
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(29, 29, 27)');
      await expect(event(page, 'In the tunnel')).toContainText('13:00 – 14:00');
      await expect(event(page, 'Reply when back online')).toHaveCount(0);
      await expect.poll(() => renderedFonts(page, 'header span.font-mincho')).toEqual(['Shippori Mincho']);
    } finally {
      server.kill();
    }
  });
});

test.describe('from one release to the next', () => {
  /**
   * Stands in front of the test server at an address of its own, so that a test can change what
   * is deployed there: an older worker, a new release of the page, a slow connection.
   */
  async function deployment(port: number, upstream: string) {
    const send = upstream.startsWith('https:') ? overHttps : overHttp;
    const site = {
      origin: `http://localhost:${port}`,
      /** Served as /sw.js instead of the real one. */
      worker: null as string | null,
      /** Stamped on the page as an `x-release` header, to tell one release of it from another. */
      release: null as string | null,
      /** How long the page takes to arrive, in milliseconds. */
      delay: 0,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
    const server = createServer((request, response) => {
      if (request.url === '/sw.js' && site.worker !== null) {
        response.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-cache' }).end(site.worker);
        return;
      }
      const isPage = request.url === '/';
      const passed = send(upstream + request.url, { method: request.method, headers: { ...request.headers, host: new URL(upstream).host } }, (answer) => {
        const headers = { ...answer.headers, ...(isPage && site.release ? { 'x-release': site.release } : {}) };
        setTimeout(
          () => {
            response.writeHead(answer.statusCode!, headers);
            answer.pipe(response);
          },
          isPage ? site.delay : 0,
        );
      });
      passed.on('error', () => response.destroy());
      request.pipe(passed);
    });
    await new Promise<void>((resolve) => server.listen(port, resolve));
    return site;
  }

  test('a new release takes over without reloading the open calendar, and keeps what is saved', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const site = await deployment(4312, baseURL!);
    try {
      // An earlier release: the same worker with one line changed, which is all a browser needs to see a new one.
      site.worker = `// An earlier release.\n${readFileSync('public/sw.js', 'utf8')}`;
      await open(page, site.origin);
      await addEvent(page, 'Kept', '10:00');
      await page.keyboard.press('p');
      await addToPlan(page, 'Also kept');
      await offlineReady(page);
      // What earlier releases leave behind: a cache under a name no longer used, and a script nothing asks for now.
      await page.evaluate(async () => {
        await (await caches.open('kayomi-shell-v0')).put('/', new Response('an old page'));
        await (await caches.open('kayomi-static-v1')).put('/_next/static/chunks/old-release.js', new Response('x'));
        document.body.dataset.open = 'since before the update';
      });

      // The new release goes out. A browser looks for it at the next launch; this asks now.
      site.worker = null;
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())!.update();
      });
      await expect.poll(() => page.evaluate(() => caches.has('kayomi-shell-v0'))).toBe(false);

      // The calendar that was open is the same page, and still works.
      await expect(page.locator('body')).toHaveAttribute('data-open', 'since before the update');
      await addEvent(page, 'Added afterwards', '14:00');
      await expect.poll(() => storedTitles(page)).toEqual(['Added afterwards', 'Kept']);

      // The next launch is the new release, with everything still there and the old script gone.
      await reload(page);
      await expect(page.locator('body')).not.toHaveAttribute('data-open');
      await expect(event(page, 'Kept')).toBeVisible();
      await expect(event(page, 'Added afterwards')).toBeVisible();
      await page.keyboard.press('p');
      await expect(plan(page).getByRole('button', { name: 'Also kept', exact: true })).toBeVisible();
      await expect
        .poll(() => page.evaluate(async () => !!(await (await caches.open('kayomi-static-v1')).match('/_next/static/chunks/old-release.js'))))
        .toBe(false);
    } finally {
      await site.close();
    }
  });

  test('on a slow connection the saved calendar opens now, and the new release the time after', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const site = await deployment(4313, baseURL!);
    try {
      await open(page, site.origin);
      await addEvent(page, 'Kept', '10:00');
      await offlineReady(page);

      // A new release, behind a connection slower than anyone should be kept waiting for.
      site.release = 'next';
      site.delay = 6000;
      const first = await page.reload();
      await expect(event(page, 'Kept')).toBeVisible();
      expect(first!.headers()['x-release']).toBeUndefined();

      // The slow answer is not thrown away. It becomes the saved page, so the next launch has it.
      const saved = () => page.evaluate(async () => (await (await caches.open('kayomi-shell-v1')).match('/'))?.headers.get('x-release') ?? null);
      await expect.poll(saved, { timeout: 15_000 }).toBe('next');
      const second = await page.reload();
      expect(second!.headers()['x-release']).toBe('next');
      await expect(event(page, 'Kept')).toBeVisible();
    } finally {
      await site.close();
    }
  });

  test('what is saved outlives the caches and the worker', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Kept', '10:00');
    await page.keyboard.press('p');
    await addToPlan(page, 'Also kept');
    await offlineReady(page);

    // Everything the worker owns can go. The calendar is not among it.
    await page.evaluate(async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    });
    await reload(page);
    await expect(event(page, 'Kept')).toBeVisible();
    await page.keyboard.press('p');
    await expect(plan(page).getByRole('button', { name: 'Also kept', exact: true })).toBeVisible();
    // Same database, same version: no release so far has had to migrate anything.
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
  });

  test('opens a calendar saved by the first release, and leaves it as it was', async ({ page }) => {
    const stamp = '2026-10-03T08:00:00.000Z';
    const time = (hour: number, minute: number) => {
      const d = new Date();
      d.setHours(hour, minute, 0, 0);
      return d.toISOString();
    };
    // One of everything the first release could save: a series, an event from Plan, and both kinds of Plan item.
    const saved: Parameters<typeof seed>[1] = {
      events: [
        { id: 'e-1', title: 'Project review', start: time(10, 0), end: time(11, 30), allDay: false, category: 'work', planItemId: null, recurrence: { freq: 'weekly', until: null, except: [] }, createdAt: stamp, updatedAt: stamp },
        { id: 'e-2', title: 'Gym', start: time(7, 30), end: time(8, 30), allDay: false, category: 'life', planItemId: 'p-2', recurrence: null, createdAt: stamp, updatedAt: stamp },
      ],
      planItems: [
        { id: 'p-1', title: 'Send documents', status: 'open', createdAt: stamp, updatedAt: stamp },
        { id: 'p-2', title: 'Gym', status: 'completed', createdAt: stamp, updatedAt: stamp },
      ],
    };
    await seed(page, saved);

    await open(page);
    await expect(event(page, 'Project review')).toContainText('10:00 – 11:30');
    await expect(event(page, 'Gym')).toContainText('07:30 – 08:30');
    await page.keyboard.press('p');
    await expect(plan(page).getByRole('button', { name: 'Send documents', exact: true })).toBeVisible();
    await expect(plan(page).getByRole('button', { name: /Completed/ })).toContainText('1');

    // Opening it changes nothing on disk.
    expect(await stored(page)).toEqual(saved);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
  });
});
