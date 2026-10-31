import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { accountKey } from '../../lib/server/connections';
import { LinkError, MAX_FEED_BYTES, canonicalLink, fetchLink, forbidden, linkOf, type Resolve } from '../../lib/server/fetchlink';
import { LINK_CALENDAR, feedName, forgetPace, linkProvider, nameOf } from '../../lib/server/link';
import { ProviderError } from '../../lib/server/provider';

// Calendar links: an address a person pastes, which Koyomi's server then fetches. These are the
// tests that it fetches nothing it should not (private networks, the cloud's metadata service,
// anything a redirect or a name leads to there), that what it fetches is limited and must be a
// calendar, and that the link itself is never said back. Nothing here reaches the internet: a
// stand-in server on this machine answers, through the one address the tests may name.

const KEY = 'b'.repeat(64);
const OWN = 'app.koyomi.test';
const NOT_FOUND = Object.assign(new Error('no such name'), { code: 'ENOTFOUND' });

/** A calendar, with everything a feed might carry that Koyomi does not keep. */
const calendar = (...events: string[][]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stand-in//EN', 'X-WR-CALNAME:Team rota', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const event = (uid: string, start: string, ...more: string[]) => [
  'BEGIN:VEVENT',
  `UID:${uid}`,
  `SUMMARY:${uid}`,
  `DTSTART:${start}`,
  'DURATION:PT1H',
  'DESCRIPTION:PRIVATE NOTES',
  'LOCATION:PRIVATE ROOM',
  'ORGANIZER;CN=Boss:mailto:boss@private.test',
  'ATTENDEE:mailto:someone@private.test',
  'CONTACT:PRIVATE CONTACT',
  'COMMENT:PRIVATE COMMENT',
  'ATTACH:https://files.private.test/x',
  'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.private.test/x',
  ...more,
  'END:VEVENT',
];

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
}

/** A stand-in for a calendar's server, on this machine, and every request that reached it. */
async function source(answer: (request: IncomingMessage, response: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method ?? '', path: request.url ?? '', headers: request.headers });
    answer(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    seen,
    url: (path: string) => new URL(`${origin}${path}`),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const failureOf = (error: unknown) => (error instanceof LinkError ? error.failure : String(error));
const kindOf = (error: unknown) => (error instanceof ProviderError ? error.kind : String(error));

test('only an https link to the public internet is taken: no other scheme, port, password, private name or address', () => {
  for (const bad of [
    'http://calendar.example.com/a.ics',
    'file:///etc/passwd',
    'ftp://calendar.example.com/a.ics',
    'data:text/calendar,BEGIN:VCALENDAR',
    'javascript:alert(1)',
    'gopher://calendar.example.com/',
    'https://user:secret@calendar.example.com/a.ics',
    'https://user@calendar.example.com/a.ics',
    'https://calendar.example.com:8443/a.ics',
    'https://calendar.example.com:80/a.ics',
    'https://localhost/a.ics',
    'https://LOCALHOST./a.ics',
    'https://cal.localhost/a.ics',
    'https://printer.local/a.ics',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://intranet/a.ics',
    'https://server.home.arpa/a.ics',
    'https://127.0.0.1/a.ics',
    'https://127.1/a.ics',
    'https://2130706433/a.ics',
    'https://0x7f000001/a.ics',
    'https://0177.0.0.1/a.ics',
    'https://10.1.2.3/a.ics',
    'https://172.16.0.1/a.ics',
    'https://192.168.1.10/a.ics',
    'https://100.64.0.1/a.ics',
    'https://169.254.169.254/latest/meta-data/',
    'https://0.0.0.0/a.ics',
    'https://224.0.0.1/a.ics',
    'https://[::1]/a.ics',
    'https://[::]/a.ics',
    'https://[::ffff:127.0.0.1]/a.ics',
    'https://[::ffff:169.254.169.254]/a.ics',
    'https://[fd00:ec2::254]/a.ics',
    'https://[fe80::1]/a.ics',
    'https://[fc00::1]/a.ics',
    'https://[2001:db8::1]/a.ics',
    'https://[64:ff9b::a9fe:a9fe]/a.ics',
    'https://[2002:a9fe:a9fe::1]/a.ics',
    `https://${OWN}/api/calendars`,
    `https://calendar.example.com/${'x'.repeat(2048)}`,
    'webcal://localhost/a.ics',
    'webcal://10.0.0.1/a.ics',
    'not a link',
    '',
  ]) {
    expect(linkOf(bad, OWN), bad).toBeNull();
  }
  for (const value of [undefined, null, 42, {}, ['https://calendar.example.com/a.ics']]) expect(linkOf(value, OWN)).toBeNull();

  // What is taken: Outlook's published links, others', webcal written as https, the usual port
  // left out, and no fragment.
  expect(linkOf('https://outlook.office365.com/owa/calendar/abc@contoso.com/Tok3n/calendar.ics', OWN)?.href).toBe('https://outlook.office365.com/owa/calendar/abc@contoso.com/Tok3n/calendar.ics');
  expect(linkOf(' webcal://p01-calendars.icloud.com/published/2/AbC ', OWN)?.href).toBe('https://p01-calendars.icloud.com/published/2/AbC');
  expect(linkOf('WEBCALS://calendar.example.com/a.ics', OWN)?.href).toBe('https://calendar.example.com/a.ics');
  expect(linkOf('https://Calendar.Example.com:443/a.ics#private', OWN)?.href).toBe('https://calendar.example.com/a.ics');
  expect(linkOf('https://93.184.215.14/a.ics', OWN)?.href).toBe('https://93.184.215.14/a.ics');
});

test('the ranges Koyomi never fetches from, in both families, and the public ones it does', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '100.100.100.200',
    '0.0.0.0',
    '192.0.2.1',
    '198.18.0.1',
    '203.0.113.9',
    '239.255.255.250',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:10.0.0.1',
    '::ffff:8.8.8.8',
    'fd00:ec2::254',
    'fe80::1%eth0',
    'ff02::1',
    '2001:db8::1',
    '64:ff9b::808:808',
    'not an address',
    '',
  ]) {
    expect(forbidden(address), address).toBe(true);
  }
  for (const address of ['8.8.8.8', '93.184.215.14', '52.96.0.1', '2606:4700:4700::1111', '2603:1036::1']) expect(forbidden(address), address).toBe(false);
});

