import type { CalendarsResponse, ConnectionListing, Provider } from '../calendars/types';
import { AT_ONCE, JOB_TIMEOUT_MS, inTurn, isAnswer, no, once, reading, respond, signedIn, type Answer, type Ctx } from './api';
import type { Connection } from './connections';
import { report } from './log';

/**
 * One account and the calendars it can see. Each account answers for itself, whichever provider
 * it is at: if this one cannot be read, that is said of this one, and nothing is said of the others.
 *
 * @returns null if the connection was ended while this was on its way.
 */
async function listing(ctx: Ctx, connection: Connection, deadline: AbortSignal): Promise<ConnectionListing | null> {
  const none = { connectionId: connection.id, provider: connection.provider, account: null, calendars: [] };
  // The provider has already refused this one. Nothing is asked of it until the person reconnects.
  if (connection.status === 'reconnect') return { ...none, state: 'reconnect' };
  const read = await reading(ctx, connection.id, 1, (token, provider) => provider.listCalendars(token, deadline));
  if ('error' in read) {
    if (read.error === 'not_connected') return null;
    return { ...none, state: read.error === 'reconnect' ? 'reconnect' : read.error === 'blocked' ? 'blocked' : 'busy' };
  }
  // The account's address is read with its calendars. It is passed on to the person's own
  // browser with the list it came in, and kept nowhere here.
  return { ...none, account: read.data.account, state: 'ok', calendars: read.data.calendars };
}

/**
 * Every account the signed-in person has connected, each with the calendars it can see: id,
 * name, and whether it is the account's own. Someone with nothing connected gets an empty list.
 *
 * @param only The accounts at this provider alone, for a copy of the app that knows no other.
 */
export async function listAccounts(only?: Provider): Promise<Response> {
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  const answer = await once(`${ctx.subject}:calendars:${only ?? 'all'}`, async (): Promise<Answer> => {
    try {
      const deadline = AbortSignal.timeout(JOB_TIMEOUT_MS);
      const connections = (await ctx.store.list(ctx.subject)).filter((connection) => !only || connection.provider === only);
      const listed = await inTurn(connections, AT_ONCE, (connection) => listing(ctx, connection, deadline));
      const body: CalendarsResponse = { connections: listed.filter((entry) => entry !== null) };
      return { status: 200, body };
    } catch (error) {
      report('listing', error);
      return no('busy', 503);
    }
  });
  return respond(answer);
}
