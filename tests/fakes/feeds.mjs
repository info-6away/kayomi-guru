// A stand-in for wherever calendars are published (Outlook, or anywhere else that gives a
// calendar a private link), so the browser tests never fetch a real one. Started by Playwright
// alongside the app, on a port of its own: it is the one address the app's test settings let a
// calendar link name as it is (KOYOMI_TEST_LINK_ORIGIN), and everything else a link might lead
// to goes through the app's checks like any other address.
//
//   /feeds/:token/calendar.ics   a calendar, as the test last set it
//   /__fake/feeds/:token         how a test sets one up, and sees what was asked of it

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';

const PORT = Number(process.env.FAKE_LINK_PORT ?? 4317);
const ORIGIN = `http://localhost:${PORT}`;

/**
 * Each calendar by its token: what it says, and how it answers.
 * - `ics`: the calendar's text.
 * - `status`: answer with this instead (404 for a withdrawn link, 503 for a bad moment).
 * - `html`: answer with a sign-in page instead of a calendar.
 * - `redirect`: send the app somewhere else instead.
 * - `validators`: give an ETag and Last-Modified, and answer 304 when they still hold.
 * - `gzip`: send it packed.
 * - `hold`: keep the answer back until told.
 * And what was asked of it: each request's conditional headers, never anything else.
 */
const feeds = new Map();
const feed = (token) => {
  if (!feeds.has(token)) feeds.set(token, { ics: null, status: null, html: false, redirect: null, validators: true, gzip: false, hold: false, waiting: [], asked: [], changed: new Date('2026-10-01T08:00:00Z') });
  return feeds.get(token);
};

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const read = (req) =>
  new Promise((resolve) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => resolve(text ? JSON.parse(text) : {}));
  });

async function serve(req, res, token) {
  const f = feed(token);
  f.asked.push({ ifNoneMatch: req.headers['if-none-match'] ?? null, ifModifiedSince: req.headers['if-modified-since'] ?? null, cookie: !!req.headers.cookie });
  if (f.hold) await new Promise((resolve) => f.waiting.push(resolve));
  if (f.redirect) {
    res.writeHead(302, { location: f.redirect });
    return res.end();
  }
  if (f.status) return res.writeHead(f.status).end();
  if (f.html) return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Sign in</title><p>Sign in to see this calendar.</p>');
  if (!f.ics) return res.writeHead(404).end();
  const etag = `"${createHash('sha256').update(f.ics).digest('hex').slice(0, 16)}"`;
  const lastModified = f.changed.toUTCString();
  if (f.validators && req.headers['if-none-match'] === etag) return res.writeHead(304, { etag }).end();
  const headers = { 'content-type': 'text/calendar; charset=utf-8', ...(f.validators ? { etag, 'last-modified': lastModified } : {}) };
  if (f.gzip) return res.writeHead(200, { ...headers, 'content-encoding': 'gzip' }).end(gzipSync(f.ics));
  res.writeHead(200, headers).end(f.ics);
}

async function control(req, res, url) {
  if (url.pathname === '/__fake/health') return json(res, 200, { ok: true });
  const match = /^\/__fake\/feeds\/([^/]+)$/.exec(url.pathname);
  if (!match) return json(res, 404, {});
  const f = feed(match[1]);
  if (req.method === 'GET') return json(res, 200, { asked: f.asked, held: f.waiting.length });
  // PUT /__fake/feeds/:token  { ics?, status?, html?, redirect?, validators?, gzip?, hold? }
  const data = await read(req);
  if ('ics' in data && data.ics !== f.ics) {
    f.ics = data.ics;
    f.changed = new Date(f.changed.getTime() + 60_000);
  }
  for (const key of ['status', 'html', 'redirect', 'validators', 'gzip']) if (key in data) f[key] = data[key];
  if ('hold' in data) {
    f.hold = data.hold;
    if (!data.hold) f.waiting.splice(0).forEach((answer) => answer());
  }
  json(res, 200, {});
}

createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  const served = /^\/feeds\/([^/]+)\/calendar\.ics$/.exec(url.pathname);
  (served ? serve(req, res, served[1]) : control(req, res, url)).catch((error) => json(res, 500, { error: String(error?.message ?? error) }));
}).listen(PORT, () => console.log(`fake calendar feeds on ${ORIGIN}`));
