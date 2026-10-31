import type { ApiError } from '@/lib/calendars/types';
import { JOB_TIMEOUT_MS, forgetAccess, isAnswer, no, respond, sameOrigin, signedIn, type Answer } from '@/lib/server/api';
import { accountKey, isConnectionId, sealContext, type Connection } from '@/lib/server/connections';
import { LinkError, canonicalLink, fetchLink, linkOf, type LinkFailure } from '@/lib/server/fetchlink';
import { MAX_LINKS, feedName, forgetPace, linkSecretOf, nameOf } from '@/lib/server/link';
import { report } from '@/lib/server/log';
import { open, seal } from '@/lib/server/seal';

export const dynamic = 'force-dynamic';

/** One person may try to add or update a link so many times in so long. */
const TRIES = 10;
const TRIES_MS = 10 * 60_000;
const tries = () => ((globalThis as typeof globalThis & { koyomiLinkTries?: Map<string, number[]> }).koyomiLinkTries ??= new Map<string, number[]>());

/** What each failure of a link comes to for the person: a word, never what the link's server said. */
const ANSWER: Record<LinkFailure, [ApiError, number]> = {
  bad_link: ['bad_link', 400],
  forbidden: ['bad_link', 400],
  refused: ['not_calendar', 422],
  not_calendar: ['not_calendar', 422],
  too_large: ['too_large', 413],
  slow_down: ['unreachable', 503],
  busy: ['unreachable', 503],
};

/**
 * Whether the form for a calendar link can be shown: the person must be signed in to Koyomi
 * first, since the calendar will belong to that sign-in.
 */
export async function GET() {
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  if (!ctx.config.link) return respond(no('unavailable', 404));
  return respond({ status: 200, body: { ok: true } });
}

/**
 * Subscribes to a calendar link, or puts a new link in place of one of the person's own
 * (`connectionId`), keeping that calendar's connection. The link arrives here once, in this
 * request's body, and is fetched before anything is kept: only a link that gives a calendar is
 * sealed and stored, and the old one is replaced only then. The link is never sent back, logged
 * or put in an error, and the answer is only ever `{ ok: true }` or one word.
 */
export async function POST(request: Request) {
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  const link = ctx.config.link;
  if (!link) return respond(no('unavailable', 404));
  if (!sameOrigin(request, ctx.config)) return respond(no('bad_request', 403));
  const body = (await request.json().catch(() => null)) as { link?: unknown; name?: unknown; connectionId?: unknown } | null;
  if (!body || typeof body !== 'object') return respond(no('bad_request', 400));

  // A handful of tries, then a wait: the form is not a way to have Koyomi fetch things.
  const now = Date.now();
  const recent = (tries().get(ctx.subject) ?? []).filter((at) => at > now - TRIES_MS);
  if (recent.length >= TRIES) return respond(no('slow_down', 429, { 'retry-after': String(Math.ceil((recent[0] + TRIES_MS - now) / 1000)) }));
  if (tries().size > 10_000) tries().clear();
  tries().set(ctx.subject, [...recent, now]);

  const url = linkOf(body.link, link.own, link.test);
  if (!url) return respond(no('bad_link', 400));
  const named = nameOf(body.name);
  const key = accountKey(ctx.config.tokenKey, ctx.subject, 'link', canonicalLink(url));

  let updating: Connection | null = null;
  if (body.connectionId !== undefined) {
    // Only one of the person's own calendar links can be given a new link.
    updating = isConnectionId(body.connectionId) ? await ctx.store.get(ctx.subject, body.connectionId) : null;
    if (!updating || updating.provider !== 'link') return respond(no('not_connected', 404));
  } else {
    const links = (await ctx.store.list(ctx.subject)).filter((connection) => connection.provider === 'link');
    // The same link again is the same calendar, and is not counted twice.
    if (links.length >= MAX_LINKS && !links.some((connection) => connection.accountKey === key)) return respond(no('too_many', 409));
  }

  // Fetched first, through the same checks as every reading: kept only if it gives a calendar.
  let fromFeed: string | null;
  try {
    const got = await fetchLink(url, { deadline: AbortSignal.timeout(JOB_TIMEOUT_MS), own: link.own, resolve: link.resolve, test: link.test });
    if (got.unchanged) throw new LinkError('not_calendar');
    try {
      fromFeed = feedName(got.text);
    } catch {
      throw new LinkError('not_calendar');
    }
  } catch (error) {
    const failure = error instanceof LinkError ? error.failure : 'busy';
    if (failure === 'forbidden') report('link', new Error('A calendar link that leads somewhere Koyomi does not fetch was refused'));
    else if (!(error instanceof LinkError)) report('link', error);
    const [word, status] = ANSWER[failure];
    return respond(no(word, status));
  }

  // The name the person gave; when updating, the name it had; otherwise the calendar's own.
  let kept: string | null = null;
  if (updating) {
    try {
      kept = linkSecretOf(open(updating.sealedToken, ctx.config.tokenKey, sealContext(updating))).name;
    } catch {
      // Sealed with a key this server no longer has: the calendar's own name will do.
    }
  }
  const name = named ?? kept ?? fromFeed ?? 'Calendar link';
  const sealed = seal(JSON.stringify({ url: url.href, name }), ctx.config.tokenKey, sealContext({ subject: ctx.subject, provider: 'link', accountKey: key }));

  let answer: Answer = { status: 200, body: { ok: true } };
  if (updating) {
    const done = await ctx.store.relink(ctx.subject, updating.id, key, sealed);
    if (done === 'taken') answer = no('taken', 409);
    else if (done === 'missing') answer = no('not_connected', 404);
    else {
      forgetAccess(updating.id);
      forgetPace(updating.id);
    }
  } else {
    forgetAccess(await ctx.store.save(ctx.subject, 'link', key, sealed, 'link'));
  }
  return respond(answer);
}
