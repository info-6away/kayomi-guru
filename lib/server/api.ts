import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { ApiError, Provider } from '../calendars/types';
import { auth } from './auth';
import { memoryStore, sealContext, sqlStore, type Allowance, type ConnectionStore, type Sql } from './connections';
import { connectionsConfig, type ConnectionsConfig } from './env';
import { report } from './log';
import { ProviderError, type CalendarProvider } from './provider';
import { providerFor } from './providers';
import { open, seal } from './seal';

// What every calendar route needs: who is asking, where their connections are kept, how much
// may be asked for each, and a way to answer that never lets a browser or a proxy keep a copy.
//
// Who is asking comes from the session cookie and from nowhere else. A person can have several
// connections, so a route is told which one by its id, but every look in the table is for that
// id among the signed-in person's own rows. An id that belongs to someone else finds nothing,
// exactly as one that never existed does.

/** What a route answers with. Plain data, so several waiting requests can share one. */
export interface Answer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export const respond = (answer: Answer) => Response.json(answer.body, { status: answer.status, headers: { 'cache-control': 'no-store', ...answer.headers } });
/** Only ever one of a fixed set of words: never a message, a stack or anything from a provider. */
export const no = (error: ApiError, status: number, headers?: Record<string, string>): Answer => ({ status, body: { error }, headers });

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
  koyomiWaiting?: Map<string, Promise<unknown>>;
  koyomiPaused?: Map<string, number>;
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

/**
 * The context for a request from a signed-in person, or the answer that says why there is none.
 * No session is not a lost connection: the person's rows are untouched, and signing in again
 * with the same 6Away identity finds them exactly as they were.
 */
export async function signedIn(): Promise<Ctx | Answer> {
  const config = connectionsConfig();
  if (!config) return no('unavailable', 404);
  const user = await auth.getCurrentUser();
  if (!user) return no('signed_out', 401);
  return { config, store: storeFor(config), subject: user.sub };
}
export const isAnswer = (value: Ctx | Answer): value is Answer => 'status' in value;

/** A browser attaches the page's origin to every POST, so one from another site is turned away. */
export const sameOrigin = (request: Request, config: ConnectionsConfig) => request.headers.get('origin') === config.appUrl;

/**
 * Holds one provider's consent round trip's sealed details for the few minutes it takes, on
 * that provider's own paths only. Page code cannot read it.
 */
export const oauthCookie = (provider: Provider) => ({ name: `koyomi_${provider}_oauth`, path: `/api/${provider}` });
export const OAUTH_COOKIE = oauthCookie('google').name;

const access = () => (shared.koyomiAccess ??= new Map());
export const forgetAccess = (connectionId: string) => access().delete(connectionId);

/**
 * What may be asked of a provider about one connected account through Koyomi: 120 units a
 * minute, where listing its calendars is one unit and reading events is one per calendar. The
 * app's own use is a few units at a time, some minutes apart. The count lives in the database,
 * in the connection's own row, so it is one count however many servers are answering, and one
 * account asked about too often does not hold back another.
 */
export const ALLOWANCE: Allowance = { units: 120, seconds: 60 };
/** However many calendars and pages a request involves, it gives up after this long. */
export const JOB_TIMEOUT_MS = 25_000;
/** How many accounts are listed at the same moment. How many calendars of one account are read at once is the provider's to say. */
export const AT_ONCE = 5;

/**
 * Runs `work` once for everyone asking for the same thing at the same moment: a second tab, a
 * double click, a retry while the first is still out. They wait for the one in flight and get
 * its answer, and the provider is asked once. (This saves work; the allowance above is the limit.)
 */
export function once<T>(key: string, work: () => Promise<T>): Promise<T> {
  const waiting = (shared.koyomiWaiting ??= new Map());
  const running = waiting.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = work().finally(() => waiting.delete(key));
  waiting.set(key, started);
  return started;
}

