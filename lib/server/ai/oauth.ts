import { hashOf, type AiConfig } from './config';
import type { AiStore } from './store';
import { REFRESH_SECONDS, issueAccess, pkceMatches, readAccess, secret, successorOf } from './tokens';
import { SCOPE } from './config';

// The token endpoint's two grants and the revocation endpoint (docs/MCP.md), apart from HTTP so
// that every refusal can be tested. Every refusal is OAuth's own word, never more.

export type TokenAnswer = { status: number; body: Record<string, unknown> };

const refuse = (error: string, description: string, status = 400): TokenAnswer => ({ status, body: { error, error_description: description } });

/** Said the same whether access was revoked or the person is not (or no longer) in the beta: nothing tells the client which. */
const ENDED = 'Access has been revoked';

/** A new access token, with `refresh`: a grant's first refresh token, or the successor of the one presented. */
async function issue(config: AiConfig, store: AiStore, grantId: string, clientId: string, now: number, refresh: string): Promise<TokenAnswer> {
  // Saving the successor again (a retry within the grace) keeps the one already saved. A request
  // at the same moment may have ended the grant (a spent token coming back): then nothing is issued.
  if (!(await store.saveRefresh(hashOf(config, refresh), grantId, now + REFRESH_SECONDS * 1000))) return refuse('invalid_grant', ENDED);
  const access = issueAccess(config, grantId, clientId, now);
  return { status: 200, body: { access_token: access.token, token_type: 'Bearer', expires_in: access.expiresIn, refresh_token: refresh, scope: SCOPE } };
}

/** A resource the client names must be Koyomi's MCP endpoint; naming none is the same. */
const resourceOk = (config: AiConfig, given: string | null) => given === null || given.replace(/\/$/, '') === config.resource;

/**
 * Redeems a code: once, before it expires, by the client it was issued to, at the redirect address
 * it was sent to, with the PKCE verifier its challenge was made from. A code used twice ends its
 * grant: whoever has it, the person did not mean for them to.
 */
export async function redeemCode(config: AiConfig, store: AiStore, form: URLSearchParams, now = Date.now()): Promise<TokenAnswer> {
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
  if (record.expiresAt <= now) return refuse('invalid_grant', 'The code has expired');
  if (record.clientId !== clientId) return refuse('invalid_grant', 'The code was issued to another client');
  if (form.get('redirect_uri') !== record.redirectUri) return refuse('invalid_grant', 'redirect_uri does not match the authorization request');
  if (!pkceMatches(form.get('code_verifier'), record.codeChallenge)) return refuse('invalid_grant', 'PKCE verification failed');
  const grant = await store.getGrant(record.grantId);
  if (!grant || grant.clientId !== clientId || !config.allowed(grant.subject)) return refuse('invalid_grant', ENDED);
  return issue(config, store, grant.id, clientId, now, secret('kr'));
}

/**
 * Trades a refresh token for a new pair. Each refresh token is replaced on first use, by its one
 * successor (successorOf). Within a few seconds of that (REFRESH_GRACE_SECONDS, at most
 * REFRESH_GRACE_REUSES more times) it is answered again, for a client that lost the first answer
 * or asked twice at once, with a new access token and the SAME successor: a copy replayed in the
 * grace cannot start a line of refresh tokens of its own. After that, a spent one coming back
 * ends the grant: someone has a copy.
 */
export async function refresh(config: AiConfig, store: AiStore, form: URLSearchParams, now = Date.now()): Promise<TokenAnswer> {
  const token = form.get('refresh_token');
  const clientId = form.get('client_id');
  if (!token || !clientId) return refuse('invalid_request', 'refresh_token and client_id are required');
  if (!resourceOk(config, form.get('resource'))) return refuse('invalid_target', 'Koyomi issues tokens only for its MCP endpoint');
  const taken = await store.takeRefresh(hashOf(config, token), now);
  if (!taken) return refuse('invalid_grant', 'The refresh token is not valid');
  if (taken.kind === 'replay') {
    await store.revokeGrant(taken.record.grantId);
    return refuse('invalid_grant', 'The refresh token has already been used');
  }
  if (taken.record.expiresAt <= now) return refuse('invalid_grant', 'The refresh token has expired');
  const grant = await store.getGrant(taken.record.grantId);
  if (!grant || !config.allowed(grant.subject)) return refuse('invalid_grant', ENDED);
  if (grant.clientId !== clientId) return refuse('invalid_grant', 'The refresh token was issued to another client');
  return issue(config, store, grant.id, clientId, now, successorOf(config, token));
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
