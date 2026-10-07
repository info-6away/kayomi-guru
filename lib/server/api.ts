import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { ApiError } from '../calendars/types';
import { auth } from './auth';
import { memoryStore, sqlStore, type ConnectionStore, type Sql } from './connections';
import { connectionsConfig, type ConnectionsConfig } from './env';
import { GoogleError, refreshAccess } from './google';
import { open } from './seal';

// What every calendar route needs: who is asking, where their connection is kept, and a way
// to answer that never lets a browser or a proxy keep a copy.

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export const fail = (error: ApiError, status: number) => json({ error }, status);

export interface Ctx {
  config: ConnectionsConfig;
  store: ConnectionStore;
  /** The signed-in person: their 6Away Auth subject. */
  subject: string;
}

// One per server instance, kept on the global object so every route shares them.
const shared = globalThis as typeof globalThis & {
  koyomiStore?: { database: string; store: ConnectionStore };
  koyomiAccess?: Map<string, { token: string; until: number }>;
};

export function storeFor(config: ConnectionsConfig): ConnectionStore {
  if (shared.koyomiStore?.database !== config.database) {
    shared.koyomiStore = {
      database: config.database,
      store: config.database === 'memory' ? memoryStore() : sqlStore(neon(config.database) as unknown as Sql),
    };
  }
  return shared.koyomiStore.store;
}

/** The context for a request from a signed-in person, or the response that says why there is none. */
export async function signedIn(): Promise<Ctx | Response> {
  const config = connectionsConfig();
  if (!config) return fail('unavailable', 404);
  const user = await auth.getCurrentUser();
  if (!user) return fail('signed_out', 401);
  return { config, store: storeFor(config), subject: user.sub };
}

/** A browser attaches the page's origin to every POST, so one from another site is turned away. */
export const sameOrigin = (request: Request, config: ConnectionsConfig) => request.headers.get('origin') === config.appUrl;

/** Holds the consent round trip's two secrets for the few minutes it takes. Page code cannot read it. */
export const OAUTH_COOKIE = 'koyomi_google_oauth';

/** What a token's seal is tied to: it only opens on the row it was made for. */
export const sealContext = (subject: string) => `${subject}:google`;

const access = () => (shared.koyomiAccess ??= new Map());
export const forgetAccess = (subject: string) => access().delete(subject);

/** Marks the connection as needing the person, and says so. */
export async function needsReconnect(ctx: Ctx): Promise<Response> {
  forgetAccess(ctx.subject);
  await ctx.store.setStatus(ctx.subject, 'google', 'reconnect').catch(() => {});
  return fail('reconnect', 409);
}

/** Turns whatever went wrong while talking to Google or the database into a quiet answer. */
export function failure(ctx: Ctx, error: unknown): Promise<Response> | Response {
  if (error instanceof GoogleError && error.kind === 'reconnect') return needsReconnect(ctx);
  if (!(error instanceof GoogleError)) console.error('[calendars]', error instanceof Error ? error.message : 'request failed');
  return fail('busy', 503);
}

/**
 * A short-lived Google access token for this person, or the response that says why not.
 * The refresh token is opened here, used once, and goes no further: it is never sent to a
 * browser and never written anywhere unsealed. Access tokens are held in memory until they
 * expire, so a burst of requests does not ask Google for a new one each time.
 */
export async function googleAccess(ctx: Ctx): Promise<string | Response> {
  const connection = await ctx.store.get(ctx.subject, 'google');
  if (!connection) return fail('not_connected', 409);
  if (connection.status === 'reconnect') return fail('reconnect', 409);

  const held = access().get(ctx.subject);
  if (held && held.until > Date.now()) return held.token;

  let refreshToken: string;
  try {
    refreshToken = open(connection.sealedToken, ctx.config.tokenKey, sealContext(ctx.subject));
  } catch {
    // Sealed with a key this server no longer has. It cannot be recovered, only replaced.
    return needsReconnect(ctx);
  }
  const { accessToken, expiresIn } = await refreshAccess(ctx.config.google, refreshToken);
  access().set(ctx.subject, { token: accessToken, until: Date.now() + (expiresIn - 60) * 1000 });
  return accessToken;
}
