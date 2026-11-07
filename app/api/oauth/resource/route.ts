import { aiConfig, ownHost } from '@/lib/server/ai/config';
import { metadataResponse, protectedResource } from '@/lib/server/ai/metadata';

export const dynamic = 'force-dynamic';

/** Served at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp (next.config.ts). */
export function GET(request: Request) {
  const config = aiConfig();
  if (!config || !ownHost(request, config)) return new Response(null, { status: 404 });
  return metadataResponse(protectedResource(config));
}