test('a link is known by one keyed word however it was pasted, which gives nothing of it away', () => {
  const key = (input: string, subject = 'user-1') => accountKey(KEY, subject, 'link', canonicalLink(linkOf(input, OWN)!));
  const one = key('https://calendar.example.com/owa/Tok3n/calendar.ics');
  for (const same of ['webcal://calendar.example.com/owa/Tok3n/calendar.ics', 'https://CALENDAR.example.com:443/owa/Tok3n/calendar.ics', 'https://calendar.example.com/owa/Tok3n/calendar.ics#x']) expect(key(same), same).toBe(one);
  // The token is the link's own: another case, another link.
  expect(key('https://calendar.example.com/owa/tok3n/calendar.ics')).not.toBe(one);
  expect(key('https://calendar.example.com/owa/Tok3n/calendar.ics?x=1')).not.toBe(one);
  // Another person's word for the very same link is another word.
  expect(key('https://calendar.example.com/owa/Tok3n/calendar.ics', 'user-2')).not.toBe(one);
  expect(one).not.toMatch(/Tok3n|calendar|example/i);
  expect(canonicalLink(new URL('HTTPS://Cal.Example.COM/A/B.ics?Token=XyZ'))).toBe('https://cal.example.com/A/B.ics?Token=XyZ');
});

test('a name that leads somewhere private is not connected to, whichever of its addresses is private', async () => {
  for (const found of [[{ address: '10.0.0.7', family: 4 }], [{ address: '169.254.169.254', family: 4 }], [{ address: '::1', family: 6 }], [{ address: '93.184.215.14', family: 4 }, { address: '192.168.1.1', family: 4 }], [{ address: 'fd00::1', family: 6 }]]) {
    const asked: string[] = [];
    const resolve: Resolve = async (hostname) => (asked.push(hostname), found);
    const error = await fetchLink(new URL('https://calendar.example.com/a.ics'), { own: OWN, resolve }).catch((e) => e);
    expect(failureOf(error), JSON.stringify(found)).toBe('forbidden');
    // Looked up once, by the connection itself: there is no second lookup to answer differently.
    expect(asked).toEqual(['calendar.example.com']);
  }
  // A name that does not resolve is a moment's trouble, not the person's.
  expect(failureOf(await fetchLink(new URL('https://calendar.example.com/a.ics'), { own: OWN, resolve: async () => Promise.reject(NOT_FOUND) }).catch((e) => e))).toBe('busy');
  expect(failureOf(await fetchLink(new URL('https://calendar.example.com/a.ics'), { own: OWN, resolve: async () => [] }).catch((e) => e))).toBe('busy');
});

