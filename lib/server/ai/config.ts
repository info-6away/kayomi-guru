import { createHmac } from 'node:crypto';
import type { Provider } from '../../calendars/types';
import { connectionsConfig, type ConnectionsConfig } from '../env';

// AI access (docs/MCP.md): Koyomi as a read-only MCP server and the OAuth authorization server in
// front of it. Off unless KOYOMI_MCP=on, and only where calendar connections themselves are set up:
// it reads nothing they cannot.

export interface AiConfig {
  connections: ConnectionsConfig;
  /** The authorization server's identifier: the app's own origin, e.g. https://app.koyomi.guru. */
  issuer: string;
  /** The MCP endpoint, and the one audience Koyomi's access tokens are issued for. */
  resource: string;
  /** Whether this 6Away subject may use AI access at all: `access(subject).allowed`. */
  allowed: (subject: string | null | undefined) => boolean;
  /** What this 6Away subject may do with AI access (accessPolicy). */
  access: (subject: string | null | undefined) => Access;
}

/**
 * What one person may do with AI access.
 *
 * - `allowed`: may use it at all.
 * - `google`: may share Google calendars with an assistant.
 * - `via`: why — on the private allowlist, let in by public access, or neither.
 */
export interface Access {
  allowed: boolean;
  google: boolean;
  via: 'allowlist' | 'public' | 'none';
}

const NOBODY: Access = { allowed: false, google: false, via: 'none' };

/**
 * Whether a person with this access may share calendars at this provider with an assistant. The
 * one rule the consent page, the decision and every read go by (read.ts): Google only where
 * `google` says so; Microsoft, Yahoo and calendar links wherever AI access is allowed at all.
 */
export const mayShare = (access: Access, provider: Provider) => access.allowed && (provider !== 'google' || access.google);

/** The one scope there is: reading the calendars a person chose. */
export const SCOPE = 'calendars.read';

/**
 * The private beta's allowlist: the 6Away subjects in KOYOMI_MCP_ALLOWLIST (separated by commas or
 * spaces), set in Vercel's Production settings and nowhere in this repository. Unset or empty
 * means nobody. Exact matches only: no patterns, no addresses.
 *
 * KOYOMI_TEST_AI_ALLOW_PREFIX lets the browser tests' stand-in people in (each test signs in as a
 * person of its own); it is ignored on any Vercel deployment.
 */
export function allowlist(env: Record<string, string | undefined> = process.env): (subject: string | null | undefined) => boolean {
  const people = new Set((env.KOYOMI_MCP_ALLOWLIST ?? '').split(/[\s,]+/).filter(Boolean));
  const prefix = env.VERCEL ? '' : (env.KOYOMI_TEST_AI_ALLOW_PREFIX?.trim() ?? '');
  return (subject) => typeof subject === 'string' && subject !== '' && (people.has(subject) || (prefix !== '' && subject.startsWith(prefix)));
}

/** A switch is on only when it says "on" (white space around it aside, as KOYOMI_MCP). Unset, empty, "true", "ON", "yes", anything else: off. */
const on = (value: string | undefined) => value?.trim() === 'on';

/**
 * Who may use AI access, and whether with Google calendars (docs/MCP.md, "Public access"). Three
 * settings, each failing closed:
 *
 * - **KOYOMI_MCP_ALLOWLIST**, the private beta. Its people may use AI access with every provider,
 *   Google included, as they always have. Empty means nobody, never everyone.
 * - **KOYOMI_MCP_PUBLIC=on** lets in every other signed-in person. Off unless it is exactly "on".
 * - **KOYOMI_MCP_GOOGLE_PUBLIC=on** lets those people share Google calendars too. Off unless it is
 *   exactly "on"; until then a person let in by public access can share Microsoft, Yahoo and
 *   calendar links, and no Google calendar, at the consent page or ever after (read.ts). It means
 *   nothing while public access is off.
 *
 * KOYOMI_TEST_AI_PUBLIC_PREFIX treats the browser tests' stand-in people whose subject starts with
 * it as let in by public access, so both kinds of person can be tested on one server. Like the
 * allowlist's test prefix, it is ignored on any Vercel deployment.
 */
export function accessPolicy(env: Record<string, string | undefined> = process.env): (subject: string | null | undefined) => Access {
  const listed = allowlist(env);
  const open = on(env.KOYOMI_MCP_PUBLIC);
  const google = on(env.KOYOMI_MCP_GOOGLE_PUBLIC);
  const testPrefix = env.VERCEL ? '' : (env.KOYOMI_TEST_AI_PUBLIC_PREFIX?.trim() ?? '');
  return (subject) => {
    if (typeof subject !== 'string' || subject === '') return NOBODY;
    if (listed(subject)) return { allowed: true, google: true, via: 'allowlist' };
    if (open || (testPrefix !== '' && subject.startsWith(testPrefix))) return { allowed: true, google, via: 'public' };
    return NOBODY;
  };
}

export function aiConfig(): AiConfig | null {
  if (process.env.KOYOMI_MCP?.trim() !== 'on') return null;
  const connections = connectionsConfig();
  if (!connections) return null;
  const access = accessPolicy();
  return { connections, issuer: connections.appUrl, resource: `${connections.appUrl}/mcp`, access, allowed: (subject) => access(subject).allowed };
}

/**
 * A key of its own for each use, drawn from the sealing key (as `fingerprint()` draws its own),
 * so no two uses ever share one and there is no new secret to keep.
 */
export const keyFor = (config: AiConfig, use: 'access' | 'hash' | 'handle' | 'form' | 'successor' | 'limit') =>
  createHmac('sha256', Buffer.from(config.connections.tokenKey, 'hex')).update(`koyomi ai ${use} v1`).digest();

/** A keyed hash, for codes and refresh tokens: what is stored cannot be used, or turned back into what was issued. */
export const hashOf = (config: AiConfig, value: string) => createHmac('sha256', keyFor(config, 'hash')).update(value).digest('base64url');

/** Whether a request arrived at the app's own host, the only one these endpoints answer on. */
export const ownHost = (request: Request, config: AiConfig) => new URL(request.url).host === new URL(config.issuer).host;
