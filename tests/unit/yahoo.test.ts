import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DavError, MAX_BYTES, READ_METHODS, dav, parseXml } from '../../lib/server/caldav';
import { accountKey, sealContext } from '../../lib/server/connections';
import { calendarProviders, connectionsConfig } from '../../lib/server/env';
import { describe } from '../../lib/server/log';
import { open, seal } from '../../lib/server/seal';
import { LOOK_BACK_DAYS, YAHOO_ORIGIN, YahooError, appPasswordOf, credentialOf, discover, isYahooEmail, listCalendars, readCalendar, yahooClient, type YahooCredential } from '../../lib/server/yahoo';

// The server's side of a Yahoo connection: CalDAV to Yahoo's one server and nowhere else, read
// only, with the email and app password sealed and never shown. Nothing here reaches Yahoo:
// every answer comes from a stand-in in this file that answers as Yahoo's server does.

const KEY = 'a'.repeat(64);
const Y = yahooClient();
const EMAIL = 'pat@yahoo.com';
const PASSWORD = 'abcdwxyzefghijkl';
const HOME = '/dav/a1b2c3/Calendar/';
const CRED: YahooCredential = { email: EMAIL, password: PASSWORD, principal: `/principals/users/${EMAIL}/`, home: HOME };
const SPAN = { timeMin: '2026-09-01T00:00:00.000Z', timeMax: '2027-04-14T00:00:00.000Z' };
const ASKED = { connectionId: '33333333-3333-4333-8333-333333333333', calendarId: `${HOME}Personal/`, span: SPAN, fetchedAt: '2026-10-07T09:00:00.000Z' };

