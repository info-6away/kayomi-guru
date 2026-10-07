import { failure, googleAccess, json, signedIn } from '@/lib/server/api';
import { listCalendars } from '@/lib/server/google';

export const dynamic = 'force-dynamic';

/** The calendars the connected Google account can see: id, name, and whether it is the person's own. */
export async function GET() {
  const ctx = await signedIn();
  if (ctx instanceof Response) return ctx;
  try {
    const token = await googleAccess(ctx);
    if (token instanceof Response) return token;
    return json({ calendars: await listCalendars(ctx.config.google, token) });
  } catch (error) {
    return failure(ctx, error);
  }
}
