import { startConnecting } from '@/lib/server/connecting';
import { connectionsConfig } from '@/lib/server/env';
import { authorizeUrl } from '@/lib/server/google';

export const dynamic = 'force-dynamic';

/**
 * "Add calendar account" (choosing Google) and "Reconnect" on a Google account lead here. Signs
 * the visitor in with 6Away if they are not, then hands them to Google, which asks which account
 * and then for its consent (lib/server/connecting.ts says what is the same for every provider).
 */
export async function GET(request: Request) {
  const config = connectionsConfig();
  if (!config?.google) return new Response(null, { status: 404 });
  const google = config.google;
  return startConnecting(request, config, 'google', (flow, challenge) => authorizeUrl(google, flow.state, challenge));
}
