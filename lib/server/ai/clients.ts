import { randomBytes } from 'node:crypto';
import { fetchPublic } from '../fetchlink';
import type { AiConfig } from './config';
import type { AiClient, AiStore } from './store';

// Who is asking for access (docs/MCP.md). A client is known one of two ways:
//
// - By a metadata document (the MCP spec's preferred way, used by Claude and ChatGPT): its
//   client_id is an https address, and what is there says which redirect addresses it uses.
// - By registering itself (RFC 7591, kept for clients that do not publish a document): Koyomi
//   stores the addresses it gave and hands it a random client_id.
//
// Either way the client is a public one (no secret; PKCE instead), and the only thing trusted
// about it is where its redirect addresses lead: tokens can only ever reach those.

export interface KnownClient {
  clientId: string;
  redirectUris: string[];
  kind: 'document' | 'registered';
}

const MAX_URIS = 10;
const MAX_URI_LENGTH = 512;
const DOCUMENT_BYTES = 16 * 1024;
const DOCUMENT_TIMEOUT_MS = 5000;
const DOCUMENT_TTL_MS = 10 * 60 * 1000;
const REGISTERED = /^kc_[A-Za-z0-9_-]{32}$/;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLoopback = (url: URL) => url.protocol === 'http:' && LOOPBACK.has(url.hostname);

/** A redirect address Koyomi will send a code to: https, or a native app on this very computer. Never a fragment or credentials. */
export function redirectAllowed(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || value.includes('#') || url.username || url.password) return false;
  return url.protocol === 'https:' || isLoopback(url);
}

/**
 * Whether `asked` is one of the client's redirect addresses: exactly, character for character.
 * The one allowance is the port of a loopback address, which a native app picks when it starts
 * (RFC 8252 §7.3); scheme, host and path must still be the same.
 */
export function redirectMatches(registered: string[], asked: string): boolean {
  if (!redirectAllowed(asked)) return false;
  if (registered.includes(asked)) return true;
  const a = new URL(asked);
  if (!isLoopback(a)) return false;
  return registered.some((each) => {
    try {
      const r = new URL(each);
      return isLoopback(r) && r.hostname === a.hostname && r.pathname === a.pathname && r.search === a.search;
    } catch {
      return false;
    }
  });
}

/**
 * How Koyomi names a client to the person: by where its redirect address leads, which is the only
 * thing about a client that is checked. A name a client gives itself is never used, so nothing can
 * pass itself off as Claude without sending its codes to Claude.
 */
export function labelFor(redirectUri: string): { label: string; host: string } {
  const url = new URL(redirectUri);
  const host = url.host.toLowerCase();
  const name = url.hostname.toLowerCase();
  const under = (domain: string) => name === domain || name.endsWith(`.${domain}`);
  if (isLoopback(url)) return { label: 'An app on this computer', host };
  if (url.protocol !== 'https:') return { label: 'Other MCP client', host };
  if (under('claude.ai') || under('claude.com')) return { label: 'Claude', host };
  if (under('chatgpt.com') || under('openai.com')) return { label: 'ChatGPT', host };
  if (under('grok.com') || under('x.ai')) return { label: 'Grok', host };
  return { label: 'Other MCP client', host };
}

/** A client_id that is a metadata document's address: https, with a path, nothing else. */
function documentAddress(clientId: string): URL | null {
  if (clientId.length > MAX_URI_LENGTH || !clientId.startsWith('https://')) return null;
  try {
    const url = new URL(clientId);
    if (url.hash || url.username || url.password || url.pathname === '/' || !url.pathname) return null;
    return url;
  } catch {
    return null;
  }
}

const shared = globalThis as typeof globalThis & { koyomiAiDocuments?: Map<string, { until: number; client: KnownClient | null }> };
const documents = () => (shared.koyomiAiDocuments ??= new Map());

/** Whether a client's own words allow it to be a public client (no secret, PKCE). */
function publicClient(doc: Record<string, unknown>): boolean {
  const one = doc.token_endpoint_auth_method;
  const many = doc.token_endpoint_auth_methods_supported;
  if (one === undefined && many === undefined) return true;
  if (one === 'none') return true;
  return Array.isArray(many) && many.includes('none');
}

/** The client a metadata document describes, if it is one Koyomi can serve. */
export function clientFromDocument(clientId: string, text: string): KnownClient | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  // The document must name itself, exactly: a document at one address cannot speak for another.
  if (d.client_id !== clientId) return null;
  const uris = d.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_URIS || !uris.every(redirectAllowed)) return null;
  if (!publicClient(d)) return null;
  return { clientId, redirectUris: [...uris], kind: 'document' };
}

/**
 * The client behind a client_id, or null if Koyomi does not know it and cannot learn it. A
 * document is fetched from the public internet only, and kept for ten minutes (a missing or
 * unusable one too, so a client cannot make Koyomi fetch on every request).
 */
export async function resolveClient(config: AiConfig, store: AiStore, clientId: unknown, test?: string | null): Promise<KnownClient | null> {
  if (typeof clientId !== 'string' || !clientId) return null;
  if (REGISTERED.test(clientId)) {
    const client = await store.getClient(clientId);
    return client ? { clientId, redirectUris: client.redirectUris, kind: 'registered' } : null;
  }
  // The browser tests' stand-in is the one document fetched over http (never on a deployment).
  const address = documentAddress(clientId) ?? (test && clientId.startsWith(`${test}/`) ? new URL(clientId) : null);
  if (!address) return null;
  const cache = documents();
  const held = cache.get(clientId);
  if (held && held.until > Date.now()) return held.client;
  const text = await fetchPublic(address, { maxBytes: DOCUMENT_BYTES, timeoutMs: DOCUMENT_TIMEOUT_MS, accept: 'application/json', own: new URL(config.issuer).hostname, test });
  const client = text === null ? null : clientFromDocument(clientId, text);
  if (cache.size > 500) cache.clear();
  cache.set(clientId, { until: Date.now() + DOCUMENT_TTL_MS, client });
  return client;
}

export type Registration = { client: AiClient; body: Record<string, unknown> } | { error: string; description: string };

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || null : null;

/** A client registering itself (RFC 7591). Only a public client using codes with PKCE is accepted. */
export function register(body: unknown): Registration {
  const fail = (description: string): Registration => ({ error: 'invalid_client_metadata', description });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Expected a JSON object.');
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_URIS) return { error: 'invalid_redirect_uri', description: 'Give between 1 and 10 redirect_uris.' };
  if (!uris.every(redirectAllowed)) return { error: 'invalid_redirect_uri', description: 'Each redirect URI must be https, or http on localhost.' };
  if (b.token_endpoint_auth_method !== undefined && b.token_endpoint_auth_method !== 'none') return fail('Only public clients (token_endpoint_auth_method "none", with PKCE) are supported.');
  const grants = b.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grants) || !grants.every((g) => g === 'authorization_code' || g === 'refresh_token')) return fail('Only authorization_code and refresh_token are supported.');
  const responses = b.response_types ?? ['code'];
  if (!Array.isArray(responses) || !responses.every((r) => r === 'code')) return fail('Only the code response type is supported.');
  const client: AiClient = { clientId: `kc_${randomBytes(24).toString('base64url')}`, redirectUris: [...(uris as string[])], clientName: text(b.client_name, 100) };
  return {
    client,
    body: {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: grants,
      response_types: ['code'],
      ...(client.clientName ? { client_name: client.clientName } : {}),
    },
  };
}
