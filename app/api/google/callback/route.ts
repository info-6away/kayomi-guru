import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { OAUTH_COOKIE, forgetAccess, sealContext, storeFor } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { connectionsConfig } from '@/lib/server/env';
import { SCOPES, exchangeCode, revoke } from '@/lib/server/google';
import { seal } from '@/lib/server/seal';

export const dynamic = 'force-dynamic';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Where Google sends the visitor back. The code in the address is traded for tokens here, on
 * the server; the refresh token is sealed and stored, and the browser is sent home knowing only
 * how it went.
 */
export async function GET(request: Request) {
  const config = connectionsConfig();
  if (!config) return new Response(null, { status: 404 });
  const home = (outcome: string) => Response.redirect(`${config.appUrl}/?calendars=${outcome}`, 303);

  const url = new URL(request.url);
  const jar = await cookies();
  const [state, verifier] = (jar.get(OAUTH_COOKIE)?.value ?? '').split('.');
  jar.delete({ name: OAUTH_COOKIE, path: '/api/google' });

  // "Cancel" on Google's screen.
  if (url.searchParams.has('error')) return home('cancelled');
  const code = url.searchParams.get('code');
  const returned = url.searchParams.get('state');
  if (!code || !returned || !state || !verifier || !same(returned, state)) return home('failed');

  const user = await auth.getCurrentUser();
  if (!user) return home('failed');

  try {
    const tokens = await exchangeCode(config.google, code, verifier);
    // Google lets people untick individual permissions. Koyomi needs both, and keeps nothing
    // from a half-given consent: the grant is withdrawn again.
    const granted = new Set(tokens.scope.split(' '));
    if (!tokens.refreshToken || !SCOPES.every((scope) => granted.has(scope))) {
      await revoke(config.google, tokens.refreshToken ?? tokens.accessToken);
      return home('declined');
    }
    await storeFor(config).save(user.sub, 'google', seal(tokens.refreshToken, config.tokenKey, sealContext(user.sub)), tokens.scope);
    forgetAccess(user.sub);
    return home('connected');
  } catch (error) {
    console.error('[calendars] connecting failed:', error instanceof Error ? error.message : 'unknown');
    return home('failed');
  }
}
