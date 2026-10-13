import { forgetAccess, isAnswer, no, respond, sameOrigin, signedIn } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { isConnectionId, sealContext } from '@/lib/server/connections';
import { revoke } from '@/lib/server/google';
import { report } from '@/lib/server/log';
import { open } from '@/lib/server/seal';

export const dynamic = 'force-dynamic';

/**
 * Ends one connection: withdraws that account's permission at Google and deletes its stored
 * token. Any other account the person has connected is not touched. When the last one goes,
 * this device is signed out of Koyomi's server as well, since the connections were the only
 * reason it was signed in. The browser then removes its own copy of that account's events.
 *
 * This is the only thing that removes a connection. It acts on a row of the signed-in person's
 * own and no other, and only when asked from the app itself: a request from another site
 * arrives without the session cookie (SameSite) and with the wrong origin, and is refused on
 * both counts.
 */
export async function POST(request: Request) {
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  if (!sameOrigin(request, ctx.config)) return respond(no('bad_request', 403));
  const id = ((await request.json().catch(() => null)) as { connectionId?: unknown } | null)?.connectionId;
  if (!isConnectionId(id)) return respond(no('bad_request', 400));

  try {
    const connection = await ctx.store.get(ctx.subject, id);
    let revoked = false;
    if (connection) {
      try {
        revoked = await revoke(ctx.config.google, open(connection.sealedToken, ctx.config.tokenKey, sealContext(connection)));
      } catch {
        // A token that cannot be opened cannot be revoked either; removing the row is what is left.
      }
      await ctx.store.remove(ctx.subject, id);
      // Only for a connection that was this person's: an id that is someone else's touches nothing of theirs.
      forgetAccess(id);
    }
    const signedOut = !(await ctx.store.list(ctx.subject)).length;
    if (signedOut) await auth.destroySession();
    return respond({ status: 200, body: { ok: true, revoked, signedOut } });
  } catch (error) {
    report('disconnecting', error);
    return respond(no('busy', 503));
  }
}