test('a redirect is followed only a few times, and each new address is checked from the start', async () => {
  const resolve: Resolve = async () => [{ address: '10.0.0.9', family: 4 }];
  const s = await source((request, response) => {
    const to = (location: string) => response.writeHead(302, { location }).end();
    const path = request.url ?? '';
    if (path === '/to-metadata') return to('https://169.254.169.254/latest/meta-data/');
    if (path === '/to-loopback') return to('https://127.0.0.1/a.ics');
    if (path === '/to-ipv6') return to('https://[::1]/a.ics');
    if (path === '/to-http') return to('http://calendar.example.com/a.ics');
    if (path === '/to-port') return to('https://calendar.example.com:8443/a.ics');
    if (path === '/to-private-name') return to('https://calendar.example.com/a.ics');
    if (path === '/to-internal') return to('https://metadata.google.internal/');
    if (path === '/to-file') return to('file:///etc/passwd');
    if (path === '/loop-a') return to('/loop-b');
    if (path === '/loop-b') return to('/loop-a');
    if (path.startsWith('/hop')) {
      const n = Number(path.slice(4));
      return n > 0 ? to(`/hop${n - 1}`) : response.writeHead(200).end(calendar(event('fine', '20261007T090000Z')));
    }
    if (path === '/no-location') return response.writeHead(301).end();
    response.writeHead(404).end();
  });
  try {
    for (const path of ['/to-metadata', '/to-loopback', '/to-ipv6', '/to-http', '/to-port', '/to-private-name', '/to-internal', '/to-file']) {
      expect(failureOf(await fetchLink(s.url(path), { own: OWN, resolve, test: s.origin }).catch((e) => e)), path).toBe('forbidden');
    }
    expect(failureOf(await fetchLink(s.url('/loop-a'), { own: OWN, test: s.origin }).catch((e) => e))).toBe('not_calendar');
    expect(failureOf(await fetchLink(s.url('/no-location'), { own: OWN, test: s.origin }).catch((e) => e))).toBe('not_calendar');
    // Three redirects are followed; a fourth is one too many.
    expect(await fetchLink(s.url('/hop3'), { own: OWN, test: s.origin })).toMatchObject({ unchanged: false });
    expect(failureOf(await fetchLink(s.url('/hop4'), { own: OWN, test: s.origin }).catch((e) => e))).toBe('not_calendar');
    // Nothing was asked of anywhere but the stand-in.
    expect(s.seen.every((each) => each.method === 'GET')).toBe(true);
  } finally {
    await s.close();
  }
});

test('what comes back must be a calendar, of a size Koyomi reads, however it is sent', async () => {
  const ics = calendar(event('fine', '20261007T090000Z'));
  const s = await source((request, response) => {
    const path = request.url ?? '';
    if (path === '/plain') return response.writeHead(200, { 'content-type': 'text/calendar' }).end(ics);
    // A calendar sent as anything else is still a calendar.
    if (path === '/mislabelled') return response.writeHead(200, { 'content-type': 'text/html' }).end(`﻿${ics}`);
    if (path === '/html') return response.writeHead(200, { 'content-type': 'text/calendar' }).end('<!doctype html><html><body>Sign in</body></html>');
    if (path === '/json') return response.writeHead(200, { 'content-type': 'application/json' }).end('{"error":"InvalidToken"}');
    if (path === '/half') return response.writeHead(200).end('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
    if (path === '/declared') return response.writeHead(200, { 'content-length': String(MAX_FEED_BYTES + 1) }).end('x');
    if (path === '/streamed') {
      response.writeHead(200);
      const line = Buffer.alloc(64 * 1024, 'A');
      for (let sent = 0; sent <= MAX_FEED_BYTES; sent += line.length) response.write(line);
      return response.end();
    }
    if (path === '/bomb') return response.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync(Buffer.alloc(MAX_FEED_BYTES + 1024, 'A')));
    if (path === '/gzip') return response.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync(ics));
    if (path === '/broken-gzip') return response.writeHead(200, { 'content-encoding': 'gzip' }).end('not gzip at all');
    if (path === '/compress') return response.writeHead(200, { 'content-encoding': 'compress' }).end(ics);
    if (path === '/empty') return response.writeHead(204).end();
    response.writeHead(404).end();
  });
  try {
    const fetch = (path: string) => fetchLink(s.url(path), { own: OWN, test: s.origin });
    for (const path of ['/plain', '/mislabelled', '/gzip']) expect(await fetch(path), path).toMatchObject({ unchanged: false, text: expect.stringMatching(/^BEGIN:VCALENDAR/) });
    for (const path of ['/html', '/json', '/half', '/broken-gzip', '/compress', '/empty']) expect(failureOf(await fetch(path).catch((e) => e)), path).toBe('not_calendar');
    for (const path of ['/declared', '/streamed', '/bomb']) expect(failureOf(await fetch(path).catch((e) => e)), path).toBe('too_large');
  } finally {
    await s.close();
  }
});

