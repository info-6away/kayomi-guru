import { register } from '@/lib/server/ai/clients';
import { aiConfig, ownHost } from '@/lib/server/ai/config';
import { aiStoreFor } from '@/lib/server/ai/context';

export const dynamic = 'force-dynamic';

const HEADERS = { 'cache-control': 'no-store', 'access-control-allow-origin': '*' };

/** Registrations one server instance takes a minute. Clients register once per connection; more is not a client. */
const PER_MINUTE = 60;
const shared = globalThis as typeof globalThis & { koyomiAiRegistrations?: { start: number; count: number } };

/** Dynamic client registration (RFC 7591), for clients that publish no metadata document. Public clients only. */
export async function POST(request: Request) {
  const config = aiConfig();
  if (!config || !ownHost(request, config)) return new Response(null, { status: 404 });
  const now = Date.now();
  const count = shared.koyomiAiRegistrations && shared.koyomiAiRegistrations.start > now - 60_000 ? shared.koyomiAiRegistrations : (shared.koyomiAiRegistrations = { start: now, count: 0 });
  if (++count.count > PER_MINUTE) return Response.json({ error: 'temporarily_unavailable' }, { status: 429, headers: { ...HEADERS, 'retry-after': '60' } });
  const text = await request.text().catch(() => '');
  if (text.length > 16 * 1024) return Response.json({ error: 'invalid_client_metadata', error_description: 'Too large' }, { status: 400, headers: HEADERS });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const registered = register(body);
  if ('error' in registered) return Response.json({ error: registered.error, error_description: registered.description }, { status: 400, headers: HEADERS });
  const store = aiStoreFor(config);
  // Registering is the only way records are added, so it is where old unused ones are cleared
  // (CLIENT_RETENTION). A failure to tidy never stops a registration.
  await store.pruneClients().catch((error: unknown) => console.warn(`[oauth] pruning failed: ${error instanceof Error ? error.name : 'unknown'}`));
  await store.saveClient(registered.client);
  return Response.json(registered.body, { status: 201, headers: HEADERS });
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' } });
