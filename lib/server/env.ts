import type { Provider } from '../calendars/types';
import { googleEndpoints, type GoogleClient } from './google';
import type { LinkConfig } from './link';
import { microsoftEndpoints, type MicrosoftClient } from './microsoft';
import { yahooClient, type YahooClient } from './yahoo';

// What calendar connections need from the server's environment. When any of it is missing the
// feature is simply off: the calendar itself needs none of this and never did. Each provider is
// on by its own settings, so Google can be offered without Microsoft, or the other way round.
// Yahoo has no client to register: it is on by one setting, `YAHOO_CALENDAR=on`.

/** Read by name at run time, so nothing here is baked into a build. */
const env = (name: string) => process.env[name]?.trim() || undefined;

/**
 * Stand-ins used by the browser tests: a fake Google, a fake Microsoft, a fake Yahoo, and a store
 * held in memory. A deployment on Vercel ignores all four, whatever its settings say.
 */
const testOnly = (name: string) => (env('VERCEL') ? undefined : env(name));

const SIGN_IN = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_AUTH_URL', 'AUTH_CLIENT_ID', 'AUTH_CLIENT_SECRET', 'SESSION_SECRET'];

/**
 * Whether the sign-in addresses (/api/auth/...) answer. Signing in needs nothing of Google's, so
 * it can be switched on, and checked, before a Google client exists. A session opens nothing by
 * itself: everything it could be used for is behind `connectionsConfig`.
 */
export const signInConfigured = () => SIGN_IN.every(env);

export interface ConnectionsConfig {
  /** This app's own origin, e.g. https://app.koyomi.guru. Every redirect is built from it. */
  appUrl: string;
  /** Null where this server is not set up to connect Google accounts. */
  google: GoogleClient | null;
  /** Null where this server is not set up to connect Microsoft accounts. */
  microsoft: MicrosoftClient | null;
  /** Null where this server is not set up to connect Yahoo accounts. */
  yahoo: YahooClient | null;
  /** Null where this server does not subscribe to calendar links. */
  link: LinkConfig | null;
  /** 64 hexadecimal characters: the key that seals provider tokens. */
  tokenKey: string;
  /** A Postgres connection string, or 'memory' in the browser tests. */
  database: string;
}

export function connectionsConfig(): ConnectionsConfig | null {
  const appUrl = env('NEXT_PUBLIC_APP_URL')?.replace(/\/+$/, '');
  const tokenKey = env('TOKEN_ENCRYPTION_KEY');
  // The tests' in-memory store wins over any database address, so a test run can never reach a
  // real database, even on a machine that has one set for some other project.
  const database = testOnly('KOYOMI_TEST_STORE') === 'memory' ? 'memory' : env('DATABASE_URL');
  // Signing in is part of connecting, so its settings are required as well.
  if (!appUrl || !tokenKey || !database || !signInConfigured()) return null;

  const googleId = env('GOOGLE_CALENDAR_CLIENT_ID');
  const googleSecret = env('GOOGLE_CALENDAR_CLIENT_SECRET');
  const google =
    googleId && googleSecret
      ? { clientId: googleId, clientSecret: googleSecret, redirectUri: `${appUrl}/api/google/callback`, endpoints: googleEndpoints(testOnly('KOYOMI_TEST_GOOGLE_URL')) }
      : null;
  const microsoftId = env('MICROSOFT_CALENDAR_CLIENT_ID');
  const microsoftSecret = env('MICROSOFT_CALENDAR_CLIENT_SECRET');
  const microsoft =
    microsoftId && microsoftSecret
      ? { clientId: microsoftId, clientSecret: microsoftSecret, redirectUri: `${appUrl}/api/microsoft/callback`, endpoints: microsoftEndpoints(testOnly('KOYOMI_TEST_MICROSOFT_URL')) }
      : null;
  const yahoo = env('YAHOO_CALENDAR') === 'on' ? yahooClient(testOnly('KOYOMI_TEST_YAHOO_URL')) : null;
  // Calendar links need no client of anyone's: only that they are switched on.
  const pace = Number(testOnly('KOYOMI_TEST_LINK_PACE_MS'));
  const link: LinkConfig | null =
    env('CALENDAR_LINKS') === 'on' ? { own: new URL(appUrl).hostname, test: testOnly('KOYOMI_TEST_LINK_ORIGIN') ?? null, paceMs: Number.isFinite(pace) && pace >= 0 ? pace : 10_000 } : null;
  if (!google && !microsoft && !yahoo && !link) return null;
  return { appUrl, google, microsoft, yahoo, link, tokenKey, database };
}

/** Which providers this server can connect, in the order they are offered. None: the feature is off. */
export function calendarProviders(): Provider[] {
  const config = connectionsConfig();
  if (!config) return [];
  return [...(config.google ? (['google'] as const) : []), ...(config.microsoft ? (['microsoft'] as const) : []), ...(config.yahoo ? (['yahoo'] as const) : []), ...(config.link ? (['link'] as const) : [])];
}

export const connectionsConfigured = () => connectionsConfig() !== null;