test('each answer has its own word; a slow source is let go; and Koyomi sends nothing of the person', async () => {
  const s = await source((request, response) => {
    const path = request.url ?? '';
    const status = Number(path.slice(1));
    if (path === '/never') return; // Never answers.
    if (status === 429) return response.writeHead(429, { 'retry-after': '30' }).end();
    response.writeHead(status || 404).end();
  });
  try {
    const fetch = (path: string, deadline?: AbortSignal) => fetchLink(s.url(path), { own: OWN, test: s.origin, deadline });
    for (const status of [401, 403, 404, 410]) expect(failureOf(await fetch(`/${status}`).catch((e) => e)), String(status)).toBe('refused');
    for (const status of [500, 502, 503, 408]) expect(failureOf(await fetch(`/${status}`).catch((e) => e)), String(status)).toBe('busy');
    const pause = await fetch('/429').catch((e) => e);
    expect([failureOf(pause), pause.retryAfter]).toEqual(['slow_down', 30]);
    // An answer that does not come is given up on.
    const started = Date.now();
    expect(failureOf(await fetch('/never', AbortSignal.timeout(300)).catch((e) => e))).toBe('busy');
    expect(Date.now() - started).toBeLessThan(5000);
    // Plain GETs, with no cookie and no credential of anyone's.
    for (const each of s.seen) {
      expect(each.method).toBe('GET');
      expect(each.headers.cookie).toBeUndefined();
      expect(each.headers.authorization).toBeUndefined();
      expect(each.headers['if-none-match']).toBeUndefined();
    }
  } finally {
    await s.close();
  }
});

test('a link sent on to an error page no longer gives a calendar; a server failing is only a bad moment', async () => {
  const webPage = { 'content-type': 'text/html; charset=utf-8' };
  const s = await source((request, response) => {
    const path = request.url ?? '';
    // As Outlook answers a calendar no longer published: two redirects on its own host, then a web page.
    if (path === '/withdrawn') return response.writeHead(302, { location: '/withdrawn/on' }).end();
    if (path === '/withdrawn/on') return response.writeHead(302, { location: '/error/500' }).end();
    if (path.startsWith('/sent/')) return response.writeHead(302, { location: path.slice('/sent'.length) }).end();
    if (path.startsWith('/error/')) return response.writeHead(Number(path.slice('/error/'.length)), webPage).end('<html>Something went wrong</html>');
    if (path === '/plain/500') return response.writeHead(500, { 'content-type': 'text/plain' }).end('error');
    if (path === '/bare/500') return response.writeHead(500).end();
    response.writeHead(404).end();
  });
  try {
    const fetch = (path: string) => fetchLink(s.url(path), { own: OWN, test: s.origin });
    expect(failureOf(await fetch('/withdrawn').catch((e) => e))).toBe('not_calendar');
    expect(failureOf(await fetch('/sent/error/500').catch((e) => e))).toBe('not_calendar');
    // Asked directly, the same page is the server failing, not the link being gone.
    expect(failureOf(await fetch('/error/500').catch((e) => e))).toBe('busy');
    // A gateway says nothing of the link, nor does a failure that is not a page.
    for (const path of ['/sent/error/502', '/sent/error/503', '/sent/error/504', '/sent/plain/500', '/sent/bare/500']) expect(failureOf(await fetch(path).catch((e) => e)), path).toBe('busy');
  } finally {
    await s.close();
  }
});

