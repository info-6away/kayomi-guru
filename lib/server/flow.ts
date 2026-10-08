import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pkce } from './google';
import { open, seal } from './seal';

// The round trip to Google's consent screen and back. Between the two halves, what the server
// needs to recognise the return is kept in one cookie that page code cannot read, sealed so it
// cannot be read or altered by anyone, and used once.

/** How long someone has to get through Google's screen. */
export const FLOW_SECONDS = 600;

export interface Flow {
  /** Sent to Google and expected back unchanged: 128 random bits, new for every attempt. */
  state: string;
  /** The PKCE secret, whose hash Google was shown. Proves the code is being redeemed by whoever asked for it. */
  verifier: string;
  /** Who started the flow. Whoever finishes it must be the same person. */
  subject: string;
  /** After this instant the attempt is void, even if the cookie is still around. */
  expires: number;
}

const SEALED_AS = 'google-consent-flow';

/** Starts an attempt: what to remember, and the hash to show Google. */
export function beginFlow(subject: string, key: string, now = Date.now()) {
  const { verifier, challenge } = pkce();
  const flow: Flow = { state: randomBytes(16).toString('base64url'), verifier, subject, expires: now + FLOW_SECONDS * 1000 };
  return { flow, challenge, cookie: seal(JSON.stringify(flow), key, SEALED_AS) };
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The attempt a returning visitor belongs to, or null if there is none to honour: no cookie,
 * a cookie that was not made here or has been changed, one that has expired, a `state` that is
 * not the one sent, or a different person from the one who started.
 */
export function finishFlow(cookie: string | undefined, key: string, returned: { state: string | null; subject: string | null }, now = Date.now()): Flow | null {
  if (!cookie || !returned.state || !returned.subject) return null;
  let flow: Flow;
  try {
    flow = JSON.parse(open(cookie, key, SEALED_AS));
  } catch {
    return null;
  }
  if (typeof flow?.state !== 'string' || typeof flow.verifier !== 'string' || typeof flow.subject !== 'string' || typeof flow.expires !== 'number') return null;
  if (flow.expires <= now) return null;
  if (!same(flow.state, returned.state) || !same(flow.subject, returned.subject)) return null;
  return flow;
}