/** Runs `work` over `items`, a few at a time, keeping their order. Once one fails, nothing more is begun. */
export async function inTurn<T, R>(items: T[], width: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (next < items.length && !failed) {
      const i = next++;
      try {
        out[i] = await work(items[i]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
  return out;
}

/** What a reading came to: the data, or the one word for why there is none. */
export type Read<T> = { data: T } | { error: ApiError; retryAfter?: number };

const STATUS: Partial<Record<ApiError, number>> = { not_connected: 409, reconnect: 409, blocked: 409, slow_down: 429, busy: 503 };
/** A reading as a route's answer. */
export const answerOf = <T>(read: Read<T>): Answer =>
  'error' in read ? no(read.error, STATUS[read.error] ?? 503, read.retryAfter ? { 'retry-after': String(read.retryAfter) } : undefined) : { status: 200, body: read.data };

/** Marks the connection as needing the person, and says so. Only the provider refusing its token leads here. */
async function needsReconnect(ctx: Ctx, id: string): Promise<{ error: ApiError }> {
  forgetAccess(id);
  await ctx.store.setStatus(ctx.subject, id, 'reconnect').catch(() => {});
  return { error: 'reconnect' };
}

/** Until when a provider has asked for one connection to be left alone (`Retry-After`). */
const paused = () => (shared.koyomiPaused ??= new Map());

/**
 * A short-lived access token for one of this person's connections, and its provider, or the
 * word that says why not. The refresh token is opened here, used once, and goes no further: it
 * is never sent to a browser, never logged and never written anywhere unsealed. Where the
 * provider hands out a new refresh token with each use (Microsoft), the new one is sealed and
 * put in the old one's place. Access tokens are held in memory until they expire, each under
 * its own connection, and asked for once however many requests are waiting.
 *
 * @param cost What this read counts for against the account's allowance.
 */
async function accessFor(ctx: Ctx, id: string, cost: number): Promise<{ token: string; provider: CalendarProvider } | { error: ApiError; retryAfter?: number }> {
  const spent = await ctx.store.spend(ctx.subject, id, cost, ALLOWANCE);
  if (!spent) return { error: 'not_connected' };
  const { connection } = spent;
  if (!spent.allowed) return { error: 'slow_down', retryAfter: spent.retryAfter };
  if (connection.status === 'reconnect') return { error: 'reconnect' };
  // A connection made while this server was set up for its provider, and it no longer is.
  const provider = providerFor(ctx.config, connection.provider);
  if (!provider) return { error: 'busy' };
  // The provider asked for a pause, and it is not over: nothing is asked of it until it is.
  const until = paused().get(id) ?? 0;
  if (until > Date.now()) return { error: 'slow_down', retryAfter: Math.ceil((until - Date.now()) / 1000) };

  const held = access().get(id);
  if (held && held.until > Date.now()) return { token: held.token, provider };

  let refreshToken: string;
  try {
    refreshToken = open(connection.sealedToken, ctx.config.tokenKey, sealContext(connection));
  } catch {
    // Sealed with a key this server no longer has. It cannot be recovered, only replaced.
    return needsReconnect(ctx, id);
  }
  const token = await once(`${id}:token`, async () => {
    const fresh = await provider.refreshAccess(refreshToken);
    if (fresh.refreshToken && fresh.refreshToken !== refreshToken) {
      // Put in place of the one it was traded for, and only that one: if the person has
      // reconnected meanwhile, their new token stays. The old one still works for a while, so a
      // write that does not happen loses nothing.
      await ctx.store.renewToken(ctx.subject, id, connection.sealedToken, seal(fresh.refreshToken, ctx.config.tokenKey, sealContext(connection))).catch((error) => report('renewing', error));
    }
    access().set(id, { token: fresh.accessToken, until: Date.now() + (fresh.expiresIn - 60) * 1000 });
    return fresh.accessToken;
  });
  return { token, provider };
}

/**
 * Reads from a provider through one of this person's connections: checks that account's
 * allowance, gets a token, runs `work`, and turns anything that goes wrong into one quiet word.
 * What goes wrong for one connection is that connection's alone: nothing here touches another row.
 */
export async function reading<T>(ctx: Ctx, id: string, cost: number, work: (token: string, provider: CalendarProvider) => Promise<T>): Promise<Read<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      // A second attempt is the same reading, and is not counted again.
      const got = await accessFor(ctx, id, attempt ? 0 : cost);
      return 'token' in got ? { data: await work(got.token, got.provider) } : got;
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        report('reading', error);
        return { error: 'busy' };
      }
      if (error.kind === 'reconnect') return needsReconnect(ctx, id);
      if (error.kind === 'blocked') return { error: 'blocked' };
      if (error.kind === 'slow_down') {
        const seconds = error.retryAfter ?? 60;
        paused().set(id, Date.now() + seconds * 1000);
        return { error: 'slow_down', retryAfter: seconds };
      }
      // The access token was refused, not necessarily the permission. Once, at once, a new one is
      // asked for, and it is the refresh token's answer that says whether the person is needed.
      if (error.kind === 'expired') {
        forgetAccess(id);
        if (!attempt) continue;
      }
      return { error: 'busy' };
    }
  }
}
