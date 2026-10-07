import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { ApiError } from '../calendars/types';
import { auth } from './auth';
import { memoryStore, sqlStore, type Allowance, type ConnectionStore, type Sql } from './connections';
import { connectionsConfig, type ConnectionsConfig } from './env';
import { GoogleError, refreshAccess } from './google';
import { report } from './log';
import { open } from './seal';

// What every calendar route needs: who is asking, where their connection is kept, how much they
// may ask for, and a way to answer that never lets a browser or a proxy keep a copy.
//
// Who is asking comes from the session cookie and from nowhere else. No route takes a person's
// id, or a connection's, from the address, the body or a header, so there is no way to name
// someone else's row.

/** What a route answers with. Plain data, so several waiting requests can share one. */
export interface Answer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export const respond = (answer: Answer) => Response.json(answer.body, { status: answer.status, headers: { 'cache-control': 'no-store', ...answer.headers } });
/** Only ever one of a fixed set of words: never a message, a stack or anything from Google. */
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
 * No session is not a lost connection: the person's row is untouched, and signing in again
 * with the same 6Away identity finds it exactly as it was.
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

/** Holds the consent round trip's sealed details for the few minutes it takes. Page code cannot read it. */
export const OAUTH_COOKIE = 'koyomi_google_oauth';

/** What a token's seal is tied to: it only opens on the row it was made for. */
export const sealContext = (subject: string) => `${subject}:google`;

const access = () => (shared.koyomiAccess ??= new Map());
export const forgetAccess = (subject: string) => access().delete(subject);

/**
 * What one person may ask of Google through Koyomi: 120 units a minute, where listing calendars
 * is one unit and reading events is one per calendar. The app's own use is a few units at a
 * time, some minutes apart. The count lives in the database, beside the connection, so it is
 * one count however many servers are answering.
 */
export const ALLOWANCE: Allowance = { units: 120, seconds: 60 };
/** However many calendars and pages a request involves, it gives up after this long. */
export const JOB_TIMEOUT_MS = 25_000;

/**
 * Runs `work` once for everyone asking for the same thing at the same moment: a second tab, a
 * double click, a retry while the first is still out. They wait for the one in flight and get
 * its answer, and Google is asked once. (This saves work; the allowance above is the limit.)
 */
export function once<T>(key: string, work: () => Promise<T>): Promise<T> {
  const waiting = (shared.koyomiWaiting ??= new Map());
  const running = waiting.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = work().finally(() => waiting.delete(key));
  waiting.set(key, started);
  return started;
}

/** Marks the connection as needing the person, and says so. Only Google refusing its token leads here. */
async function needsReconnect(ctx: Ctx): Promise<Answer> {
  forgetAccess(ctx.subject);
  await ctx.store.setStatus(ctx.subject, 'google', 'reconnect').catch(() => {});
  return no('reconnect', 409);
}

/**
 * A short-lived Google access token for this person, or the answer that says why not. The
 * refresh token is opened here, used once, and goes no further: it is never sent to a browser,
 * never logged and never written anywhere unsealed. Access tokens are held in memory until
 * they expire, and asked for once however many requests are waiting.
 *
 * @param cost What this read counts for against the person's allowance, or 0 to count nothing.
 */
async function accessFor(ctx: Ctx, cost: number): Promise<string | Answer> {
  const spent = cost ? await ctx.store.spend(ctx.subject, 'google', cost, ALLOWANCE) : null;
  const connection = spent ? spent.connection : await ctx.store.get(ctx.subject, 'google');
  if (!connection) return no('not_connected', 409);
  if (spent && !spent.allowed) return no('slow_down', 429, { 'retry-after': String(spent.retryAfter) });
  if (connection.status === 'reconnect') return no('reconnect', 409);

  const held = access().get(ctx.subject);
  if (held && held.until > Date.now()) return held.token;

  let refreshToken: string;
  try {
    refreshToken = open(connection.sealedToken, ctx.config.tokenKey, sealContext(ctx.subject));
  } catch {
    // Sealed with a key this server no longer has. It cannot be recovered, only replaced.
    return needsReconnect(ctx);
  }
  return once(`${ctx.subject}:token`, async () => {
    const { accessToken, expiresIn } = await refreshAccess(ctx.config.google, refreshToken);
    access().set(ctx.subject, { token: accessToken, until: Date.now() + (expiresIn - 60) * 1000 });
    return accessToken;
  });
}

/**
 * Reads from Google for this person: checks their allowance, gets a token, runs `work`, and
 * turns anything that goes wrong into a quiet answer.
 */
export async function reading(ctx: Ctx, cost: number, work: (token: string) => Promise<Answer>): Promise<Answer> {
  try {
    const token = await accessFor(ctx, cost);
    return typeof token === 'string' ? await work(token) : token;
  } catch (error) {
    if (error instanceof GoogleError && error.kind === 'reconnect') return needsReconnect(ctx);
    if (!(error instanceof GoogleError)) report('reading', error);
    return no('busy', 503);
  }
}

/** Whether this person's connection can be used right now, without counting it as a read. */
export async function works(ctx: Ctx): Promise<boolean> {
  try {
    return typeof (await accessFor(ctx, 0)) === 'string';
  } catch {
    return false;
  }
}