test('a calendar link read through the provider: only what Koyomi shows, a cursor for next time, and never the link', async () => {
  const ics = calendar(event('standup', '20261007T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=3'), event('<img src=x onerror=alert(1)>', '20261008T120000Z'));
  let etag = '"v1"';
  const s = await source((request, response) => {
    if (request.url === '/private/Tok3n/calendar.ics') {
      if (request.headers['if-none-match'] === etag) return response.writeHead(304).end();
      return response.writeHead(200, { etag, 'last-modified': 'Wed, 07 Oct 2026 08:00:00 GMT' }).end(ics);
    }
    if (request.url === '/gone') return response.writeHead(404).end();
    if (request.url === '/down') return response.writeHead(503).end();
    if (request.url === '/wait') return response.writeHead(429, { 'retry-after': '120' }).end();
    if (request.url === '/html') return response.writeHead(200).end('<html>Sign in</html>');
    if (request.url === '/huge') return response.writeHead(200, { 'content-length': String(MAX_FEED_BYTES + 1) }).end('x');
    if (request.url === '/away') return response.writeHead(302, { location: 'https://169.254.169.254/' }).end();
    if (request.url === '/withdrawn') return response.writeHead(302, { location: '/failing' }).end();
    if (request.url === '/failing') return response.writeHead(500, { 'content-type': 'text/html' }).end('<html>Error</html>');
    response.writeHead(404).end();
  });
  const logged: string[] = [];
  const real = console.error;
  console.error = (line: string) => void logged.push(line);
  try {
    const provider = linkProvider({ own: OWN, test: s.origin, paceMs: 0 }, KEY);
    const secret = (path: string) => JSON.stringify({ url: `${s.origin}${path}`, name: 'Team rota' });
    const asked = { connectionId: '55555555-5555-4555-8555-555555555555', calendarId: LINK_CALENDAR, syncToken: null, span: { timeMin: '2026-09-01T00:00:00.000Z', timeMax: '2027-04-14T00:00:00.000Z' }, fetchedAt: '2026-10-07T09:00:00.000Z' };
    const deadline = AbortSignal.timeout(10_000);

    // Listing reads nothing from the link: its one calendar, by its name.
    const listed = await provider.listCalendars(secret('/private/Tok3n/calendar.ics'), deadline);
    expect(listed).toEqual({ account: 'Team rota', calendars: [{ calendarId: LINK_CALENDAR, name: 'Team rota', primary: true, selected: true }] });
    expect(s.seen).toHaveLength(0);

    const first = await provider.readCalendar(secret('/private/Tok3n/calendar.ics'), asked, deadline);
    if (!('events' in first)) throw new Error('not read');
    expect(first.full).toBe(true);
    expect(first.events.map((e) => [e.providerEventId, e.start, e.provider, e.link])).toEqual([
      ['standup::20261007T090000Z', '2026-10-07T09:00:00.000Z', 'link', null],
      ['standup::20261014T090000Z', '2026-10-14T09:00:00.000Z', 'link', null],
      ['standup::20261021T090000Z', '2026-10-21T09:00:00.000Z', 'link', null],
      ['<img src=x onerror=alert(1)>', '2026-10-08T12:00:00.000Z', 'link', null],
    ]);
    // Nothing the feed carried that Koyomi does not show, and nothing of the link.
    const said = JSON.stringify(first);
    expect(said).not.toMatch(/PRIVATE|private\.test|Boss|teams/i);
    expect(said).not.toContain('Tok3n');
    expect(said).not.toContain(s.origin);
    expect(first.syncToken).toMatch(/^v1\./);

    // Read again with its cursor: asked whether it has changed, and it has not.
    const again = await provider.readCalendar(secret('/private/Tok3n/calendar.ics'), { ...asked, syncToken: first.syncToken }, deadline);
    expect(again).toEqual({ calendarId: LINK_CALENDAR, full: false, events: [], removed: [], syncToken: first.syncToken });
    expect(s.seen.at(-1)?.headers['if-none-match']).toBe('"v1"');
    expect(s.seen.at(-1)?.headers['if-modified-since']).toBe('Wed, 07 Oct 2026 08:00:00 GMT');
    // It changes: everything again.
    etag = '"v2"';
    expect(await provider.readCalendar(secret('/private/Tok3n/calendar.ics'), { ...asked, syncToken: first.syncToken }, deadline)).toMatchObject({ full: true });
    // A cursor from another link is not taken for this one's: nothing is asked conditionally.
    const before = s.seen.length;
    await provider.readCalendar(secret('/private/Tok3n/calendar.ics?other'), { ...asked, syncToken: first.syncToken }, deadline).catch(() => {});
    expect(s.seen[before].headers['if-none-match']).toBeUndefined();

    // Each failure as the rest of the server takes it.
    const kind = (path: string) => provider.readCalendar(secret(path), asked, deadline).then((r) => ('failed' in r ? 'failed' : 'read'), kindOf);
    expect(await kind('/gone')).toBe('reconnect');
    expect(await kind('/html')).toBe('reconnect');
    expect(await kind('/away')).toBe('reconnect');
    expect(await kind('/withdrawn')).toBe('reconnect');
    expect(await kind('/failing')).toBe('busy');
    expect(await kind('/down')).toBe('busy');
    expect(await kind('/wait')).toBe('slow_down');
    expect(await kind('/huge')).toBe('failed');
    expect(await provider.readCalendar(secret('/private/Tok3n/calendar.ics'), { ...asked, calendarId: 'something-else' }, deadline)).toEqual({ calendarId: 'something-else', gone: true });
    // A link stored as something Koyomi does not follow is not fetched at all.
    expect(await provider.readCalendar(JSON.stringify({ url: 'https://127.0.0.1/a.ics', name: 'x' }), asked, deadline).catch(kindOf)).toBe('reconnect');
    expect(await provider.readCalendar('not a secret', asked, deadline).catch(kindOf)).toBe('reconnect');

    // What was logged says what happened, never where.
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain(s.origin);
      expect(line).not.toMatch(/Tok3n|169\.254|127\.0\.0\.1/);
    }
  } finally {
    console.error = real;
    await s.close();
  }
});

