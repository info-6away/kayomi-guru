import { cookies } from 'next/headers';
import type { Provider } from '../calendars/types';
import { oauthCookie, storeFor } from './api';
import { auth } from './auth';
import type { ConnectionsConfig } from './env';
import { FLOW_SECONDS, beginFlow, finishFlow, type Flow } from './flow';
import { report } from './log';

// The two halves of adding an account, as far as they are the same for every provider: who is
// asking, where they are sent, the sealed cookie that carries the attempt, and the one word the
// browser is sent home with. What is said to the provider itself is the provider's own route's.

/**
 * Sends the browser home with how it went: one of a few fixed words, to the app's own address.
 * Google's words are as they have always been; another provider's say which one it was, so the
 * calendar can name it.
 */
export const homeFor = (config: ConnectionsConfig, provider: Provider) => (outcome: string) =>
  Response.redirect(`${config.appUrl}/?calendars=${outcome}${provider === 'google' ? '' : `&from=${provider}`}`, 303);

/**
 * "Add calendar account" and "Reconnect" lead here, by way of the provider's own connect route.
 * Signs the visitor in with 6Away if they are not, then hands them to the provider, which asks
 * which account and then for its consent. Whatever comes back is one account's connection: the
 * others are not involved.
 *
 * There is one case with nothing to ask the provider. A device that shows no account yet (a new
 * device, or one whose data was cleared) does not say `add`; if the person signing in turns out
 * to have accounts connected already at this provider, the device is sent back to read those.
 * From then on its button says `add`, and always goes to the provider. Accounts at another
 * provider are no reason not to go: this is the one the person chose.
 *
 * Every redirect from here goes to an address built on the server: the app's own, 6Away's
 * sign-in on the app's own origin, or the provider's consent screen. Nothing in the request chooses it.
 *
 * @param consent The provider's consent screen for this attempt.
 */
export async function startConnecting(request: Request, config: ConnectionsConfig, provider: Provider, consent: (flow: Flow, challenge: string) => string): Promise<Response> {
  const home = homeFor(config, provider);
  const asked = new URL(request.url).searchParams;
  const add = asked.has('add');

  const user = await auth.getCurrentUser();
  if (!user) {
    // Back from signing in and still nobody: the session cookie was not kept. Stop, rather
    // than send them round again.
    if (asked.has('signed')) return home('failed');
    const back = `/api/${provider}/connect?signed=1${add ? '&add=1' : ''}`;
    return Response.redirect(`${config.appUrl}/api/auth/signin?returnTo=${encodeURIComponent(back)}`, 303);
  }

  try {
    if (!add && (await storeFor(config).list(user.sub)).some((connection) => connection.provider === provider)) return home('connected');
  } catch (error) {
    // The table could not be asked. Said as the app says any failed attempt, not as a bare error page.
    report('connecting', error);
    return home('failed');
  }

  // A new attempt: fresh random state, nonce and PKCE secret, sealed with who is asking and for
  // which provider, in a cookie that page code cannot read. Lax, because the way back from the
  // provider is a link from another site, which a Strict cookie would not accompany.
  const { flow, challenge, cookie } = beginFlow(user.sub, config.tokenKey, Date.now(), provider);
  const { name, path } = oauthCookie(provider);
  (await cookies()).set(name, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path,
    maxAge: FLOW_SECONDS,
  });
  return Response.redirect(consent(flow, challenge), 303);
}

/**
 * The attempt a return from the provider belongs to, taken from its cookie, which is deleted
 * whatever happens next, so that the same return can never be presented a second time.
 * Honoured only for the browser that started it (the sealed cookie), for the state that was
 * sent, within ten minutes, for this provider, and for the person who started it.
 */
export async function takeFlow(request: Request, config: ConnectionsConfig, provider: Provider) {
  const url = new URL(request.url);
  const jar = await cookies();
  const { name, path } = oauthCookie(provider);
  const cookie = jar.get(name)?.value;
  jar.delete({ name, path });
  const user = await auth.getCurrentUser();
  const flow = finishFlow(cookie, config.tokenKey, { state: url.searchParams.get('state'), subject: user?.sub ?? null }, Date.now(), provider);
  return { url, user, flow };
}
