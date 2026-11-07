import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { keyFor, type AiConfig } from './config';

// The tokens Koyomi issues to AI clients (docs/MCP.md). None of them is a provider's: an AI
// client never holds anything that could open a Google, Microsoft or Yahoo account, or a link.
//
// - Access token: `ka1.<payload>.<mac>`, signed with a key of its own, for 15 minutes, for the
//   MCP endpoint only. It says which grant and which client; every request also checks the grant
//   in the database, so revoking a grant ends its tokens at once.
// - Refresh token and authorization code: 256 random bits, given out once and kept only as a
//   keyed hash.

export const ACCESS_SECONDS = 15 * 60;
export const REFRESH_SECONDS = 30 * 24 * 60 * 60;
export const CODE_SECONDS = 5 * 60;

export interface AccessClaims {
  /** The grant. */
  g: string;
  /** The client it was issued to. */
  c: string;
  /** The audience: the MCP endpoint. */
  a: string;
  /** Expiry, in seconds since 1970. */
  e: number;
}

const mac = (config: AiConfig, payload: string) => createHmac('sha256', keyFor(config, 'access')).update(payload).digest('base64url');

export function issueAccess(config: AiConfig, grantId: string, clientId: string, now = Date.now()): { token: string; expiresIn: number } {
  const claims: AccessClaims = { g: grantId, c: clientId, a: config.resource, e: Math.floor(now / 1000) + ACCESS_SECONDS };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { token: `ka1.${payload}.${mac(config, payload)}`, expiresIn: ACCESS_SECONDS };
}

/** The claims of a token Koyomi issued, unexpired, for this very endpoint; otherwise null. */
export function readAccess(config: AiConfig, token: string, now = Date.now()): AccessClaims | null {
  if (token.length > 2048) return null;
  const [version, payload, tag, ...rest] = token.split('.');
  if (version !== 'ka1' || !payload || !tag || rest.length) return null;
  const expected = Buffer.from(mac(config, payload));
  const given = Buffer.from(tag);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: AccessClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  if (typeof claims?.g !== 'string' || typeof claims.c !== 'string' || typeof claims.a !== 'string' || typeof claims.e !== 'number') return null;
  if (claims.a !== config.resource) return null;
  if (claims.e * 1000 <= now) return null;
  return claims;
}

/** A secret to give out once: a code or a refresh token. */
export const secret = (prefix: 'kc' | 'kr') => `${prefix}.${randomBytes(32).toString('base64url')}`;

/** RFC 7636: the verifier's shape, and S256 only. */
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** A code challenge Koyomi accepts: the S256 of a verifier, which is always 43 characters. */
export const isChallenge = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
