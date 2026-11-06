import { JOB_TIMEOUT_MS, forgetAccess, isAnswer, no, respond, sameOrigin, signedIn } from '@/lib/server/api';
import { accountKey, sealContext } from '@/lib/server/connections';
import { report } from '@/lib/server/log';
import { seal } from '@/lib/server/seal';
import { YahooError, appPasswordOf, discover, isYahooEmail, type YahooCredential } from '@/lib/server/yahoo';

export const dynamic = 'force-dynamic';

// Connecting a Yahoo account. There is no consent screen to send anyone to: the person makes an
// app password for Koyomi at Yahoo, and gives it here with their Yahoo email. It is checked
// against Yahoo's own server at once, and kept only if Yahoo takes it: sealed, with the account's
// row, and never sent back to any browser, written to the log, or kept anywhere else.

/** How many tries one person may make in a window: Koyomi is not a way to guess at Yahoo passwords. */
const TRIES = 5;
const WINDOW_MS = 10 * 60_000;
const shared = globalThis as typeof globalThis & { koyomiYahooTries?: Map<string, number[]> };
function tryNow(subject: string): number | null {
  const tries = (shared.koyomiYahooTries ??= new Map<string, number[]>());
  const now = Date.now();
  const recent = (tries.get(subject) ?? []).filter((at) => at > now - WINDOW_MS);
  if (recent.length >= TRIES) return Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
  tries.set(subject, [...recent, now]);
  return null;
}

/** Whether this device's Koyomi sign-in is still good: what the Yahoo form is shown after. Nothing is asked of Yahoo. */
export async function GET() {
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  if (!ctx.config.yahoo) return respond(no('unavailable', 404));
  return respond({ status: 200, body: { ok: true } });
}

/**
 * Connects a Yahoo account from its email and an app password, or reconnects the one it already
 * is (the same account is the same row, so its connection keeps its id). Only from the app
 * itself, for the signed-in person, as JSON in the request body.
 */
export async function POST(request: Request) {
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  const yahoo = ctx.config.yahoo;
  if (!yahoo) return respond(no('unavailable', 404));
  if (!sameOrigin(request, ctx.config)) return respond(no('bad_request', 403));

  const body = (await request.json().catch(() => null)) as { email?: unknown; appPassword?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;
  const password = appPasswordOf(body?.appPassword);
  if (!isYahooEmail(email) || !password) return respond(no('bad_request', 400));
  const wait = tryNow(ctx.subject);
  if (wait !== null) return respond(no('slow_down', 429, { 'retry-after': String(wait) }));

  try {
    // Who the email and password sign in as, and where that account's calendars are. Nothing is
    // kept until Yahoo has said yes to both.
    const found = await discover(yahoo, { email, password }, AbortSignal.timeout(JOB_TIMEOUT_MS));
    const credential: YahooCredential = { email, password, principal: found.principal, home: found.home };
    const connection = { subject: ctx.subject, provider: 'yahoo' as const, accountKey: accountKey(ctx.config.tokenKey, ctx.subject, 'yahoo', found.principal) };
    const id = await ctx.store.save(connection.subject, connection.provider, connection.accountKey, seal(JSON.stringify(credential), ctx.config.tokenKey, sealContext(connection)), 'caldav read');
    forgetAccess(id);
    return respond({ status: 200, body: { ok: true } });
  } catch (error) {
    if (error instanceof YahooError) {
      // Yahoo would not take this email and password together. Said as one word, never with Yahoo's own.
      if (error.kind === 'reconnect') return respond(no('refused', 422));
      if (error.kind === 'blocked') return respond(no('blocked', 409));
      if (error.kind === 'slow_down') return respond(no('slow_down', 429, error.retryAfter ? { 'retry-after': String(error.retryAfter) } : undefined));
      return respond(no('busy', 503));
    }
    report('connecting', error);
    return respond(no('busy', 503));
  }
}
