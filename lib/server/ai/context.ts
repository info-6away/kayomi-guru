import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { Sql } from '../connections';
import { SCOPE, type AiConfig } from './config';
import { spendCallIn } from './limits';
import { memoryAiStore, sqlAiStore, type AiStore, type Grant } from './store';
import { readAccess } from './tokens';

const shared = globalThis as typeof globalThis & { koyomiAiStore?: { database: string; store: AiStore } };

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
 * this endpoint, and its grant must still be in force, belong to the client the token was issued
 * to, and be of a person AI access lets in (accessPolicy: taking someone off the allowlist, or
 * turning public access off, ends their access at once). Only the Authorization header is read:
 * never a query string, never a cookie.
 */
export async function grantFor(config: AiConfig, request: Request): Promise<{ grant: Grant; token: string; expiresAt: number } | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  if (!match) return null;
  const claims = readAccess(config, match[1]);
  if (!claims) return null;
  const grant = await aiStoreFor(config).getGrant(claims.g);
  if (!grant || grant.clientId !== claims.c || !config.allowed(grant.subject)) return null;
  return { grant, token: match[1], expiresAt: claims.e };
}

export { GRANT_ALLOWANCE } from './limits';

/** Counts one tool call against every limit it falls under, in this deployment's store (limits.ts, spendCallIn). */
export const spendCall = (config: AiConfig, grant: Grant) => spendCallIn(aiStoreFor(config), config, grant);

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
