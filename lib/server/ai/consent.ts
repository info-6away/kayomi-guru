import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { open, seal } from '../seal';
import { resolveClient, labelFor, redirectMatches } from './clients';
import { keyFor, type AiConfig } from './config';
import type { AiStore } from './store';
import { isChallenge } from './tokens';

// The authorization request (docs/MCP.md), from an AI client's link to the person's answer. What
// was asked is checked once, then kept for ten minutes in a sealed cookie that page code cannot
// read, while the person signs in and chooses calendars. The answer is accepted only from this
// site, from the person who was shown the question, with the value the page was given.

export const CONSENT_COOKIE = 'koyomi_ai_consent';
export const CONSENT_SECONDS = 600;
const SEALED_AS = 'ai-consent';

export interface Pending {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
  /** How the client is named to the person, from its redirect address. */
  label: string;
  host: string;
  /** Ties the page's form to this request. */
  nonce: string;
  expires: number;
}

export type Checked = { ok: Pending } | { page: string } | { redirect: string };

/** The client's redirect address with OAuth's answer added, and the issuer (RFC 9207). */
export function back(config: AiConfig, redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  url.searchParams.set('iss', config.issuer);
  return url.toString();
}

/** OAuth's refusal for someone the private beta does not include: the same words whoever it is. */
export const notGranted = (config: AiConfig, pending: Pick<Pending, 'redirectUri' | 'state'>) =>
  back(config, pending.redirectUri, { error: 'access_denied', error_description: 'Access was not granted', state: pending.state });

const printable = (value: string | null, max: number) => value === null || (value.length <= max && /^[\x20-\x7e]*$/.test(value));

/**
 * Checks an authorization request. Until the client and its redirect address are known to belong
 * together, nothing is sent anywhere: the person sees a page. After that, a fault goes back to the
 * client, as OAuth says it must.
 */
export async function checkRequest(config: AiConfig, store: AiStore, params: URLSearchParams, test?: string | null): Promise<Checked> {
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const client = await resolveClient(config, store, clientId, test);
  if (!client) return { page: 'Koyomi does not recognise the app asking for access, or could not check it just now.' };
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) return { page: 'The address this app asked to return to is not one of its own.' };
  // A registered client in use is not one to tidy away (CLIENT_RETENTION).
  if (client.kind === 'registered') await store.touchClient(client.clientId);

  const state = params.get('state');
  const fail = (error: string, description: string): Checked => ({ redirect: back(config, redirectUri, { error, error_description: description, state }) });
  if (!printable(state, 512)) return fail('invalid_request', 'state is too long or not printable');
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only the code response type is supported');
  if (params.get('code_challenge_method') !== 'S256' || !isChallenge(params.get('code_challenge'))) return fail('invalid_request', 'PKCE with S256 is required');
  // RFC 8707: the one resource there is. A client that names none is given it.
  const resource = params.get('resource');
  if (resource !== null && resource.replace(/\/$/, '') !== config.resource) return fail('invalid_target', 'Koyomi issues tokens only for its MCP endpoint');
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
  if (!printable(params.get('scope'), 512) || scopes.length > 10) return fail('invalid_scope', 'scope is not valid');

  const { label, host } = labelFor(redirectUri);
  return {
    ok: { clientId: client.clientId, redirectUri, state, codeChallenge: params.get('code_challenge')!, resource: config.resource, label, host, nonce: randomBytes(16).toString('base64url'), expires: Date.now() + CONSENT_SECONDS * 1000 },
  };
}

export const sealPending = (config: AiConfig, pending: Pending) => seal(JSON.stringify(pending), config.connections.tokenKey, SEALED_AS);

/** The request a cookie holds, or null: none, altered, made elsewhere, or out of time. */
export function openPending(config: AiConfig, cookie: string | undefined, now = Date.now()): Pending | null {
  if (!cookie) return null;
  try {
    const pending = JSON.parse(open(cookie, config.connections.tokenKey, SEALED_AS)) as Pending;
    if (typeof pending?.nonce !== 'string' || typeof pending.redirectUri !== 'string' || typeof pending.expires !== 'number') return null;
    return pending.expires > now ? pending : null;
  } catch {
    return null;
  }
}

/** The value the consent page's form carries: this request, and this person, and nothing else. */
export const formToken = (config: AiConfig, pending: Pending, subject: string) => createHmac('sha256', keyFor(config, 'form')).update(`${pending.nonce}\n${subject}`).digest('base64url');

export function formTokenMatches(config: AiConfig, pending: Pending, subject: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const expected = Buffer.from(formToken(config, pending, subject));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The cookie's settings: this site only, page code cannot read it, gone in ten minutes. */
export const consentCookie = (value: string, maxAge = CONSENT_SECONDS) => ({
  name: CONSENT_COOKIE,
  value,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge,
});
