import { cookies } from 'next/headers';
import { OAUTH_COOKIE, storeFor } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { connectionsConfig } from '@/lib/server/env';
import { FLOW_SECONDS, beginFlow } from '@/lib/server/flow';
import { authorizeUrl } from '@/lib/server/google';
import { report } from '@/lib/server/log';

export const dynamic = 'force-dynamic';

/**
 * "Add calendar account" and "Reconnect" in Calendars lead here. Signs the visitor in with
 * 6Away if they are not, then hands them to Google, which asks which account and then for its
 * consent. Whatever comes back is one account's connection: the others are not involved.
 *
 * There is one case with nothing to ask Google. A device that shows no account yet (a new
 * device, or one whose data was cleared) does not say `add`; if the person signing in turns out
 * to have accounts connected already, the device is sent back to read those. From then on its
 * button says `add`, and always goes to Google.
 *
 * Every redirect from here goes to an address built on the server: the app's own, 6Away's
 * sign-in on the app's own origin, or Google's consent screen. Nothing in the request chooses it.
 */
export async function GET(request: Request) {
  const config = connectionsConfig();
  if (!config) return new Response(null, { status: 404 });
  const home = (outcome: string) => Response.redirect(`${config.appUrl}/?calendars=${outcome}`, 303);
  const asked = new URL(request.url).searchParams;
  const add = asked.has('add');

  const user = await auth.getCurrentUser();
  if (!user) {
    // Back from signing in and still nobody: the session cookie was not kept. Stop, rather
    // than send them round again.
    if (asked.has('signed')) return home('failed');
    const back = `/api/google/connect?signed=1${add ? '&add=1' : ''}`;
    return Response.redirect(`${config.appUrl}/api/auth/signin?returnTo=${encodeURIComponent(back)}`, 303);
  }

  try {
    if (!add && (await storeFor(config).list(user.sub)).length) return home('connected');
  } catch (error) {
    // The table could not be asked. Said as the app says any failed attempt, not as a bare error page.
    report('connecting', error);
    return home('failed');
  }

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