const multistatus = (...responses: string[]) => `<?xml version="1.0"?><X:multistatus xmlns:X="DAV:" xmlns:K="urn:ietf:params:xml:ns:caldav">${responses.join('')}</X:multistatus>`;
const found = (href: string, props: string) => `<X:response><X:href>${href}</X:href><X:propstat><X:prop>${props}</X:prop><X:status>HTTP/1.1 200 OK</X:status></X:propstat></X:response>`;
const xml = (doc: string, status = 207) => new Response(doc, { status, headers: { 'content-type': 'application/xml' } });
const refused = () => new Response('{"error":{"code": 4003, "message":"Invalid User credential"}}', { status: 401, headers: { 'content-type': 'application/json' } });
const event = (uid: string, start: string, ...more: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${uid}`, `DTSTART:${start}`, ...more, 'DESCRIPTION:PRIVATE', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n').replace(/&/g, '&amp;').replace(/</g, '&lt;');

interface Asked {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
}

/** Yahoo's server, as far as these tests need it, and every request that reached it. */
async function withYahoo<T>(answer: (asked: Asked) => Response | Promise<Response>, run: (asked: Asked[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const asked: Asked[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request: Asked = { method: String(init.method ?? 'GET'), url: new URL(String(input)), headers: init.headers as Record<string, string>, body: String(init.body ?? '') };
    asked.push(request);
    return answer(request);
  }) as typeof fetch;
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = real;
  }
}

/** A Yahoo that knows one account and one calendar of events. */
const yahoo =
  (objects: string[] = [], extra: (asked: Asked) => Response | null = () => null) =>
  (asked: Asked): Response => {
    const special = extra(asked);
    if (special) return special;
    if (asked.headers.authorization !== `Basic ${Buffer.from(`${EMAIL}:${PASSWORD}`).toString('base64')}`) return refused();
    const path = asked.url.pathname;
    if (path === '/.well-known/caldav') return new Response(null, { status: 301, headers: { location: 'https://caldav.calendar.yahoo.com/principals/' } });
    if (path === '/principals/') return xml(multistatus(found('/principals/', `<X:current-user-principal><X:href>/principals/users/${EMAIL}/</X:href></X:current-user-principal>`)));
    if (path === `/principals/users/${EMAIL}/`) return xml(multistatus(found(path, `<K:calendar-home-set><X:href>${HOME}</X:href></K:calendar-home-set>`)));
    if (path === HOME)
      return xml(
        multistatus(
          found(HOME, '<X:resourcetype><X:collection/></X:resourcetype>'),
          found(`${HOME}Personal/`, '<X:resourcetype><X:collection/><K:calendar/></X:resourcetype><X:displayname>Personal</X:displayname><K:supported-calendar-component-set><K:comp name="VEVENT"/></K:supported-calendar-component-set><X:current-user-privilege-set><X:privilege><X:write/></X:privilege></X:current-user-privilege-set>'),
          found(`${HOME}Birthdays/`, '<X:resourcetype><X:collection/><K:calendar/></X:resourcetype><X:displayname>Birthdays</X:displayname><X:current-user-privilege-set><X:privilege><X:read/></X:privilege></X:current-user-privilege-set>'),
          found(`${HOME}Tasks/`, '<X:resourcetype><X:collection/><K:calendar/></X:resourcetype><X:displayname>Tasks</X:displayname><K:supported-calendar-component-set><K:comp name="VTODO"/></K:supported-calendar-component-set>'),
          found(`${HOME}Family%20Things/`, '<X:resourcetype><X:collection/><K:calendar/></X:resourcetype>'),
          // Neither in the account's home, nor on Yahoo: never a calendar of this account's.
          found('/dav/someone-else/Calendar/Theirs/', '<X:resourcetype><X:collection/><K:calendar/></X:resourcetype><X:displayname>Theirs</X:displayname>'),
          found('https://evil.example/dav/a1b2c3/Calendar/Evil/', '<X:resourcetype><X:collection/><K:calendar/></X:resourcetype><X:displayname>Evil</X:displayname>'),
        ),
      );
    if (path === `${HOME}Personal/` && asked.method === 'REPORT') return xml(multistatus(...objects.map((ics, i) => found(`${HOME}Personal/${i}.ics`, `<X:getetag>"${i}"</X:getetag><K:calendar-data>${ics}</K:calendar-data>`))));
    return new Response(null, { status: 404 });
  };

const kind = (error: unknown) => (error instanceof YahooError ? error.kind : String(error));

test('the account is found the way Yahoo documents it: its well-known address, its principal, its calendar home', async () => {
  await withYahoo(yahoo(), async (asked) => {
    expect(await discover(Y, { email: EMAIL, password: PASSWORD })).toEqual({ principal: `/principals/users/${EMAIL}/`, home: HOME });
    expect(asked.map((r) => `${r.method} ${r.url.href} depth ${r.headers.depth}`)).toEqual([
      'PROPFIND https://caldav.calendar.yahoo.com/.well-known/caldav depth 0',
      'PROPFIND https://caldav.calendar.yahoo.com/principals/ depth 0',
      `PROPFIND https://caldav.calendar.yahoo.com/principals/users/${EMAIL}/ depth 0`,
    ]);
    for (const request of asked) {
      // The credential only ever in the Authorization header: never in an address or a body.
      expect(request.headers.authorization).toMatch(/^Basic /);
      expect(request.url.href + request.body).not.toContain(PASSWORD);
      expect(request.url.username + request.url.password).toBe('');
    }
    expect(asked[0].body).toContain('current-user-principal');
    expect(asked[2].body).toContain('calendar-home-set');
  });
  expect(YAHOO_ORIGIN).toBe('https://caldav.calendar.yahoo.com');
});

test('a wrong app password is refused at once, and nothing else is asked', async () => {
  await withYahoo(yahoo(), async (asked) => {
    expect(kind(await discover(Y, { email: EMAIL, password: 'wrongwrongwrong1' }).catch((e) => e))).toBe('reconnect');
    expect(asked).toHaveLength(1);
  });
});

