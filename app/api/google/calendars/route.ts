import type { CalendarsResponse, ConnectionListing } from '@/lib/calendars/types';
import { AT_ONCE, JOB_TIMEOUT_MS, inTurn, isAnswer, no, once, reading, respond, signedIn, type Answer, type Ctx } from '@/lib/server/api';
import type { Connection } from '@/lib/server/connections';
import { listCalendars } from '@/lib/server/google';
import { report } from '@/lib/server/log';

export const dynamic = 'force-dynamic';

/**
 * One account and the calendars it can see. Each account answers for itself: if this one
 * cannot be read, that is said of this one, and nothing is said of the others.
 *
 * @returns null if the connection was ended while this was on its way.
 */
async function listing(ctx: Ctx, connection: Connection, deadline: AbortSignal): Promise<ConnectionListing | null> {
  const none = { connectionId: connection.id, provider: connection.provider, account: null, calendars: [] };
  // Google has already refused this one. Nothing is asked of it until the person reconnects.
  if (connection.status === 'reconnect') return { ...none, state: 'reconnect' };
  const read = await reading(ctx, connection.id, 1, (token) => listCalendars(ctx.config.google, token, deadline));
  if ('error' in read) return read.error === 'not_connected' ? null : { ...none, state: read.error === 'reconnect' ? 'reconnect' : 'busy' };
  // The account is named by its own calendar, which for Google is its address. It is passed on
  // to the person's own browser with the list it came in, and kept nowhere here.
  return { ...none, account: read.data.find((calendar) => calendar.primary)?.calendarId ?? null, state: 'ok', calendars: read.data };
}

/**
 * Every account the signed-in person has connected, each with the calendars it can see: id,
 * name, and whether it is the account's own. Someone with nothing connected gets an empty list.
 */
export async function GET() {
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  const answer = await once(`${ctx.subject}:calendars`, async (): Promise<Answer> => {
    try {
      const deadline = AbortSignal.timeout(JOB_TIMEOUT_MS);
      const listed = await inTurn(await ctx.store.list(ctx.subject), AT_ONCE, (connection) => listing(ctx, connection, deadline));
      const body: CalendarsResponse = { connections: listed.filter((entry) => entry !== null) };
      return { status: 200, body };
    } catch (error) {
      report('listing', error);
      return no('busy', 503);
    }
  });
  return respond(answer);
}
