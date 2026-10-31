import { lookup as systemLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';

// The one way Koyomi's server fetches an address a person gave it: a calendar link. Anyone can
// type any address into that form, so this is where the server is kept from being sent anywhere
// it should not go (its own network, the cloud's metadata service, anything private).
//
// - Only https, on the usual port, with no user name or password in the address.
// - A name is looked up here, by Koyomi, and every address it has is checked against the ranges
//   below. The connection is then made to an address checked here and to no other: the lookup is
//   the connection's own, so nothing can answer one way when asked and another way when used.
// - An address written as numbers is checked the same way.
// - A redirect is followed by hand, a few times at most, and each new address is checked again
//   from the start.
// - What comes back is limited in time and size, unpacked within the same size, and must be a
//   calendar, whatever it says it is.
//
// The link is never logged and never part of an error: an error says only what kind it was.

/** The longest link Koyomi takes. Published calendar links are a few hundred characters. */
export const MAX_LINK_LENGTH = 2048;
/**
 * The largest calendar Koyomi reads, unpacked. A busy calendar published with years of history
 * is a few megabytes; this is several times that, and still a small part of what a server can hold.
 */
export const MAX_FEED_BYTES = 10 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
const CONNECT_TIMEOUT_MS = 5_000;
const RESPONSE_TIMEOUT_MS = 10_000;
/** However the time is spent, one fetch gives up after this long. */
export const FETCH_TIMEOUT_MS = 20_000;

/**
 * Why a link gave no calendar. Never the link, the address, or anything the source said.
 * - `bad_link`: not a link Koyomi follows (scheme, port, password, length, a private name).
 * - `forbidden`: it leads, by its address or a redirect, somewhere Koyomi never fetches.
 * - `refused`: the source no longer gives it (401, 403, 404, 410).
 * - `not_calendar`: an answer, but not a calendar (a sign-in page, an error, a redirect to an error page, too many redirects).
 * - `too_large`: more than MAX_FEED_BYTES.
 * - `slow_down`: the source asked for a pause (429).
 * - `busy`: unreachable, slow or failing just now.
 */
export type LinkFailure = 'bad_link' | 'forbidden' | 'refused' | 'not_calendar' | 'too_large' | 'slow_down' | 'busy';

export class LinkError extends Error {
  constructor(
    public readonly failure: LinkFailure,
    public readonly retryAfter?: number,
  ) {
    super(`calendar link: ${failure}`);
  }
}

// Everywhere a fetch from Koyomi's server must never go: this machine, private networks, the
// shared space of carriers, link-local (where the cloud's metadata service answers, 169.254.169.254),
// addresses set aside for documentation, tests and benchmarks, multicast and everything reserved;
// and in IPv6 the same, with every form that carries an IPv4 address inside it (mapped,
// compatible, NAT64, 6to4, Teredo), refused whole. Each family has a list of its own: one list
// would check every IPv4 address against the IPv6 ranges too, as a mapped address, and the
// mapped range would then refuse them all.
const PRIVATE4 = new BlockList();
const PRIVATE6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  PRIVATE4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 96],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  PRIVATE6.addSubnet(network, prefix, 'ipv6');

/** Whether an address is one Koyomi never fetches from. Anything that is not an address at all is refused too. */
export function forbidden(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const family = isIP(bare);
  if (!family) return true;
  return family === 4 ? PRIVATE4.check(bare, 'ipv4') : PRIVATE6.check(bare, 'ipv6');
}

/** Names that never lead to the public internet, whatever they resolve to. */
const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|arpa|test|example|invalid)$/i;

const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '');

/**
 * Whether Koyomi follows this address at all, before anything is asked: https only, the usual
 * port, no user name or password, not too long, and not to a name or an address that is private.
 *
 * @param own Koyomi's own host, which it never asks itself.
 */
export function followable(url: URL, own?: string): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  if (url.href.length > MAX_LINK_LENGTH) return false;
  const host = hostOf(url).replace(/\.$/, '').toLowerCase();
  if (!host || (own && host === own.toLowerCase())) return false;
  if (isIP(host)) return !forbidden(host);
  // A name with no dot in it is a name on someone's own network.
  return host.includes('.') && !LOCAL_NAME.test(host);
}