test('Yahoo sending Koyomi to any other address is not followed, and neither is an address in an answer', async () => {
  for (const location of ['http://evil.example/principals/', 'https://caldav.calendar.yahoo.com.evil.example/principals/', 'http://caldav.calendar.yahoo.com/principals/', 'https://caldav.calendar.yahoo.com:8443/principals/', '//evil.example/principals/', 'https://user:pass@caldav.calendar.yahoo.com/principals/']) {
    const logged: string[] = [];
    const real = console.error;
    console.error = (line: string) => void logged.push(line);
    try {
      await withYahoo(
        yahoo([], (r) => (r.url.pathname === '/.well-known/caldav' ? new Response(null, { status: 301, headers: { location } }) : null)),
        async (asked) => {
          expect(kind(await discover(Y, { email: EMAIL, password: PASSWORD }).catch((e) => e)), location).toBe('busy');
          expect(asked.map((r) => r.url.origin)).toEqual(['https://caldav.calendar.yahoo.com']);
        },
      );
      expect(logged.join('\n')).not.toContain(PASSWORD);
      expect(logged).toEqual(['[calendars] yahoo: Error: Yahoo sent Koyomi to an address outside its own server; it was not followed']);
    } finally {
      console.error = real;
    }
  }
  // A principal named on another server is no principal.
  await withYahoo(
    yahoo([], (r) => (r.url.pathname === '/principals/' ? xml(multistatus(found('/principals/', '<X:current-user-principal><X:href>https://evil.example/principals/users/x/</X:href></X:current-user-principal>'))) : null)),
    async (asked) => {
      expect(kind(await discover(Y, { email: EMAIL, password: PASSWORD }).catch((e) => e))).toBe('blocked');
      expect(asked.every((r) => r.url.origin === YAHOO_ORIGIN)).toBe(true);
    },
  );
  // Within Yahoo's own server, a redirect is followed, a few times at most.
  await withYahoo(
    yahoo([], (r) => (r.url.pathname.startsWith('/loop') || r.url.pathname === '/.well-known/caldav' ? new Response(null, { status: 301, headers: { location: `/loop${r.url.pathname.length}` } }) : null)),
    async (asked) => {
      expect(kind(await discover(Y, { email: EMAIL, password: PASSWORD }).catch((e) => e))).toBe('busy');
      expect(asked.length).toBeLessThanOrEqual(4);
    },
  );
});

test('the calendars are the account’s own collections of events, in its own home; ones it cannot change start hidden', async () => {
  await withYahoo(yahoo(), async (asked) => {
    expect(await listCalendars(Y, CRED)).toEqual({
      account: EMAIL,
      calendars: [
        { calendarId: `${HOME}Birthdays/`, name: 'Birthdays', primary: false, selected: false },
        { calendarId: `${HOME}Family%20Things/`, name: 'Family Things', primary: false, selected: true },
        { calendarId: `${HOME}Personal/`, name: 'Personal', primary: false, selected: true },
      ],
    });
    expect(asked.map((r) => `${r.method} ${r.url.pathname} ${r.headers.depth}`)).toEqual([`PROPFIND ${HOME} 1`]);
    // Names, kinds and whether it may be changed: no colours, no descriptions.
    expect(asked[0].body).not.toMatch(/color|description|getctag/i);
  });
});

