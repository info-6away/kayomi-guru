import { hashOf, type AiConfig } from './config';
import type { AiStore } from './store';
import { REFRESH_SECONDS, issueAccess, pkceMatches, readAccess, secret } from './tokens';
import { SCOPE } from './config';

// The token endpoint's two grants and the revocation endpoint (docs/MCP.md), apart from HTTP so
// that every refusal can be tested. Every refusal is OAuth's own word, never more.

export type TokenAnswer = { status: number; body: Record<string, unknown> };

const refuse = (error: string, description: string, status = 400): TokenAnswer => ({ status, body: { error, error_description: description } });

async function issue(config: AiConfig, store: AiStore, grantId: string, clientId: string): Promise<TokenAnswer> {
  const access = issueAccess(config, grantId, clientId);
  const refresh = secret('kr');
  await store.saveRefresh(hashOf(config, refresh), grantId, Date.now() + REFRESH_SECONDS * 1000);
  return { status: 200, body: { access_token: access.token, token_type: 'Bearer', expires_in: access.expiresIn, refresh_token: refresh, scope: SCOPE } };
}

/** A resource the client names must be Koyomi's MCP endpoint; naming none is the same. */
const resourceOk = (config: AiConfig, given: string | null) => given === null || given.replace(/\/$/, '') === config.resource;

/**
 * Redeems a code: once, before it expires, by the client it was issued to, at the redirect address
 * it was sent to, with the PKCE verifier its challenge was made from. A code used twice ends its
 * grant: whoever has it, the person did not mean for them to.
 */
export async function redeemCode(config: AiConfig, store: AiStore, form: URLSearchParams): Promise<TokenAnswer> {
  const code = form.get('code');
  const clientId = form.get('client_id');
  if (!code || !clientId) return refuse('invalid_request', 'code and client_id are required');
  if (!resourceOk(config, form.get('resource'))) return refuse('invalid_target', 'Koyomi issues tokens only for its MCP endpoint');
  const taken = await store.takeCode(hashOf(config, code));
  if (!taken) return refuse('invalid_grant', 'The code is not valid');
  if (taken.replay) {
    await store.revokeGrant(taken.record.grantId);
    return refuse('invalid_grant', 'The code has already been used');
  }
  const record = taken.record;
  if (record.expiresAt <= Date.now()) return refuse('invalid_grant', 'The code has expired');
  if (record.clientId !== clientId) return refuse('invalid_grant', 'The code was issued to another client');
  if (form.get('redirect_uri') !== record.redirectUri) return refuse('invalid_grant', 'redirect_uri does not match the authorization request');
  if (!pkceMatches(form.get('code_verifier'), record.codeChallenge)) return refuse('invalid_grant', 'PKCE verification failed');
  const grant = await store.getGrant(record.grantId);
  if (!grant || grant.clientId !== clientId) return refuse('invalid_grant', 'Access has been revoked');
  return issue(config, store, grant.id, clientId);
}

/**
 * Trades a refresh token for a new pair. Each refresh token works once: the old one is spent as the
 * new one is issued, and a spent one coming back ends the grant (someone has a copy).
 */
export async function refresh(config: AiConfig, store: AiStore, form: URLSearchParams): Promise<TokenAnswer> {
  const token = form.get('refresh_token');
  const clientId = form.get('client_id');
  if (!token || !clientId) return refuse('invalid_request', 'refresh_token and client_id are required');
  if (!resourceOk(config, form.get('resource'))) return refuse('invalid_target', 'Koyomi issues tokens only for its MCP endpoint');
  const taken = await store.takeRefresh(hashOf(config, token));
  if (!taken) return refuse('invalid_grant', 'The refresh token is not valid');
  if (taken.replay) {
    await store.revokeGrant(taken.record.grantId);
    return refuse('invalid_grant', 'The refresh token has already been used');
  }
  if (taken.record.expiresAt <= Date.now()) return refuse('invalid_grant', 'The refresh token has expired');
  const grant = await store.getGrant(taken.record.grantId);
  if (!grant) return refuse('invalid_grant', 'Access has been revoked');
  if (grant.clientId !== clientId) return refuse('invalid_grant', 'The refresh token was issued to another client');
  return issue(config, store, grant.id, clientId);
}

/** RFC 7009: ends the grant a token belongs to. Says nothing either way about whether there was one. */
export async function revokeToken(config: AiConfig, store: AiStore, form: URLSearchParams): Promise<void> {
  const token = form.get('token');
  if (!token || token.length > 2048) return;
  const clientId = form.get('client_id');
  const grantId = token.startsWith('ka1.') ? readAccess(config, token)?.g : await store.refreshGrant(hashOf(config, token));
  if (!grantId) return;
  const grant = await store.getGrant(grantId);
  // A client may end its own access, and nobody else's.
  if (!grant || (clientId !== null && grant.clientId !== clientId)) return;
  await store.revokeGrant(grant.id);
}
