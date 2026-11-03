import { expect, test } from '@playwright/test';
import { hostKind, robotsFor, SITE_URL, SITEMAP } from '../../lib/seo';

// What search engines are told on each of the deployment's hosts.

test('host names map to the right site, ignoring case and port', () => {
  expect(hostKind('koyomi.guru')).toBe('site');
  expect(hostKind('WWW.Koyomi.Guru')).toBe('site');
  expect(hostKind('app.koyomi.guru')).toBe('app');
  expect(hostKind('app.koyomi.guru:443')).toBe('app');
  expect(hostKind('kayomi-guru.vercel.app')).toBe('other');
  expect(hostKind('localhost:3000')).toBe('other');
  expect(hostKind('evil.koyomi.guru.example.com')).toBe('other');
  expect(hostKind(null)).toBe('other');
});

test('koyomi.guru advertises its sitemap and keeps the API out', () => {
  for (const host of ['koyomi.guru', 'www.koyomi.guru']) {
    const r = robotsFor(host);
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(r.rules).toEqual({ userAgent: '*', allow: '/', disallow: '/api/' });
  }
});

test('the calendar host stays crawlable but has no sitemap of its own', () => {
  const r = robotsFor('app.koyomi.guru');
  expect(r.sitemap).toBeUndefined();
  expect(r.rules).toEqual({ userAgent: '*', allow: '/', disallow: '/api/' });
});

test('deployment and local addresses are kept out of search', () => {
  for (const host of ['kayomi-guru.vercel.app', 'localhost:3000', undefined]) {
    const r = robotsFor(host);
    expect(r.sitemap).toBeUndefined();
    expect(r.rules).toEqual({ userAgent: '*', disallow: '/' });
  }
});

test('the sitemap lists only koyomi.guru pages, each once', () => {
  const urls = SITEMAP.map((e) => e.url);
  expect(urls).toEqual([`${SITE_URL}/`, `${SITE_URL}/privacy`, `${SITE_URL}/terms`]);
  expect(new Set(urls).size).toBe(urls.length);
  for (const u of urls) expect(new URL(u).host).toBe('koyomi.guru');
});