/**
 * The link as Koyomi will fetch it, or null if it will not. A `webcal://` link is the same
 * address over https: it is written as one, and never asked for as anything else.
 *
 * @param test The browser tests' stand-in, the one address taken as it is (never on a deployment).
 */
export function linkOf(input: unknown, own?: string, test?: string | null): URL | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > MAX_LINK_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw.replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return null;
  }
  url.hash = '';
  if (test && url.origin === test) return url;
  return followable(url, own) ? url : null;
}

/**
 * The same link, written the same way however it was pasted: the host in lower case, the usual
 * port left out. The path and the query are the calendar's private token, and are kept exactly.
 */
export const canonicalLink = (url: URL) => `${url.protocol}//${url.host.toLowerCase()}${url.pathname}${url.search}`;

/** Looks a name up. Every address it has, so that every one can be checked. */
export type Resolve = (hostname: string) => Promise<{ address: string; family: number }[]>;
export const resolveName: Resolve = (hostname) =>
  new Promise((resolve, reject) => systemLookup(hostname, { all: true, verbatim: true }, (error, found) => (error ? reject(error) : resolve(found))));

/**
 * The lookup the connection itself uses. The addresses it hands over are the only ones the
 * connection can go to, and each has been checked here: if any address of the name is private,
 * none is used.
 */
function checkedLookup(resolve: Resolve, said: { forbidden: boolean }): LookupFunction {
  return (hostname, options, callback) => {
    const fail = (error: NodeJS.ErrnoException) => callback(error, '', 0);
    resolve(hostname).then(
      (found) => {
        if (!found.length) return fail(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }));
        if (found.some((each) => forbidden(each.address))) {
          said.forbidden = true;
          return fail(Object.assign(new Error('not an address Koyomi fetches from'), { code: 'EFORBIDDEN' }));
        }
        if (options?.all) return callback(null, found);
        callback(null, found[0].address, found[0].family);
      },
      (error: NodeJS.ErrnoException) => fail(error),
    );
  };
}

/** One request, with a time for connecting and a time for the answer to begin. */
function ask(url: URL, headers: Record<string, string>, lookup: LookupFunction | undefined, signal: AbortSignal) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const secure = url.protocol === 'https:';
    const request = (secure ? https : http).request(url, { method: 'GET', headers, agent: false, signal, ...(lookup ? { lookup } : {}) });
    const late = (what: number) => setTimeout(() => request.destroy(new LinkError('busy')), what);
    const connecting = late(CONNECT_TIMEOUT_MS);
    const answering = late(RESPONSE_TIMEOUT_MS);
    request.on('socket', (socket) => socket.once(secure ? 'secureConnect' : 'connect', () => clearTimeout(connecting)));
    request.on('response', (response) => {
      clearTimeout(connecting);
      clearTimeout(answering);
      resolve(response);
    });
    request.on('error', (error) => {
      clearTimeout(connecting);
      clearTimeout(answering);
      reject(error);
    });
    request.end();
  });
}

/** The body, unpacked, no larger than MAX_FEED_BYTES however it is sent. */
async function bodyOf(response: http.IncomingMessage): Promise<string> {
  const encoding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase();
  const declared = Number(response.headers['content-length']);
  if (!encoding && declared > MAX_FEED_BYTES) {
    response.destroy();
    throw new LinkError('too_large');
  }
  let stream: Readable = response;
  if (encoding === 'gzip' || encoding === 'x-gzip') stream = response.pipe(zlib.createGunzip());
  else if (encoding === 'deflate') stream = response.pipe(zlib.createInflate());
  else if (encoding === 'br') stream = response.pipe(zlib.createBrotliDecompress());
  else if (encoding && encoding !== 'identity') {
    response.destroy();
    throw new LinkError('not_calendar');
  }
  if (stream !== response) {
    // What arrives packed is limited too, and whatever ends the arrival ends the unpacking.
    let sent = 0;
    response.on('data', (chunk: Buffer) => {
      sent += chunk.length;
      if (sent > MAX_FEED_BYTES) stream.destroy(new LinkError('too_large'));
    });
    response.on('error', (error) => stream.destroy(error));
    response.on('aborted', () => stream.destroy(new LinkError('busy')));
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_FEED_BYTES) throw new LinkError('too_large');
      chunks.push(chunk);
    }
  } catch (error) {
    response.destroy();
    if (error instanceof LinkError) throw error;
    // Something unpacked that would not unpack is not a calendar; anything else, the connection.
    throw new LinkError((error as { code?: string })?.code?.startsWith('Z_') ? 'not_calendar' : 'busy');
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks)).replace(/^﻿/, '');
}

