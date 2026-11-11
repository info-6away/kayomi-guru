import { isAnswer, no, respond, sameOrigin, signedIn } from '@/lib/server/api';
import { aiConfig } from '@/lib/server/ai/config';
import { aiStoreFor } from '@/lib/server/ai/context';
import { grantsToManage } from '@/lib/server/ai/manage';

export const dynamic = 'force-dynamic';

/**
 * Ends one of the person's AI connections, at once: its tokens stop working on the next request.
 * No calendar connection is touched; Google, Microsoft, Yahoo and calendar links stay as they are.
 */
export async function POST(request: Request) {
  const config = aiConfig();
  if (!config) return new Response(null, { status: 404 });
  const ctx = await signedIn();
  if (isAnswer(ctx)) return respond(ctx);
  // Ending one's own access is never refused: whoever still holds a grant may end it, wherever AI
  // access stands for them now. Anyone else finds nothing here.
  if (!(await grantsToManage(config, ctx.subject))) return new Response(null, { status: 404 });
  if (!sameOrigin(request, ctx.config)) return respond(no('bad_request', 403));
  const body = (await request.json().catch(() => null)) as { grantId?: unknown } | null;
  if (typeof body?.grantId !== 'string') return respond(no('bad_request', 400));
  const revoked = await aiStoreFor(config).revokeGrant(body.grantId, ctx.subject);
  return respond({ status: 200, body: { revoked } });
}
