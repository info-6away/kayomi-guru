import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { Sql } from '../connections';
import { SCOPE, type AiConfig } from './config';
import { memoryAiStore, sqlAiStore, type AiStore, type Grant } from './store';
import { readAccess } from './tokens';

const shared = globalThis as typeof globalThis & { koyomiAiStore?: { database: string; store: AiStore }; koyomiAiClientCalls?: Map<string, { start: number; count: number }> };

/** One store per server instance, beside the connections' own (api.ts). */
export function aiStoreFor(config: AiConfig): AiStore {
  const database = config.connections.database;
  if (shared.koyomiAiStore?.database !== database) {
    shared.koyomiAiStore = { database, store: database === 'memory' ? memoryAiStore() : sqlAiStore(neon(database) as unknown as Sql) };
  }
  return shared.koyomiAiStore.store;
}

/** Where a client learns how to get a token for the MCP endpoint (RFC 9728). */
export const resourceMetadataUrl = (config: AiConfig) => `${config.issuer}/.well-known/oauth-protected-resource/mcp`;

/** The answer to a request without a token Koyomi honours: how to get one (RFC 6750, RFC 9728). */
export function unauthorized(config: AiConfig, invalid: boolean): Response {
  const parts = [...(invalid ? ['error="invalid_token"', 'error_description="The access token is missing, expired, revoked or not for this server."'] : []), `resource_metadata="${resourceMetadataUrl(config)}"`, `scope="${SCOPE}"`];
  return new Response(JSON.stringify({ error: invalid ? 'invalid_token' : 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'www-authenticate': `Bearer ${parts.join(', ')}` },
  });
}

/**
 * The grant behind a request's bearer token, or null. The token must be Koyomi's, unexpired, for
 * this endpoint, and its grant must still be in force and belong to the client the token was
 * issued to. Only the Authorization header is read: never a query string, never a cookie.
 */
export async function grantFor(config: AiConfig, request: Request): Promise<{ grant: Grant; token: string; expiresAt: number } | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  if (!match) return null;
  const claims = readAccess(config, match[1]);
  if (!claims) return null;
  const grant = await aiStoreFor(config).getGrant(claims.g);
  if (!grant || grant.clientId !== claims.c) return null;
  return { grant, token: match[1], expiresAt: claims.e };
}

/** Tool calls one grant may make: a person asks a few questions a minute; an assistant in a loop is stopped here. */
export const GRANT_ALLOWANCE = { units: 30, seconds: 60 };
/** Tool calls one client may make on one server instance, across all its grants: a second line behind the first. */
const CLIENT_CALLS = 300;

/** Counts a tool call for a client on this instance. False once it has made too many this minute. */
export function clientMayCall(clientId: string, now = Date.now()): boolean {
  const calls = (shared.koyomiAiClientCalls ??= new Map());
  const held = calls.get(clientId);
  if (!held || held.start <= now - 60_000) {
    if (calls.size > 1000) calls.clear();
    calls.set(clientId, { start: now, count: 1 });
    return true;
  }
  held.count++;
  return held.count <= CLIENT_CALLS;
}

/** Whether a browser origin may call the MCP endpoint. Servers send none; a browser must be the AI client's own page, or a tool on this computer. */
export function originAllowed(origin: string | null): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
    if (url.protocol !== 'https:') return false;
    return ['claude.ai', 'chatgpt.com', 'grok.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}