test('one link is not fetched again by the same server a moment later', async () => {
  const s = await source((_request, response) => response.writeHead(200).end(calendar(event('fine', '20261007T090000Z'))));
  try {
    const provider = linkProvider({ own: OWN, test: s.origin, paceMs: 60_000 }, KEY);
    const access = JSON.stringify({ url: `${s.origin}/paced.ics`, name: 'x' });
    const asked = { connectionId: '66666666-6666-4666-8666-666666666666', calendarId: LINK_CALENDAR, syncToken: null, span: { timeMin: '2026-09-01T00:00:00.000Z', timeMax: '2027-04-14T00:00:00.000Z' }, fetchedAt: '2026-10-07T09:00:00.000Z' };
    expect(await provider.readCalendar(access, asked, AbortSignal.timeout(5000))).toMatchObject({ full: true });
    const error = await provider.readCalendar(access, asked, AbortSignal.timeout(5000)).catch((e) => e);
    expect(kindOf(error)).toBe('slow_down');
    expect(error.retryAfter).toBeGreaterThan(50);
    expect(s.seen).toHaveLength(1);
    // Given a new link, it has not been fetched at all: the new one is read at once.
    forgetPace(asked.connectionId);
    expect(await provider.readCalendar(access, asked, AbortSignal.timeout(5000))).toMatchObject({ full: true });
    expect(s.seen).toHaveLength(2);
  } finally {
    await s.close();
  }
});

test('a calendar names itself, as plain text; a name given is one line, not too long', () => {
  expect(feedName(calendar())).toBe('Team rota');
  expect(feedName(['BEGIN:VCALENDAR', 'VERSION:2.0', 'END:VCALENDAR'].join('\r\n'))).toBeNull();
  expect(() => feedName('not a calendar')).toThrow();
  expect(nameOf('  Work\u0000\ncalendar  ')).toBe('Work calendar');
  expect(nameOf('x'.repeat(200))).toHaveLength(80);
  expect(nameOf('   ')).toBeNull();
  expect(nameOf(42)).toBeNull();
});
