import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { OAUTH_COOKIE, googleAccess, storeFor, type Ctx } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { connectionsConfig } from '@/lib/server/env';
import { authorizeUrl, pkce } from '@/lib/server/google';

export const dynamic = 'force-dynamic';

/**
 * "Connect" in Calendars leads here. Signs the visitor in with 6Away if they are not, then
 * hands them to Google's consent screen. Someone whose connection still works is sent straight
 * back: there is nothing to ask Google again.
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

  const ctx: Ctx = { config, store: storeFor(config), subject: user.sub };
  try {
    if (typeof (await googleAccess(ctx)) === 'string') return home('connected');
  } catch {
    // Google could not confirm it either way; asking for consent again is always safe.
  }

  const state = randomBytes(16).toString('base64url');
  const { verifier, challenge } = pkce();
  (await cookies()).set(OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    secure: config.appUrl.startsWith('https:'),
    sameSite: 'lax',
    path: '/api/google',
    maxAge: 600,
  });
  return Response.redirect(authorizeUrl(config.google, state, challenge), 303);
}
