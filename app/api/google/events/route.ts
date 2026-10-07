import { normalizeGoogleEvent } from '@/lib/calendars/normalize';
import type { CalendarResult, EventsRequest, EventsResponse } from '@/lib/calendars/types';
import { fail, failure, googleAccess, json, sameOrigin, signedIn } from '@/lib/server/api';
import { GoogleError, listEvents } from '@/lib/server/google';

export const dynamic = 'force-dynamic';

const DAY_MS = 864e5;
/** Longer than any span the app asks for. A request for more is not from the app. */
const MAX_SPAN_DAYS = 400;
const MAX_CALENDARS = 50;

function parse(body: unknown): EventsRequest | null {
  const b = body as Partial<EventsRequest> | null;
  const from = Date.parse(String(b?.timeMin));
  const to = Date.parse(String(b?.timeMax));
  if (!b || Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > MAX_SPAN_DAYS * DAY_MS) return null;
  if (!Array.isArray(b.calendars) || b.calendars.length > MAX_CALENDARS) return null;
  const calendars = [];
  for (const c of b.calendars) {
    if (typeof c?.calendarId !== 'string' || !c.calendarId || c.calendarId.length > 1024) return null;
    if (c.syncToken != null && (typeof c.syncToken !== 'string' || c.syncToken.length > 4096)) return null;
    calendars.push({ calendarId: c.calendarId, syncToken: c.syncToken ?? null });
  }
  return { timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), calendars };
}

/**
 * Events from the calendars asked for, within the span asked for. For a calendar that sends
 * the cursor from its last answer, only what changed since; otherwise everything in the span.
 * Read from Google, reduced to what Koyomi shows, and passed on. Nothing is kept here.
 */
export async function POST(request: Request) {
  const ctx = await signedIn();
  if (ctx instanceof Response) return ctx;
  if (!sameOrigin(request, ctx.config)) return fail('bad_request', 403);
  const asked = parse(await request.json().catch(() => null));
  if (!asked) return fail('bad_request', 400);

  try {
    const token = await googleAccess(ctx);
    if (token instanceof Response) return token;
    const fetchedAt = new Date().toISOString();
    const span = { timeMin: asked.timeMin, timeMax: asked.timeMax };

    const read = async ({ calendarId, syncToken }: EventsRequest['calendars'][number]): Promise<CalendarResult> => {
      try {
        let full = !syncToken;
        const page = await listEvents(ctx.config.google, token, calendarId, span, syncToken).catch((error) => {
          // Google has let the cursor lapse: start over with everything in the span.
          if (!(error instanceof GoogleError && error.kind === 'gone' && syncToken)) throw error;
          full = true;
          return listEvents(ctx.config.google, token, calendarId, span, null);
        });
        const events = [];
        const removed = [];
        for (const item of page.items) {
          const event = normalizeGoogleEvent(item, calendarId, fetchedAt);
          if (event) events.push(event);
          else if (item.id) removed.push(item.id);
        }
        return { calendarId, full, events, removed: full ? [] : removed, syncToken: page.nextSyncToken };
      } catch (error) {
        if (error instanceof GoogleError && error.kind === 'not_found') return { calendarId, gone: true };
        throw error;
      }
    };

    const body: EventsResponse = { calendars: await Promise.all(asked.calendars.map(read)) };
    return json(body);
  } catch (error) {
    return failure(ctx, error);
  }
}