/** Whether a text is iCalendar: one calendar, begun and ended. Nothing else is read as one. */
export const isCalendar = (text: string) => /^\s*BEGIN:VCALENDAR\r?\n/i.test(text) && /\r?\nEND:VCALENDAR\s*$/i.test(text);

/** A validator Koyomi will send back as it was given: printable, without spaces, not long. */
const validator = (value: unknown) => (typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value) ? value : null);
const httpDate = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9 ,:+-]{1,64}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null);

export type Fetched = { unchanged: true } | { unchanged: false; text: string; etag: string | null; lastModified: string | null };

export interface FetchOptions {
  /** What the last reading was given, to ask whether anything has changed since. */
  etag?: string | null;
  lastModified?: string | null;
  deadline?: AbortSignal;
  /** Koyomi's own host, which it never asks itself. */
  own?: string;
  /** How names are looked up. Only the tests give another. */
  resolve?: Resolve;
  /** The browser tests' stand-in, the one address asked as it is (never on a deployment). */
  test?: string | null;
}

/**
 * Fetches a calendar link: the calendar, or word that it has not changed since `etag` or
 * `lastModified`. Throws a LinkError otherwise, which says only what kind of failure it was.
 */
export async function fetchLink(start: URL, options: FetchOptions = {}): Promise<Fetched> {
  const signal = AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), ...(options.deadline ? [options.deadline] : [])]);
  const etag = validator(options.etag);
  const lastModified = httpDate(options.lastModified);
  const headers: Record<string, string> = {
    accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1',
    'accept-encoding': 'gzip, deflate, br',
    'user-agent': 'Koyomi (+https://koyomi.guru)',
    ...(etag ? { 'if-none-match': etag } : {}),
    ...(lastModified ? { 'if-modified-since': lastModified } : {}),
  };
  const seen = new Set<string>();
  let url = start;
  for (let hop = 0; ; hop++) {
    // Round in a circle, or on and on: not a calendar.
    if (seen.has(url.href) || hop > MAX_REDIRECTS) throw new LinkError('not_calendar');
    seen.add(url.href);
    const testing = !!options.test && url.origin === options.test;
    if (!testing && !followable(url, options.own)) throw new LinkError(hop ? 'forbidden' : 'bad_link');

    const said = { forbidden: false };
    let response: http.IncomingMessage;
    try {
      response = await ask(url, headers, testing ? undefined : checkedLookup(options.resolve ?? resolveName, said), signal);
    } catch (error) {
      if (said.forbidden) throw new LinkError('forbidden');
      if (error instanceof LinkError) throw error;
      throw new LinkError('busy');
    }

    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      response.resume();
      let next: URL;
      try {
        next = new URL(String(response.headers.location ?? ''), url);
      } catch {
        throw new LinkError('not_calendar');
      }
      next.hash = '';
      url = next;
      continue;
    }
    if (status === 304 && (etag || lastModified)) {
      response.resume();
      return { unchanged: true };
    }
    if ([401, 403, 404, 410].includes(status)) {
      response.resume();
      throw new LinkError('refused');
    }
    if (status === 429) {
      response.resume();
      const seconds = Number(response.headers['retry-after']);
      throw new LinkError('slow_down', Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60);
    }
    if (status >= 500 || status === 408) {
      response.resume();
      // A server failing is a bad moment, and the link is left as it is. A link sent on to an error
      // page is not one: that is how a published calendar is answered once it is withdrawn (Outlook:
      // a redirect or two, then a web page saying 500). A gateway's 502, 503 or 504 says nothing of
      // the link, wherever it comes from.
      const sentAway = hop > 0 && status === 500 && /^text\/html\b/i.test(String(response.headers['content-type'] ?? ''));
      throw new LinkError(sentAway ? 'not_calendar' : 'busy');
    }
    if (status !== 200) {
      response.resume();
      throw new LinkError('not_calendar');
    }
    const text = await bodyOf(response);
    if (!isCalendar(text)) throw new LinkError('not_calendar');
    return { unchanged: false, text, etag: validator(response.headers.etag), lastModified: httpDate(response.headers['last-modified']) };
  }
}
