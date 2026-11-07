import { aiConfig, ownHost } from '@/lib/server/ai/config';
import { authorizationServer, metadataResponse } from '@/lib/server/ai/metadata';

export const dynamic = 'force-dynamic';

/** Served at /.well-known/oauth-authorization-server (next.config.ts). */
export function GET(request: Request) {
  const config = aiConfig();
  if (!config || !ownHost(request, config)) return new Response(null, { status: 404 });
  return metadataResponse(authorizationServer(config));
}
