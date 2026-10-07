import { JOB_TIMEOUT_MS, isAnswer, once, reading, respond, signedIn } from '@/lib/server/api';
import { listCalendars } from '@/lib/server/google';

export const dynamic = 'force-dynamic';

/** The calendars the connected Google account can see: id, name, and whether it is the person's own. */
export async function GET() {
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  const answer = await once(`${ctx.subject}:calendars`, () =>
    reading(ctx, 1, async (token) => ({ status: 200, body: { calendars: await listCalendars(ctx.config.google, token, AbortSignal.timeout(JOB_TIMEOUT_MS)) } })),
  );
  return respond(answer);
}
