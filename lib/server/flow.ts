import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Provider } from '../calendars/types';
import { pkce } from './google';
import { open, seal } from './seal';

// The round trip to a provider's consent screen and back. Between the two halves, what the
// server needs to recognise the return is kept in one cookie that page code cannot read, sealed
// so it cannot be read or altered by anyone, and used once. A round trip to one provider is
// sealed for that provider, so it can never be finished at another's address.

/** How long someone has to get through the provider's screen. */
export const FLOW_SECONDS = 600;

export interface Flow {
  /** Sent to the provider and expected back unchanged: 128 random bits, new for every attempt. */
  state: string;
  /** The PKCE secret, whose hash the provider was shown. Proves the code is being redeemed by whoever asked for it. */
  verifier: string;
  /**
   * Sent to the provider and expected back inside the ID token it issues (OpenID Connect, so
   * Microsoft only): that token was issued for this attempt and no other. 128 random bits.
   */
  nonce: string;
  /** Who started the flow. Whoever finishes it must be the same person. */
  subject: string;
  /** After this instant the attempt is void, even if the cookie is still around. */
  expires: number;
}

const sealedAs = (provider: Provider) => `${provider}-consent-flow`;

/** Starts an attempt: what to remember, and the hash to show the provider. */
export function beginFlow(subject: string, key: string, now = Date.now(), provider: Provider = 'google') {
  const { verifier, challenge } = pkce();
  const flow: Flow = { state: randomBytes(16).toString('base64url'), verifier, nonce: randomBytes(16).toString('base64url'), subject, expires: now + FLOW_SECONDS * 1000 };
  return { flow, challenge, cookie: seal(JSON.stringify(flow), key, sealedAs(provider)) };
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The attempt a returning visitor belongs to, or null if there is none to honour: no cookie,
 * a cookie that was not made here, or for another provider, or has been changed, one that has
 * expired, a `state` that is not the one sent, or a different person from the one who started.
 */
export function finishFlow(
  cookie: string | undefined,
  key: string,
  returned: { state: string | null; subject: string | null },
  now = Date.now(),
  provider: Provider = 'google',
): Flow | null {
  if (!cookie || !returned.state || !returned.subject) return null;
  let flow: Flow;
  try {
    flow = JSON.parse(open(cookie, key, sealedAs(provider)));
  } catch {
    return null;
  }
  if (typeof flow?.state !== 'string' || typeof flow.verifier !== 'string' || typeof flow.subject !== 'string' || typeof flow.expires !== 'number') return null;
  // Google's round trip carries no ID token, so its nonce is not checked, and an attempt begun
  // before nonces were sealed in is honoured as it was. Microsoft's must have one.
  if (provider !== 'google' && typeof flow.nonce !== 'string') return null;
  if (flow.expires <= now) return null;
  if (!same(flow.state, returned.state) || !same(flow.subject, returned.subject)) return null;
  return flow;
}
