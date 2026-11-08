import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { storeFor } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { aiConfig, hashOf, ownHost } from '@/lib/server/ai/config';
import { CONSENT_COOKIE, back, consentCookie, formTokenMatches, openPending } from '@/lib/server/ai/consent';
import { aiStoreFor } from '@/lib/server/ai/context';
import { calendarFingerprint } from '@/lib/server/ai/read';
import { isZone } from '@/lib/server/ai/time';
import { CODE_SECONDS, secret } from '@/lib/server/ai/tokens';
import { isConnectionId } from '@/lib/server/connections';

export const dynamic = 'force-dynamic';

const MAX_CALENDARS = 200;

/** A chosen calendar as the form sends it: [connection id, calendar id]. */
function chosen(value: FormDataEntryValue): { connectionId: string; calendarId: string } | null {
  if (typeof value !== 'string' || value.length > 600) return null;
  try {
    const [connectionId, calendarId] = JSON.parse(value);
    if (!isConnectionId(connectionId) || typeof calendarId !== 'string' || !calendarId || calendarId.length > 256 || /[\u0000-\u001f\u007f]/.test(calendarId)) return null;
    return { connectionId, calendarId };
  } catch {
    return null;
  }
}

/**
 * The person's answer to the consent page. Accepted only from this site, from the person who was
 * shown the question, for the request it was about, once. Allowing creates the grant (ending any
 * earlier one of the same assistant) and sends a one-time code back to the assistant; cancelling
 * sends it nothing but the refusal.
 */
export async function POST(request: Request) {
  const config = aiConfig();
  if (!config || !ownHost(request, config)) return new Response(null, { status: 404 });
  if (request.headers.get('origin') !== config.issuer) return new Response(null, { status: 403 });
  const jar = await cookies();
  const pending = openPending(config, jar.get(CONSENT_COOKIE)?.value);
  const user = await auth.getCurrentUser();
  const form = await request.formData().catch(() => null);
  // Outside the private beta's allowlist there is nothing here.
  if (user && !config.allowed(user.sub)) return new Response(null, { status: 404 });
  if (!pending || !user || !form || !formTokenMatches(config, pending, user.sub, form.get('form'))) {
    return new Response('This request has ended. Go back to the assistant and connect Koyomi again.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }

  const done = (location: string) => {
    const response = NextResponse.redirect(location, 303);
    response.cookies.set(consentCookie('', 0));
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  if (form.get('action') !== 'allow') return done(back(config, pending.redirectUri, { error: 'access_denied', error_description: 'The person did not allow access', state: pending.state }));

  const picked = form.getAll('calendar').slice(0, MAX_CALENDARS).map(chosen);
  if (!picked.length || picked.some((each) => each === null)) return NextResponse.redirect(new URL('/ai/consent', config.issuer), 303);
  // Only the person's own connections; the store checks this again. Each calendar is tied to the
  // account its connection is for now, the one the person was shown.
  const own = new Map((await storeFor(config.connections).list(user.sub)).map((c) => [c.id, c]));
  const calendars = picked
    .filter((each): each is NonNullable<typeof each> => each !== null && own.has(each.connectionId))
    .map((each) => ({ connectionId: each.connectionId, fingerprint: calendarFingerprint(config, own.get(each.connectionId)!, each.calendarId) }));
  if (!calendars.length) return NextResponse.redirect(new URL('/ai/consent', config.issuer), 303);

  const zone = form.get('timezone');
  const store = aiStoreFor(config);
  const grantId = await store.createGrant({
    subject: user.sub,
    clientId: pending.clientId,
    clientLabel: pending.label,
    redirectHost: pending.host,
    timeZone: isZone(zone) ? zone : 'UTC',
    calendars,
  });
  const code = secret('kc');
  await store.saveCode(hashOf(config, code), {
    grantId,
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
    resource: pending.resource,
    expiresAt: Date.now() + CODE_SECONDS * 1000,
  });
  return done(back(config, pending.redirectUri, { code, state: pending.state }));
}
