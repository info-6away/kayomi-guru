import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { keyFor, type AiConfig } from './config';
import type { AiStore, Grant } from './store';

// The limits on AI access (docs/MCP.md, "Limits"), each counted in the database so that it holds
// across every Vercel instance at once (store.ts, spendLimit; migration 005). What is counted is
// named only by a keyed hash: no person, client id or address is stored, and nothing of any event.
//
// Tool calls (lib/server/ai/mcp.ts), each spending one unit of all that apply:
//
// - the grant's own allowance (GRANT_ALLOWANCE, on ai_grants): one assistant of one person;
// - the person's (PERSON_ALLOWANCE): all of that person's assistants together, so that adding
//   assistants does not multiply what one person can ask of their providers;
// - one self-registered client's (CLIENT_ALLOWANCE), across every person using it.
//
// There is no limit shared by all the users of one platform. ChatGPT and Claude each use one client
// id (a metadata document) for all their users, so a cap on that id would let one busy person slow
// everyone else down. Those clients are held by the per-person and per-grant limits alone.
//
// Behind all of them, each calendar connection keeps its own allowance of provider reads
// (ALLOWANCE in lib/server/api.ts, 120 a minute), and identical reads within a minute are answered from
// memory (read.ts): an assistant cannot make Koyomi ask Google, Microsoft, Yahoo or a link's
// server more than the app itself may.

/** Tool calls one grant may make: a person asks a few questions a minute; an assistant in a loop is stopped here. */
export const GRANT_ALLOWANCE = { units: 30, seconds: 60 };
/** All of one person's assistants together: a few questions a minute, with room for an assistant that asks several things at once. */
export const PERSON_ALLOWANCE = { units: 60, seconds: 60 };
/** One self-registered client (one Grok connection, one installed app) across every person who uses it. */
export const CLIENT_ALLOWANCE = { units: 300, seconds: 60 };

/** Registrations from one source address an hour. A client registers once per connection. */
export const REGISTRATION_SOURCE_ALLOWANCE = { units: 10, seconds: 3600 };
/** Registrations from everywhere together an hour: a ceiling on what any number of addresses can add. */
export const REGISTRATION_ALLOWANCE = { units: 300, seconds: 3600 };
/** Self-registered clients that have never started an authorization, at most. Past it, no more are taken until some are tidied away. */
export const UNUSED_CLIENTS_CAP = 2000;

export type LimitKind = 'person' | 'client' | 'source' | 'registrations';

/** What a limit is kept under: its kind, and a keyed hash of what it counts. */
export function limitKey(config: AiConfig, kind: LimitKind, value: string): string {
  return `${kind}:${createHmac('sha256', keyFor(config, 'limit')).update(`${kind}\n${value}`).digest('base64url').slice(0, 32)}`;
}

/**
 * Whether a client id is a platform's, shared by all its users: an https address, the client's
 * metadata document (ChatGPT's, Claude's). A self-registered client's id is Koyomi's own random one.
 */
export const sharedClient = (clientId: string) => clientId.startsWith('https://');

/** The test header the browser tests name their source by. Read only where KOYOMI_TEST_TRUST_SOURCE is on, and never on Vercel. */
export const TEST_SOURCE_HEADER = 'x-koyomi-test-source';

/**
 * The address a request came from, as far as it can be trusted, or null.
 *
 * On Vercel, `x-real-ip` and `x-forwarded-for` are set by Vercel's own edge to the client's address,
 * replacing whatever the client sent, so a client cannot choose them. Anywhere else, every header
 * is the client's own word, and none is taken: all requests are one source, "unknown", which only
 * makes the limit stricter. The browser tests may name a source with TEST_SOURCE_HEADER, which is
 * honoured only where KOYOMI_TEST_TRUST_SOURCE is on and never on any Vercel deployment.
 */
export function sourceOf(request: Request, env: Record<string, string | undefined> = process.env): string | null {
  if (env.VERCEL) {
    const real = request.headers.get('x-real-ip')?.trim() ?? '';
    if (isIP(real)) return real;
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
    return isIP(forwarded) ? forwarded : null;
  }
  if (env.KOYOMI_TEST_TRUST_SOURCE?.trim() === 'on') {
    const named = request.headers.get(TEST_SOURCE_HEADER)?.trim() ?? '';
    return /^[A-Za-z0-9._:-]{1,100}$/.test(named) ? named : null;
  }
  return null;
}

export type Spent = null | { refused: null } | { refused: 'grant' | 'person' | 'client'; retryAfter: number };

/**
 * Counts one tool call against every limit it falls under, in `store` (the database: across all
 * servers). Null when the grant has ended. Otherwise which limit refused it, if one did, and when
 * to try again. The grant's own comes first, so a revoked grant spends nothing else; then the
 * person's; then, for a self-registered client only, the client's.
 */
export async function spendCallIn(store: AiStore, config: AiConfig, grant: Pick<Grant, 'id' | 'subject' | 'clientId'>): Promise<Spent> {
  const own = await store.spendGrant(grant.id, 1, GRANT_ALLOWANCE);
  if (!own) return null;
  if (!own.allowed) return { refused: 'grant', retryAfter: own.retryAfter };
  const person = await store.spendLimit(limitKey(config, 'person', grant.subject), 1, PERSON_ALLOWANCE);
  if (!person.allowed) return { refused: 'person', retryAfter: person.retryAfter };
  if (!sharedClient(grant.clientId)) {
    const client = await store.spendLimit(limitKey(config, 'client', grant.clientId), 1, CLIENT_ALLOWANCE);
    if (!client.allowed) return { refused: 'client', retryAfter: client.retryAfter };
  }
  return { refused: null };
}

/** A tool call refused by a limit, said plainly: which limit, and when to try again. */
export const LIMIT_WORDS: Record<'grant' | 'person' | 'client', string> = {
  grant: 'Too many calendar requests from this assistant just now.',
  person: 'Too many calendar requests for this person just now, across all of their assistants.',
  client: 'Too many calendar requests from this app just now.',
};
