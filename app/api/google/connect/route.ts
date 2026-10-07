import { cookies } from 'next/headers';
import { OAUTH_COOKIE, storeFor, works } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { connectionsConfig } from '@/lib/server/env';
import { FLOW_SECONDS, beginFlow } from '@/lib/server/flow';
import { authorizeUrl } from '@/lib/server/google';

export const dynamic = 'force-dynamic';

/**
 * "Connect" and "Reconnect" in Calendars lead here. Signs the visitor in with 6Away if they are
 * not, then hands them to Google's consent screen. Someone whose connection still works is sent
 * straight back: there is nothing to ask Google again.
 *
 * Every redirect from here goes to an address built on the server: the app's own, 6Away's
 * sign-in on the app's own origin, or Google's consent screen. Nothing in the request chooses it.
 */
export async function GET(request: Request) {
  const config = connectionsConfig();
  if (!config) return new Response(null, { status: 404 });
  const home = (outcome: string) => Response.redirect(`${config.appUrl}/?calendars=${outcome}`, 303);

  const user = await auth.getCurrentUser();
  if (!user) {
    // Back from signing in and still nobody: the session cookie was not kept. Stop, rather
    // than send them round again.
    if (new URL(request.url).searchParams.has('signed')) return home('failed');
    return Response.redirect(`${config.appUrl}/api/auth/signin?returnTo=${encodeURIComponent('/api/google/connect?signed=1')}`, 303);
  }

  if (await works({ config, store: storeFor(config), subject: user.sub })) return home('connected');

  // A new attempt: fresh random state and PKCE secret, sealed with who is asking, in a cookie
  // that page code cannot read. Lax, because the way back from Google is a link from another
  // site, which a Strict cookie would not accompany.
  const { flow, challenge, cookie } = beginFlow(user.sub, config.tokenKey);
  (await cookies()).set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/google',
    maxAge: FLOW_SECONDS,
  });
  return Response.redirect(authorizeUrl(config.google, flow.state, challenge), 303);
}
