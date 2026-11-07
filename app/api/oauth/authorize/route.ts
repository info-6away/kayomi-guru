import { NextResponse } from 'next/server';
import { auth } from '@/lib/server/auth';
import { aiConfig, ownHost } from '@/lib/server/ai/config';
import { checkRequest, consentCookie, sealPending } from '@/lib/server/ai/consent';
import { aiStoreFor } from '@/lib/server/ai/context';

export const dynamic = 'force-dynamic';

const testDocuments = () => (process.env.VERCEL ? null : process.env.KOYOMI_TEST_AI_CLIENT_ORIGIN?.trim() || null);

/** A plain page for a request Koyomi will not send back to anyone. */
function refusal(message: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Koyomi</title></head><body style="font-family:system-ui,sans-serif;max-width:32em;margin:15vh auto;padding:0 24px;line-height:1.6;color:#252421;background:#F5F1E8"><h1 style="font-weight:400;font-size:22px">Koyomi can’t continue</h1><p>${message}</p><p>Nothing was shared. You can close this page.</p></body></html>`;
  return new Response(html, { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/**
 * The authorization endpoint. Checks what the AI client asks, keeps it while the person signs in
 * with 6Away (if they are not already), and sends them to choose which calendars it may read.
 */
export async function GET(request: Request) {
  const config = aiConfig();
  if (!config || !ownHost(request, config)) return new Response(null, { status: 404 });
  const checked = await checkRequest(config, aiStoreFor(config), new URL(request.url).searchParams, testDocuments());
  if ('page' in checked) return refusal(checked.page);
  if ('redirect' in checked) return NextResponse.redirect(checked.redirect, 302);
  const signedIn = await auth.getCurrentUser();
  const next = signedIn ? '/ai/consent' : `/api/auth/signin?returnTo=${encodeURIComponent('/ai/consent')}`;
  const response = NextResponse.redirect(new URL(next, config.issuer), 303);
  response.cookies.set(consentCookie(sealPending(config, checked.ok)));
  response.headers.set('cache-control', 'no-store');
  return response;
}
