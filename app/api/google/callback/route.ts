import { cookies } from 'next/headers';
import { OAUTH_COOKIE, forgetAccess, sealContext, storeFor } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { connectionsConfig } from '@/lib/server/env';
import { finishFlow } from '@/lib/server/flow';
import { SCOPES, exchangeCode, revoke } from '@/lib/server/google';
import { report } from '@/lib/server/log';
import { seal } from '@/lib/server/seal';

export const dynamic = 'force-dynamic';

/**
 * Where Google sends the visitor back. The code in the address is traded for tokens here, on
 * the server; the refresh token is sealed and stored, and the browser is sent home knowing only
 * how it went: one of a few fixed words, to the app's own address.
 */
export async function GET(request: Request) {
  const config = connectionsConfig();
  if (!config) return new Response(null, { status: 404 });
  const home = (outcome: string) => Response.redirect(`${config.appUrl}/?calendars=${outcome}`, 303);

  const url = new URL(request.url);
  const jar = await cookies();
  const cookie = jar.get(OAUTH_COOKIE)?.value;
  // Used once: whatever happens next, this attempt cannot be presented a second time.
  jar.delete({ name: OAUTH_COOKIE, path: '/api/google' });

  // "Cancel" on Google's screen.
  if (url.searchParams.has('error')) return home('cancelled');

  // Honoured only for the browser that started it (the sealed cookie), for the state that was
  // sent, within ten minutes, and for the person who started it.
  const user = await auth.getCurrentUser();
  const flow = finishFlow(cookie, config.tokenKey, { state: url.searchParams.get('state'), subject: user?.sub ?? null });
  const code = url.searchParams.get('code');
  if (!flow || !code || !user) return home('failed');

  try {
    const tokens = await exchangeCode(config.google, code, flow.verifier);
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
    report('connecting', error);
    return home('failed');
  }
}
