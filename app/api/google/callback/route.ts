import { cookies } from 'next/headers';
import { OAUTH_COOKIE, forgetAccess, storeFor } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { accountKey, sealContext } from '@/lib/server/connections';
import { connectionsConfig } from '@/lib/server/env';
import { finishFlow } from '@/lib/server/flow';
import { SCOPES, exchangeCode, primaryCalendarId, revoke } from '@/lib/server/google';
import { report } from '@/lib/server/log';
import { seal } from '@/lib/server/seal';

export const dynamic = 'force-dynamic';

/**
 * Where Google sends the visitor back. The code in the address is traded for tokens here, on
 * the server; the refresh token is sealed and stored as the connection for the account that
 * gave it, and the browser is sent home knowing only how it went: one of a few fixed words, to
 * the app's own address. Any other account the person has connected is left exactly as it was.
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
    const store = storeFor(config);
    const tokens = await exchangeCode(config.google, code, flow.verifier);
    // Google lets people untick individual permissions. Koyomi needs both, and keeps nothing
    // from a half-given consent: the grant is withdrawn again.
    const granted = new Set(tokens.scope.split(' '));
    if (!tokens.refreshToken || !SCOPES.every((scope) => granted.has(scope))) {
      await revoke(config.google, tokens.refreshToken ?? tokens.accessToken);
      return home('declined');
    }

    // Which account this is decides which row it is: the same account again replaces its own
    // token, and another account becomes another row. Without knowing, there is nowhere to
    // keep the permission, so nothing is kept and the person is asked to try again.
    let account: string;
    try {
      account = await primaryCalendarId(config.google, tokens.accessToken);
    } catch {
      // Handing the permission back is right only when it cannot be one that is in use. At
      // Google, withdrawing it for an account ends every token of that account, and this may be
      // an account the person has already connected.
      if (!(await store.list(user.sub)).length) await revoke(config.google, tokens.refreshToken);
      return home('failed');
    }

    const connection = { subject: user.sub, provider: 'google' as const, accountKey: accountKey(config.tokenKey, user.sub, 'google', account) };
    const id = await store.save(connection.subject, connection.provider, connection.accountKey, seal(tokens.refreshToken, config.tokenKey, sealContext(connection)), tokens.scope);
    forgetAccess(id);
    return home('connected');
  } catch (error) {
    report('connecting', error);
    return home('failed');
  }
}
