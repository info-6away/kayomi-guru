import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { EVENT_FIELDS } from '../../lib/calendars/normalize';
import { AHEAD_DAYS, BACK_DAYS } from '../../lib/calendars/window';
import { SCOPES } from '../../lib/server/google';
import { read } from './contrast';

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

    // Three ways in, all to the same place, and the footer's two quiet links. Nothing else.
    await expect(page.getByRole('link')).toHaveCount(5);
    await expect(page.locator('a[href="/open"]')).toHaveCount(3);
    await expect(page.getByRole('contentinfo').getByRole('link')).toHaveText(['Privacy', 'Terms']);

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

// The two pages the landing page links to. They say what Koyomi keeps and on what terms it is
// offered, so what they say is held to what the code does.
test.describe('privacy and terms', () => {
  const OPERATOR = '6Away AI FZE LLC, United Arab Emirates';
  const CONTACT = 'privacy@6away.ai';
  const LIMITED_USE =
    'Koyomi’s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.';
  const text = async (page: Page) => (await page.getByRole('main').innerText()).replace(/\s+/g, ' ');

  test('the footer leads to both pages, and they lead back', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));

    await page.goto('/home');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page).toHaveTitle('Privacy — Koyomi');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://koyomi.guru/privacy');

    await page.getByRole('contentinfo').getByRole('link', { name: 'Terms' }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page).toHaveTitle('Terms — Koyomi');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://koyomi.guru/terms');
    // Terms points at Privacy for what is kept.
    await page.getByRole('main').getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy');

    // Like the landing page, these are pages and not the app: nothing to install, no worker.
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);

    // The wordmark goes home, and Open Koyomi to the calendar.
    await page.getByRole('link', { name: 'Koyomi, home' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('A calm calendar for planning your own life.');
    await page.goto('/terms');
    await page.getByRole('link', { name: /Open Koyomi/ }).click();
    await expect(page.locator('[data-day]')).toHaveCount(7);
    expect(problems).toEqual([]);
  });

  test('the privacy page says what the code does', async ({ page }) => {
    await page.goto('/privacy');
    const said = await text(page);

    // Who runs Koyomi, and the one address to write to.
    expect(said).toContain(`It is run by ${OPERATOR}.`);
    const mail = await page.getByRole('main').locator('a[href^="mailto:"]').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(mail.length).toBeGreaterThanOrEqual(3);
    expect(new Set(mail)).toEqual(new Set([`mailto:${CONTACT}`]));

    // Exactly the permissions the code asks Google for, by name, and no other.
    const requested = SCOPES.map((scope) => scope.split('/').pop()!);
    expect(requested).toEqual(['calendar.calendarlist.readonly', 'calendar.events.readonly']);
    expect([...new Set(said.match(/calendar\.[a-z.]*[a-z]/g))].sort()).toEqual([...requested].sort());
    expect(said).toContain('It cannot create, change or delete anything in your Google Calendar.');

    // The span that is read, and the fields. If either changes in the code, this page changes with it.
    expect([BACK_DAYS / 7, AHEAD_DAYS / 7]).toEqual([5, 27]);
    expect(said).toContain('from five weeks back to twenty-seven weeks ahead');
    expect(EVENT_FIELDS).toBe('nextPageToken,nextSyncToken,items(id,status,summary,htmlLink,updated,eventType,start,end,attendees(self,responseStatus))');
    for (const part of ['its title, its start and end', 'confirmed, tentative or cancelled', 'when it last changed', 'a link to the event at Google', 'its type', 'your own reply to an invitation']) {
      expect(said, part).toContain(part);
    }
    expect(said).toContain('Koyomi does not ask Google for descriptions, locations, guest lists or meeting links');

    // Where it is kept, and how.
    for (const part of [
      'They are not sent to our servers and we cannot see them. Ordinary use needs no account.',
      'They are not stored there and are not written to its log.',
      'the refresh token Google issued, encrypted with AES-256-GCM',
      'It holds no email address, no calendar names and no events.',
      'Google’s tokens never reach your browser.',
      'It is an HttpOnly cookie, which page scripts cannot read.',
      'your 6Away identifier, your name, your email address and your sign-in credential',
      'for up to thirty days',
    ]) {
      expect(said, part).toContain(part);
    }

    // What it is never used for, in Google's required words.
    expect(said).toContain('Your Google Calendar data is not sold.');
    expect(said).toContain('not used for advertising, not used for analytics or to build a profile of you, and not used to train artificial-intelligence or machine-learning models');
    expect(said).toContain(LIMITED_USE);
    // The policy it names is a link to Google's own page, inside that very sentence.
    const policy = page.locator('p', { hasText: 'Limited Use requirements' }).getByRole('link', { name: 'Google API Services User Data Policy', exact: true });
    await expect(policy).toBeVisible();
    await expect(policy).toHaveAttribute('href', 'https://developers.google.com/terms/api-services-user-data-policy');

    // Who else handles it: each of the three, and exactly what reaches it.
    expect(said).toContain('It is not given to anyone for purposes of their own.');
    for (const part of [
      'Vercel hosts the website and the server. Your Google Calendar events and calendar names pass through that server on their way from Google to your device. They are not stored there.',
      'Neon hosts the database, in the United States. It stores only the connection record described above. It receives no events and no calendar names.',
      '6Away provides sign-in. It learns that you signed in to Koyomi. It does not receive your Google Calendar events, your calendar names or Google’s tokens.',
    ]) {
      expect(said, part).toContain(part);
    }

    // Disconnecting, and deleting.
    for (const part of [
      'The connection record is kept until you disconnect or ask us to delete it.',
      'asks Google to revoke Koyomi’s access, deletes the record from our server, signs that device out and deletes its copy of your Google calendars',
      'Your Koyomi calendar is not touched.',
      'marked as needing reconnection, until you reconnect or disconnect',
      `You can also ask us to delete the record by writing to ${CONTACT}.`,
    ]) {
      expect(said, part).toContain(part);
    }
  });

  test('the terms are short, and say on what terms Koyomi is offered', async ({ page }) => {
    await page.goto('/terms');
    const said = await text(page);
    expect(said).toContain(`Koyomi is provided by ${OPERATOR}.`);
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
      'What Koyomi is',
      'Your calendar is on your device',
      'Connected calendars',
      'As it is',
      'Fair use',
      'Changes',
      'Liability',
      'Privacy',
      'Governing law',
    ]);
    for (const part of [
      'We keep no copy and there is no cloud backup, so we cannot restore them.',
      'The connection is read-only: Koyomi cannot change your Google Calendar.',
      'your use of them is subject to their own terms',
      'Koyomi is provided as it is and as available.',
      'Use Koyomi lawfully and reasonably.',
      'To the extent the law allows',
      'These terms are governed by the laws of the United Arab Emirates.',
    ]) {
      expect(said, part).toContain(part);
    }
    await expect(page.getByRole('main').locator('a[href^="mailto:"]')).toHaveAttribute('href', `mailto:${CONTACT}`);
    // Short: a page or two, not a contract.
    expect(said.split(' ').length).toBeLessThan(450);
  });

  for (const path of ['/privacy', '/terms']) {
    test(`${path} is built like a page: one title, sections in order, links that say where they go`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(5);
      // No heading level is skipped, and every heading is inside the page's main part.
      expect(await page.locator('h3, h4, h5, h6').count()).toBe(0);
      expect(await page.locator('h1, h2').count()).toBe(await page.getByRole('main').locator('h1, h2').count());
      // Every link and button has words or a label of its own.
      const unnamed = await page.locator('a, button').evaluateAll((els) => els.filter((el) => !(el.getAttribute('aria-label') || el.textContent || '').trim()).length);
      expect(unnamed).toBe(0);
      await expect(page.getByText(/^LAST UPDATED \d{1,2} [A-Z]+ 20\d\d$/)).toBeVisible();
      // The keyboard reaches the first link, and it shows.
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Koyomi, home' })).toBeFocused();
    });
  }
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    /** Reads the page a screen at a time, top to bottom: everything on it must be easy to read. */
    const readable = async (page: Page, name: string) => {
      await page.evaluate(() => document.fonts.ready);
      let pieces = 0;
      for (let screen = 0; screen < 40; screen++) {
        const readings = await read(page);
        pieces += readings.length;
        const hard = readings.filter((r) => r.ratio < (r.large ? 3 : 4.5)).map((r) => `"${r.text}" ${r.ratio}:1 at ${r.size}px`);
        expect(hard, `${name}, screen ${screen + 1}: text that is hard to read`).toEqual([]);
        expect(readings.filter((r) => r.faded).map((r) => r.text), `${name}, screen ${screen + 1}: text dimmed with opacity`).toEqual([]);
        const more = await page.evaluate(() => {
          const before = scrollY;
          scrollBy(0, Math.floor(innerHeight * 0.85));
          return scrollY > before;
        });
        if (!more) break;
      }
      expect(pieces, `${name}: text found`).toBeGreaterThan(20);
    };

    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      test(`privacy, terms and the landing page are easy to read from top to bottom on a ${width}×${height} screen`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        for (const path of ['/privacy', '/terms', '/home']) {
          await page.goto(path);
          await readable(page, `${path} at ${width}`);
          // Nothing runs off the side.
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `${path}: sideways scroll`).toBe(false);
        }

        // Two places by name. The landing page's last line, which gained its two links...
        await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
        const footer = (await read(page)).filter((r) => ['koyomi.guru', 'Privacy', 'Terms'].includes(r.text));
        expect(footer.map((r) => r.text).sort()).toEqual(['Privacy', 'Terms', 'koyomi.guru']);
        expect(footer.filter((r) => r.ratio < 4.5 || r.faded).map((r) => `"${r.text}" ${r.ratio}:1`)).toEqual([]);

        // ...and the sample week's times. The one on Sunday sits on a tinted event in the shaded
        // weekend, and at night it used to be 4.3:1.
        if (width >= 680) {
          await page.getByRole('region', { name: 'A sample week' }).scrollIntoViewIfNeeded();
          const times = (await read(page)).filter((r) => /^\d\d:\d\d$/.test(r.text));
          expect(times.map((r) => r.text)).toContain('18:00');
          expect(times.filter((r) => r.ratio < 4.5).map((r) => `"${r.text}" ${r.ratio}:1`)).toEqual([]);
        }
      });
    }
  });
}

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

  test('privacy and terms are pages of koyomi.guru, and the calendar’s host sends them there', async ({ request }) => {
    for (const [path, title] of [
      ['/privacy', 'Privacy'],
      ['/terms', 'Terms'],
    ]) {
      for (const host of ['koyomi.guru', 'www.koyomi.guru']) {
        const onSite = await get(request, host, path);
        expect([onSite.status(), onSite.headers().location], `${host}${path}`).toEqual([200, undefined]);
        const html = await onSite.text();
        expect(html, `${host}${path}`).toContain(`<title>${title} — Koyomi</title>`);
        expect(html, `${host}${path}`).toContain(`<link rel="canonical" href="https://koyomi.guru${path}"`);
        expect(html, `${host}${path}`).not.toContain('rel="manifest"');
      }
      // One canonical place: asked of the calendar's host, the page is on the site.
      const onApp = await get(request, 'app.koyomi.guru', path);
      expect([onApp.status(), onApp.headers().location], `app.koyomi.guru${path}`).toEqual([308, `https://koyomi.guru${path}`]);
      // A host with no domain of its own, and one that only looks like the calendar's, serve it.
      for (const host of ['kayomi-guru.vercel.app', 'notapp.koyomi.guru']) {
        const elsewhere = await get(request, host, path);
        expect([elsewhere.status(), elsewhere.headers().location], `${host}${path}`).toEqual([200, undefined]);
        expect(await elsewhere.text(), `${host}${path}`).toContain(`<title>${title} — Koyomi</title>`);
      }
    }
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