test('events are asked for within the span, and repeating ones from five years before it, by the fields Koyomi shows', async () => {
  const objects = [event('single', '20261007T120000Z', 'DTEND:20261007T130000Z'), event('weekly', '20240101T090000Z', 'DTEND:20240101T093000Z', 'RRULE:FREQ=WEEKLY')];
  await withYahoo(yahoo(objects), async (asked) => {
    const result = await readCalendar(Y, CRED, ASKED);
    expect(asked.map((r) => `${r.method} ${r.url.pathname} ${r.headers.depth}`)).toEqual([`REPORT ${HOME}Personal/ 1`, `REPORT ${HOME}Personal/ 1`]);
    const [inSpan, before] = asked.map((r) => r.body);
    expect(inSpan).toContain('<c:time-range start="20260901T000000Z" end="20270414T000000Z"/>');
    expect(inSpan).not.toContain('prop-filter');
    const earlier = new Date(Date.parse(SPAN.timeMin) - LOOK_BACK_DAYS * 864e5).toISOString().replace(/[-:]|\.\d{3}/g, '');
    expect(before).toContain(`<c:time-range start="${earlier}" end="20260901T000000Z"/><c:prop-filter name="RRULE"/>`);
    for (const body of [inSpan, before]) {
      expect(body).toContain('<c:comp-filter name="VEVENT">');
      // By name: the parts of an event Koyomi reads, and not its description, place or people.
      expect(body).toContain('<c:prop name="SUMMARY"/>');
      expect(body).not.toMatch(/DESCRIPTION|LOCATION|ATTENDEE|ORGANIZER|VALARM|ATTACH/);
    }
    expect(result).toMatchObject({ calendarId: ASKED.calendarId, full: true, removed: [], syncToken: null });
    if (!('events' in result)) throw new Error('no events');
    // The single event once, though both answers held it; the weekly one at each week of the span.
    expect(result.events.filter((e) => e.providerEventId === 'single')).toHaveLength(1);
    expect(result.events.filter((e) => e.providerEventId.startsWith('weekly::')).length).toBeGreaterThan(25);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  // A server that will not filter on RRULE: the same look back without it, and what does not repeat is dropped.
  await withYahoo(
    yahoo(objects, (r) => (r.body.includes('prop-filter') ? new Response(null, { status: 400 }) : null)),
    async (asked) => {
      const result = await readCalendar(Y, CRED, ASKED);
      expect(asked).toHaveLength(3);
      expect(asked[2].body).not.toContain('prop-filter');
      if (!('events' in result)) throw new Error('no events');
      expect(result.events.filter((e) => e.providerEventId === 'single')).toHaveLength(1);
    },
  );
});

test('a calendar a browser names outside the account’s home is never asked about', async () => {
  for (const calendarId of [
    '/dav/someone-else/Calendar/Theirs/',
    `${HOME}../../someone-else/Calendar/`,
    `${HOME}Personal/../../x/`,
    'https://evil.example/x/',
    `${HOME}`,
    `${HOME}Personal/?x=1`,
    '//evil.example/dav/',
    `${HOME}%2e%2e/`,
    // Steps up written so that only a server that decodes them would take them as steps.
    `${HOME}..%2f..%2fsomeone-else/`,
    `${HOME}%2e%2e%2f..%2fx/`,
    `${HOME}x%2f..%2f..%2fy/`,
    `${HOME}..;/x/`,
    `${HOME}Personal%5c..%5c..%5cx/`,
    `${HOME}%252e%252e%252f/`,
    `${HOME}Personal%00/`,
    `${HOME}%E0%A4%A/`,
    `${HOME}Personal//`,
  ]) {
    await withYahoo(yahoo(), async (asked) => {
      expect(await readCalendar(Y, CRED, { ...ASKED, calendarId }), calendarId).toEqual({ calendarId, gone: true });
      expect(asked, calendarId).toEqual([]);
    });
  }
});

test('a look back that cannot be had leaves the span as it was read', async () => {
  const objects = [event('single', '20261007T120000Z', 'DTEND:20261007T130000Z'), event('weekly', '20261005T090000Z', 'DTEND:20261005T093000Z', 'RRULE:FREQ=WEEKLY')];
  const lookingBack = (r: Asked) => r.method === 'REPORT' && !r.body.includes('start="20260901T000000Z"');
  for (const [said, answer] of [
    ['too much', () => new Response('x', { status: 207, headers: { 'content-length': String(MAX_BYTES + 1) } })],
    ['not allowed', () => new Response(null, { status: 403 })],
    ['not XML', () => xml('<X:multistatus xmlns:X="DAV:"><X:response>')],
    // No filtering on RRULE, and then far too much without it.
    ['too much without the filter', (r: Asked) => (r.body.includes('prop-filter') ? new Response(null, { status: 400 }) : new Response('x', { status: 207, headers: { 'content-length': String(MAX_BYTES + 1) } }))],
  ] as const) {
    const logged: string[] = [];
    const real = console.error;
    console.error = (line: string) => void logged.push(line);
    try {
      await withYahoo(
        yahoo(objects, (r) => (lookingBack(r) ? answer(r) : null)),
        async () => {
          const result = await readCalendar(Y, CRED, ASKED);
          expect('events' in result, said).toBe(true);
          if (!('events' in result)) return;
          expect(result.events.filter((e) => e.providerEventId === 'single'), said).toHaveLength(1);
          expect(result.events.filter((e) => e.providerEventId.startsWith('weekly::')).length, said).toBeGreaterThan(25);
        },
      );
      expect(logged, said).toEqual(['[calendars] yahoo: Error: A Yahoo calendar could not be looked back on for its repeating events; its span was read without them']);
    } finally {
      console.error = real;
    }
  }
  // A moment's trouble is the calendar's, as it was: it keeps what it had and is read again.
  await withYahoo(
    yahoo(objects, (r) => (lookingBack(r) ? new Response(null, { status: 503 }) : null)),
    async () => expect(kind(await readCalendar(Y, CRED, ASKED).catch((e) => e))).toBe('busy'),
  );
});

test('each of Yahoo’s refusals has its own word, and a calendar’s own trouble is that calendar’s', async () => {
  const reading = (answer: (r: Asked) => Response | null) => withYahoo(yahoo([event('a', '20261007T120000Z')], answer), async (asked) => [await readCalendar(Y, CRED, ASKED).then((r) => ('gone' in r ? 'gone' : 'failed' in r ? 'failed' : 'read'), kind), asked.length] as const);
  // A refused password is asked once more before it is taken as refused.
  expect(await reading(() => refused())).toEqual(['reconnect', 2]);
  let first = true;
  expect(await reading(() => (first ? ((first = false), refused()) : null))).toEqual(['read', 3]);
  expect(await reading(() => new Response(null, { status: 429, headers: { 'retry-after': '30' } }))).toEqual(['slow_down', 1]);
  expect(await reading(() => new Response(null, { status: 503 }))).toEqual(['busy', 1]);
  expect(await reading(() => Promise.reject(new TypeError('fetch failed')) as never)).toEqual(['busy', 1]);
  expect(await reading(() => new Response(null, { status: 404 }))).toEqual(['gone', 1]);
  expect(await reading(() => new Response(null, { status: 403 }))).toEqual(['failed', 1]);
  // An answer that cannot be trusted: that calendar keeps what it had.
  expect(await reading(() => xml('<X:multistatus xmlns:X="DAV:"><X:response>'))).toEqual(['failed', 1]);
  expect(await reading(() => xml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><X:multistatus xmlns:X="DAV:"/>'))).toEqual(['failed', 1]);
  expect(await reading(() => xml('<not-a-multistatus/>'))).toEqual(['failed', 1]);
  expect(await reading(() => new Response('x', { status: 207, headers: { 'content-length': String(MAX_BYTES + 1) } }))).toEqual(['failed', 1]);
  // One object that is not iCalendar is left out, and the calendar's others are read.
  await withYahoo(yahoo(['nonsense', event('fine', '20261007T120000Z')]), async () => {
    const result = await readCalendar(Y, CRED, ASKED);
    expect('events' in result && result.events.map((e) => e.providerEventId)).toEqual(['fine']);
  });
});

test('nothing but PROPFIND and REPORT can be sent, however it is called', async () => {
  const methods = new Set<string>();
  await withYahoo(
    (asked) => {
      methods.add(asked.method);
      return yahoo([event('a', '20261007T120000Z', 'RRULE:FREQ=DAILY;COUNT=3')])(asked);
    },
    async () => {
      await discover(Y, { email: EMAIL, password: PASSWORD });
      await discover(Y, { email: EMAIL, password: 'wrongwrongwrong1' }).catch(() => {});
      await listCalendars(Y, CRED);
      await readCalendar(Y, CRED, ASKED);
      await readCalendar(Y, CRED, { ...ASKED, calendarId: `${HOME}Missing/` });
    },
  );
  expect([...methods].sort()).toEqual(['PROPFIND', 'REPORT']);
  expect([...READ_METHODS]).toEqual(['PROPFIND', 'REPORT']);
  // Called with anything else, it refuses before anything is sent.
  await withYahoo(yahoo(), async (asked) => {
    for (const method of ['PUT', 'POST', 'DELETE', 'MKCALENDAR', 'MKCOL', 'MOVE', 'COPY', 'PROPPATCH', 'PATCH', 'LOCK', 'ACL', 'GET', 'put']) {
      await expect(dav({ origin: YAHOO_ORIGIN, authorization: 'Basic x', method: method as never, path: '/', depth: '0', body: '' }), method).rejects.toThrow(TypeError);
    }
    expect(asked).toEqual([]);
  });
  // And the code that talks to Yahoo names no method that writes.
  for (const file of ['lib/server/caldav.ts', 'lib/server/yahoo.ts']) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code, file).not.toMatch(/['"`](PUT|POST|DELETE|PATCH|MKCALENDAR|MKCOL|MOVE|COPY|PROPPATCH|LOCK|UNLOCK|ACL)['"`]/);
  }
});

test('XML is read by namespace, and anything that is not plain XML is refused', () => {
  expect(() => parseXml('<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY lol "lol">]><a>&lol;</a>')).toThrow(DavError);
  expect(() => parseXml('<a><b></a>')).toThrow(DavError);
  expect(parseXml('<z:multistatus xmlns:z="DAV:"/>').documentElement!.localName).toBe('multistatus');
});

test('the email and app password are sealed together, for their own row, and only accepted as Yahoo makes them', () => {
  const row = { subject: 'user-1', provider: 'yahoo' as const, accountKey: accountKey(KEY, 'user-1', 'yahoo', CRED.principal) };
  const sealed = seal(JSON.stringify(CRED), KEY, sealContext(row));
  expect(sealed).not.toContain(PASSWORD);
  expect(sealed).not.toContain(EMAIL);
  expect(credentialOf(open(sealed, KEY, sealContext(row)))).toEqual(CRED);
  // On another row, or another person's, it does not open.
  expect(() => open(sealed, KEY, sealContext({ ...row, subject: 'user-2' }))).toThrow();
  expect(() => open(sealed, KEY, sealContext({ ...row, accountKey: accountKey(KEY, 'user-1', 'yahoo', '/principals/users/other@yahoo.com/') }))).toThrow();
  // A secret that is not one is a connection to make again.
  for (const bad of ['', 'x', '{}', '{"email":"a"}']) expect(kind((() => { try { credentialOf(bad); } catch (e) { return e; } })())).toBe('reconnect');
  // The account is known by its principal, in any case; never by the password.
  expect(accountKey(KEY, 'user-1', 'yahoo', '/principals/users/Pat@Yahoo.com/')).toBe(accountKey(KEY, 'user-1', 'yahoo', '/principals/users/pat@yahoo.com/'));
  expect(row.accountKey).not.toContain(EMAIL);
  expect(isYahooEmail(EMAIL)).toBe(true);
  for (const bad of ['', 'pat', 'pat@yahoo', 'pat:x@yahoo.com', 'pat@yahoo.com/../x', 'two words@yahoo.com', 'a'.repeat(250) + '@x.com', 7]) expect(isYahooEmail(bad), String(bad)).toBe(false);
  expect(appPasswordOf('abcd efgh ijkl mnop')).toBe('abcdefghijklmnop');
  for (const bad of ['', 'short', 'x'.repeat(65), 'tab\u0000here', 'nön-ascii-password', 12345678]) expect(appPasswordOf(bad), String(bad)).toBeNull();
  // Nothing about a refusal carries the password.
  expect(describe(new YahooError('reconnect'))).toBe('Error: Yahoo: reconnect');
});

test('Yahoo is offered by one setting, beside the others or on its own, and its stand-in only off Vercel', () => {
  const base: Record<string, string> = {
    NEXT_PUBLIC_APP_URL: 'https://app.koyomi.guru',
    NEXT_PUBLIC_AUTH_URL: 'https://auth.6away.ai',
    AUTH_CLIENT_ID: 'koyomi',
    AUTH_CLIENT_SECRET: 's',
    SESSION_SECRET: 's',
    TOKEN_ENCRYPTION_KEY: KEY,
    DATABASE_URL: 'postgres://example',
  };
  const names = [...Object.keys(base), 'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'MICROSOFT_CALENDAR_CLIENT_ID', 'MICROSOFT_CALENDAR_CLIENT_SECRET', 'YAHOO_CALENDAR', 'VERCEL', 'KOYOMI_TEST_YAHOO_URL'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const withEnv = (env: Record<string, string>) => {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, env);
    return { config: connectionsConfig(), providers: calendarProviders() };
  };
  try {
    expect(withEnv(base).providers).toEqual([]);
    expect(withEnv({ ...base, YAHOO_CALENDAR: 'yes' }).providers).toEqual([]);
    const alone = withEnv({ ...base, YAHOO_CALENDAR: 'on' });
    expect(alone.providers).toEqual(['yahoo']);
    expect(alone.config!.yahoo).toEqual({ origin: 'https://caldav.calendar.yahoo.com' });
    expect(withEnv({ ...base, YAHOO_CALENDAR: 'on', GOOGLE_CALENDAR_CLIENT_ID: 'g', GOOGLE_CALENDAR_CLIENT_SECRET: 'gs', MICROSOFT_CALENDAR_CLIENT_ID: 'm', MICROSOFT_CALENDAR_CLIENT_SECRET: 'ms' }).providers).toEqual(['google', 'microsoft', 'yahoo']);
    expect(withEnv({ ...base, YAHOO_CALENDAR: 'on', KOYOMI_TEST_YAHOO_URL: 'http://localhost:9' }).config!.yahoo).toEqual({ origin: 'http://localhost:9' });
    expect(withEnv({ ...base, YAHOO_CALENDAR: 'on', KOYOMI_TEST_YAHOO_URL: 'http://localhost:9', VERCEL: '1' }).config!.yahoo).toEqual({ origin: 'https://caldav.calendar.yahoo.com' });
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});
