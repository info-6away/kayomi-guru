import { startConnecting } from '@/lib/server/connecting';
import { connectionsConfig } from '@/lib/server/env';
import { authorizeUrl } from '@/lib/server/microsoft';

export const dynamic = 'force-dynamic';

/**
 * "Add calendar account" (choosing Microsoft) and "Reconnect" on a Microsoft account lead here.
 * Signs the visitor in with 6Away if they are not, then hands them to Microsoft, which asks
 * which account and, if it does not already hold it, for its consent (lib/server/connecting.ts
 * says what is the same for every provider).
 */
export async function GET(request: Request) {
  const config = connectionsConfig();
  if (!config?.microsoft) return new Response(null, { status: 404 });
  const microsoft = config.microsoft;
  return startConnecting(request, config, 'microsoft', (flow, challenge) => authorizeUrl(microsoft, flow.state, challenge, flow.nonce));
}
