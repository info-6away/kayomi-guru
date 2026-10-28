import { DOMParser, onErrorStopParsing } from '@xmldom/xmldom';

// A CalDAV client that can only read. It sends two kinds of request, PROPFIND (what is there)
// and REPORT (the events in a span), both read-only by definition, and refuses to send anything
// else. Every request goes to one origin, fixed by the caller and never by anything a browser
// sends; a redirect is followed only within that origin, and no more than a few times.

export const DAV = 'DAV:';
export const CALDAV = 'urn:ietf:params:xml:ns:caldav';

/** The only methods this client sends. Neither can create, change or delete anything. */
export const READ_METHODS = ['PROPFIND', 'REPORT'] as const;
export type ReadMethod = (typeof READ_METHODS)[number];

/** No single request is waited on for longer than this. */
export const REQUEST_TIMEOUT_MS = 15_000;
/** An answer longer than this is not read. */
export const MAX_BYTES = 10 * 1024 * 1024;
/** Redirects followed for one request, all within the origin. */
const MAX_HOPS = 3;

/**
 * Why a request gave no answer to read: the server's status, or `network` (no answer),
 * `redirect` (it sent Koyomi to another origin, which is not followed), `malformed` (the answer
 * is not XML that can be trusted), `too_large`.
 */
export class DavError extends Error {
  constructor(
    public readonly status: number | 'network' | 'redirect' | 'malformed' | 'too_large',
    public readonly retryAfter?: number,
  ) {
    super(`CalDAV: ${status}`);
  }
}

export interface DavRequest {
  /** The one origin requests may go to, e.g. https://caldav.calendar.yahoo.com. */
  origin: string;
  /** The `Authorization` header's value. Never logged, never part of an error. */
  authorization: string;
  method: ReadMethod;
  /** A path on the origin. Anything that would lead elsewhere is refused before it is sent. */
  path: string;
  depth: '0' | '1';
  body: string;
  deadline?: AbortSignal;
}

const limit = (deadline?: AbortSignal) => (deadline ? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), deadline]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS));

/** A path on the origin, as a full address, or null if it would lead anywhere else. */
export function onOrigin(origin: string, path: string, base?: URL): URL | null {
  if (typeof path !== 'string' || !path) return null;
  try {
    const url = new URL(path, base ?? `${origin}/`);
    if (url.origin !== origin || url.username || url.password) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

async function readAll(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) throw new DavError('too_large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new DavError('too_large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * XML, parsed as XML with namespaces. A document type declaration is refused outright: a
 * calendar server has no use for one, and entities are how XML is made to grow without end.
 */
export function parseXml(text: string): Document {
  if (/<!DOCTYPE/i.test(text)) throw new DavError('malformed');
  try {
    return new DOMParser({ onError: onErrorStopParsing }).parseFromString(text, 'text/xml') as unknown as Document;
  } catch {
    throw new DavError('malformed');
  }
}

/** Sends one read-only request and returns the multistatus it answers with. */
export async function dav(request: DavRequest): Promise<Document> {
  // Checked as it runs, not only by type: nothing can call this to write.
  if (!(READ_METHODS as readonly string[]).includes(request.method)) throw new TypeError('This client only reads');
  let url = onOrigin(request.origin, request.path);
  if (!url) throw new DavError('redirect');
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers: {
          authorization: request.authorization,
          depth: request.depth,
          'content-type': 'application/xml; charset=utf-8',
          accept: 'application/xml, text/xml',
        },
        body: request.body,
        redirect: 'manual',
        cache: 'no-store',
        signal: limit(request.deadline),
      });
    } catch {
      throw new DavError('network');
    }
    if ([301, 302, 307, 308].includes(response.status)) {
      const next = onOrigin(request.origin, response.headers.get('location') ?? '', url);
      await response.body?.cancel().catch(() => {});
      // Somewhere else entirely: not followed, whatever it is.
      if (!next) throw new DavError('redirect');
      url = next;
      continue;
    }
    if (response.status === 207 || response.status === 200) return parseXml(await readAll(response));
    await response.body?.cancel().catch(() => {});
    const seconds = Number(response.headers.get('retry-after'));
    throw new DavError(response.status, seconds > 0 ? Math.min(Math.ceil(seconds), 3600) : undefined);
  }
  throw new DavError('redirect');
}

// ---------- Reading a multistatus ----------

/** The child elements of an element with this namespace and name. */
export const children = (parent: Element | Document | null | undefined, ns: string, name: string): Element[] => {
  if (!parent) return [];
  const out: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === ns && (node as Element).localName === name) out.push(node as Element);
  }
  return out;
};
export const child = (parent: Element | Document | null | undefined, ns: string, name: string): Element | null => children(parent, ns, name)[0] ?? null;
export const textOf = (element: Element | null | undefined) => (element?.textContent ?? '').trim();

export interface DavResponse {
  href: string;
  /** The properties the server found, from its successful propstat. Null if it found none. */
  prop: Element | null;
}

/** Each response in a multistatus: its address, and what it says was found. */
export function responses(doc: Document): DavResponse[] {
  const root = doc.documentElement;
  if (!root || root.namespaceURI !== DAV || root.localName !== 'multistatus') throw new DavError('malformed');
  return children(root, DAV, 'response').map((response) => {
    const ok = children(response, DAV, 'propstat').find((propstat) => /\s2\d\d\s/.test(` ${textOf(child(propstat, DAV, 'status'))} `));
    return { href: textOf(child(response, DAV, 'href')), prop: ok ? child(ok, DAV, 'prop') : null };
  });
}

/** The address inside a property such as current-user-principal: `<prop><name><href>…`. */
export const hrefIn = (prop: Element | null, ns: string, name: string) => textOf(child(child(prop, ns, name), DAV, 'href'));
