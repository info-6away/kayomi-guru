import { aiConfig, ownHost } from '@/lib/server/ai/config';
import { aiStoreFor } from '@/lib/server/ai/context';
import { revokeToken } from '@/lib/server/ai/oauth';

export const dynamic = 'force-dynamic';

/** RFC 7009 revocation: an assistant ending its own access. Always 200, whatever there was to end. */
export async function POST(request: Request) {
  const config = aiConfig();
  if (!config || !ownHost(request, config)) return new Response(null, { status: 404 });
  const text = await request.text().catch(() => '');
  if (text.length <= 8192) await revokeToken(config, aiStoreFor(config), new URLSearchParams(text));
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
}
