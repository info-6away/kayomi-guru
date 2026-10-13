import { createHash } from 'node:crypto';
import { normalizeGoogleEvent } from '@/lib/calendars/normalize';
import type { CalendarResult, EventsRequest, EventsResponse } from '@/lib/calendars/types';
import { AT_ONCE, JOB_TIMEOUT_MS, answerOf, inTurn, isAnswer, no, once, reading, respond, sameOrigin, signedIn } from '@/lib/server/api';
import { isConnectionId } from '@/lib/server/connections';
import { GoogleError, listEvents } from '@/lib/server/google';

export const dynamic = 'force-dynamic';

const DAY_MS = 864e5;
/** The app reads 225 days at a time (lib/calendars/window.ts). A week more than that is the most anyone may ask for. */
const MAX_SPAN_DAYS = 232;
/** Calendars in one request. Someone showing more is asked for in batches. */
const MAX_CALENDARS = 25;

/** A calendar's name at its provider: printable, and not absurdly long. It is only ever used percent-encoded. */
const calendarId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

function parse(body: unknown): EventsRequest | null {
  const b = body as Partial<EventsRequest> | null;
  const from = Date.parse(String(b?.timeMin));
  const to = Date.parse(String(b?.timeMax));
  if (!b || !isConnectionId(b.connectionId)) return null;
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > MAX_SPAN_DAYS * DAY_MS) return null;
  if (!Array.isArray(b.calendars) || !b.calendars.length || b.calendars.length > MAX_CALENDARS) return null;
  const calendars = [];
  for (const c of b.calendars) {
    if (!calendarId(c?.calendarId)) return null;
    if (c.syncToken != null && (typeof c.syncToken !== 'string' || c.syncToken.length > 4096)) return null;
    calendars.push({ calendarId: c.calendarId, syncToken: c.syncToken ?? null });
  }
  return { connectionId: b.connectionId, timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), calendars };
}

/**
 * Events from one connected account: the calendars asked for, within the span asked for. For a
 * calendar that sends the cursor from its last answer, only what changed since; otherwise
 * everything in the span. Read from Google, reduced to what Koyomi shows, and passed on.
 * Nothing is kept here. The account must be one of the signed-in person's own.
 */
export async function POST(request: Request) {
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  if (!sameOrigin(request, ctx.config)) return respond(no('bad_request', 403));
  const asked = parse(await request.json().catch(() => null));
  if (!asked) return respond(no('bad_request', 400));

  // The same question from the same person at the same moment is answered once.
  const question = createHash('sha256').update(JSON.stringify(asked)).digest('base64url');
  const answer = await once(`${ctx.subject}:events:${question}`, async () =>
    answerOf(
      // One unit of the account's allowance for each calendar read.
      await reading(ctx, asked.connectionId, asked.calendars.length, async (token): Promise<EventsResponse> => {
        const deadline = AbortSignal.timeout(JOB_TIMEOUT_MS);
        const fetchedAt = new Date().toISOString();
        const span = { timeMin: asked.timeMin, timeMax: asked.timeMax };

        const read = async ({ calendarId, syncToken }: EventsRequest['calendars'][number]): Promise<CalendarResult> => {
          try {
            let full = !syncToken;
            const page = await listEvents(ctx.config.google, token, calendarId, span, syncToken, deadline).catch((error) => {
              // Google has let the cursor lapse: start over with everything in the span.
              if (!(error instanceof GoogleError && error.kind === 'gone' && syncToken)) throw error;
              full = true;
              return listEvents(ctx.config.google, token, calendarId, span, null, deadline);
            });
            const events = [];
            const removed = [];
            for (const item of page.items) {
              const event = normalizeGoogleEvent(item, asked.connectionId, calendarId, fetchedAt);
              if (event) events.push(event);
              else if (item.id) removed.push(item.id);
            }
            return { calendarId, full, events, removed: full ? [] : removed, syncToken: page.nextSyncToken };
          } catch (error) {
            if (error instanceof GoogleError && error.kind === 'not_found') return { calendarId, gone: true };
            throw error;
          }
        };

        return { calendars: await inTurn(asked.calendars, AT_ONCE, read) };
      }),
    ),
  );
  return respond(answer);
}
