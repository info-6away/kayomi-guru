import { isAnswer, no, respond, sameOrigin, signedIn } from '@/lib/server/api';
import { aiConfig } from '@/lib/server/ai/config';
import { aiStoreFor } from '@/lib/server/ai/context';
import { calendarFingerprint } from '@/lib/server/ai/read';
import { isConnectionId } from '@/lib/server/connections';

export const dynamic = 'force-dynamic';

/**
 * The signed-in person's AI connections, for Calendars (docs/MCP.md). The page sends the
 * calendars it already knows; each grant's are matched against them by their keyed hash, so the
 * page can name them from its own copy and nothing is asked of any provider.
 */
export async function POST(request: Request) {
  const config = aiConfig();
  if (!config) return new Response(null, { status: 404 });
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  if (!sameOrigin(request, ctx.config)) return respond(no('bad_request', 403));
  const body = (await request.json().catch(() => null)) as { calendars?: unknown } | null;
  const known = Array.isArray(body?.calendars) ? body.calendars.slice(0, 500) : [];
  const byPrint = new Map<string, { connectionId: string; calendarId: string }>();
  for (const each of known as { connectionId?: unknown; calendarId?: unknown }[]) {
    if (!isConnectionId(each?.connectionId) || typeof each.calendarId !== 'string' || each.calendarId.length > 256) continue;
    byPrint.set(`${each.connectionId}\n${calendarFingerprint(config, each.connectionId, each.calendarId)}`, { connectionId: each.connectionId, calendarId: each.calendarId });
  }
  const grants = await aiStoreFor(config).listGrants(ctx.subject);
  // In the memory store a grant can outlive a disconnected account; the database removes those.
  const own = new Set((await ctx.store.list(ctx.subject)).map((c) => c.id));
  return respond({
    status: 200,
    body: {
      endpoint: config.resource,
      grants: grants.map((grant) => {
        const calendars = grant.calendars.filter((c) => own.has(c.connectionId));
        const named = calendars.map((c) => byPrint.get(`${c.connectionId}\n${c.fingerprint}`)).filter((c) => c !== undefined);
        return { id: grant.id, label: grant.clientLabel, host: grant.redirectHost, createdAt: grant.createdAt, lastUsedAt: grant.lastUsedAt, calendars: named, unnamed: calendars.length - named.length };
      }),
    },
  });
}
