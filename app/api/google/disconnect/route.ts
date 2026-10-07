import { fail, forgetAccess, json, sameOrigin, sealContext, signedIn } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { revoke } from '@/lib/server/google';
import { open } from '@/lib/server/seal';

export const dynamic = 'force-dynamic';

/**
 * Ends the connection: withdraws the permission at Google, deletes the stored token, and signs
 * this device out of Koyomi's server, since the connection was the only reason it was signed in.
 * The browser then removes its own copy of the events.
 */
export async function POST(request: Request) {
  const ctx = await signedIn();
  if (ctx instanceof Response) return ctx;
  if (!sameOrigin(request, ctx.config)) return fail('bad_request', 403);

  try {
    const connection = await ctx.store.get(ctx.subject, 'google');
    let revoked = false;
    if (connection) {
      try {
        revoked = await revoke(ctx.config.google, open(connection.sealedToken, ctx.config.tokenKey, sealContext(ctx.subject)));
      } catch {
        // A token that cannot be opened cannot be revoked either; removing the row is what is left.
      }
      await ctx.store.remove(ctx.subject, 'google');
    }
    forgetAccess(ctx.subject);
    await auth.destroySession();
    return json({ ok: true, revoked });
  } catch {
    return fail('busy', 503);
  }
}
