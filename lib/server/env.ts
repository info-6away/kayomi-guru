import { googleEndpoints, type GoogleClient } from './google';

// What calendar connections need from the server's environment. When any of it is missing the
// feature is simply off: the calendar itself needs none of this and never did.

/** Read by name at run time, so nothing here is baked into a build. */
const env = (name: string) => process.env[name]?.trim() || undefined;

/**
 * Stand-ins used by the browser tests: a fake Google, and a store held in memory. A deployment
 * on Vercel ignores both, whatever its settings say.
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
  google: GoogleClient;
  /** 64 hexadecimal characters: the key that seals provider tokens. */
  tokenKey: string;
  /** A Postgres connection string, or 'memory' in the browser tests. */
  database: string;
}

export function connectionsConfig(): ConnectionsConfig | null {
  const appUrl = env('NEXT_PUBLIC_APP_URL')?.replace(/\/+$/, '');
  const clientId = env('GOOGLE_CALENDAR_CLIENT_ID');
  const clientSecret = env('GOOGLE_CALENDAR_CLIENT_SECRET');
  const tokenKey = env('TOKEN_ENCRYPTION_KEY');
  // The tests' in-memory store wins over any database address, so a test run can never reach a
  // real database, even on a machine that has one set for some other project.
  const database = testOnly('KOYOMI_TEST_STORE') === 'memory' ? 'memory' : env('DATABASE_URL');
  // Signing in is part of connecting, so its settings are required as well.
  if (!appUrl || !clientId || !clientSecret || !tokenKey || !database || !signInConfigured()) return null;
  return {
    appUrl,
    google: { clientId, clientSecret, redirectUri: `${appUrl}/api/google/callback`, endpoints: googleEndpoints(testOnly('KOYOMI_TEST_GOOGLE_URL')) },
    tokenKey,
    database,
  };
}

export const connectionsConfigured = () => connectionsConfig() !== null;
