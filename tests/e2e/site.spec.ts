import { expect, test, type APIRequestContext } from '@playwright/test';

// The landing page (koyomi.guru) and the calendar (app.koyomi.guru) come from one build.
// On any other host, such as this test server, the landing page is at /home and the calendar at /.

test.describe('landing page', () => {
  test('shows the design and leads to the calendar', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));

    await page.goto('/home');
    await expect(page).toHaveTitle('Koyomi — a calm calendar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('A calm calendar for planning your own life.');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Things with a time.', 'Things without one yet.', 'Move one to the other.']);
    await expect(page.getByText('Your day should have space in it.')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/koyomi\.guru\/?$/);

    // Three ways in, all to the same place.
    const links = page.getByRole('link');
    await expect(links).toHaveCount(3);
    for (const link of await links.all()) await expect(link).toHaveAttribute('href', '/open');

    // The landing page is a page, not the app: nothing to install, no worker.
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect(problems).toEqual([]);

    await page.getByRole('link', { name: /Begin/ }).click();
    await expect(page.locator('[data-day]')).toHaveCount(7);
    await expect(page).toHaveTitle('Koyomi');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  });

  test('ink mode works and is remembered', async ({ page }) => {
    await page.goto('/home');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Toggle ink mode' }).click();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(29, 29, 27)');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the whole week on a desktop, three days on a phone', async ({ page }) => {
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/home');
    for (const day of ['MON', 'WED', 'THU', 'SUN']) await expect(page.getByText(day, { exact: true })).toBeVisible();
    expect(await sideways()).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const day of ['MON', 'TUE', 'WED']) await expect(page.getByText(day, { exact: true })).toBeVisible();
    for (const day of ['THU', 'SUN']) await expect(page.getByText(day, { exact: true })).toBeHidden();
    expect(await sideways()).toBe(false);
    // No label in the sample week is cut short.
    const clipped = await page.locator('section[aria-label="A sample week"] .truncate').evaluateAll((els) =>
      els.filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth).map((el) => el.textContent),
    );
    expect(clipped).toEqual([]);
  });
});

test.describe('host names', () => {
  // Only the Host header tells the two sites apart, so that is all these requests change.
  const get = (request: APIRequestContext, host: string, path: string) => request.get(path, { headers: { host }, maxRedirects: 0 });
  const LANDING = 'A calm calendar for planning your own life.';

  test('koyomi.guru shows the landing page at /', async ({ request }) => {
    const response = await get(request, 'koyomi.guru', '/');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(LANDING);
    expect(html).not.toContain('rel="manifest"');
  });

  test('app.koyomi.guru, and any other host, shows the calendar at /', async ({ request }) => {
    // The last two only look like the site's host.
    for (const host of ['app.koyomi.guru', 'kayomi-guru.vercel.app', 'notkoyomi.guru', 'koyomi.guru.example.com']) {
      const response = await get(request, host, '/');
      expect(response.status(), host).toBe(200);
      const html = await response.text();
      expect(html, host).not.toContain(LANDING);
      expect(html, host).toContain('rel="manifest"');
    }
  });

  test('www.koyomi.guru shows the landing page too; the code never redirects one to the other', async ({ request }) => {
    // Which of the two is the main address is set in Vercel. A redirect here as well once sent
    // visitors round in a loop, so both hosts must simply answer.
    for (const host of ['koyomi.guru', 'www.koyomi.guru']) {
      for (const path of ['/', '/anything']) {
        const response = await get(request, host, path);
        expect(response.headers().location, `${host}${path}`).toBeUndefined();
      }
      const home = await get(request, host, '/');
      expect(home.status(), host).toBe(200);
      expect(await home.text(), host).toContain(LANDING);
    }
  });

  test('/open goes to app.koyomi.guru from the site, and to / anywhere else', async ({ request }) => {
    for (const host of ['koyomi.guru', 'www.koyomi.guru']) {
      const fromSite = await get(request, host, '/open');
      expect([fromSite.status(), fromSite.headers().location], host).toEqual([307, 'https://app.koyomi.guru/']);
    }
    const elsewhere = await get(request, 'kayomi-guru.vercel.app', '/open');
    expect([elsewhere.status(), elsewhere.headers().location]).toEqual([307, '/']);
  });

  test('/home is only an address on hosts that have no domain of their own', async ({ request }) => {
    for (const host of ['koyomi.guru', 'www.koyomi.guru']) {
      const onSite = await get(request, host, '/home');
      expect([onSite.status(), onSite.headers().location], host).toEqual([308, '/']);
    }
    const onApp = await get(request, 'app.koyomi.guru', '/home');
    expect([onApp.status(), onApp.headers().location]).toEqual([308, 'https://koyomi.guru/']);
    const elsewhere = await get(request, 'kayomi-guru.vercel.app', '/home');
    expect(elsewhere.status()).toBe(200);
    expect(await elsewhere.text()).toContain(LANDING);
  });
});
