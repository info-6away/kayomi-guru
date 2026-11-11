import { register } from '@/lib/server/ai/clients';
import { aiConfig, ownHost } from '@/lib/server/ai/config';
import { aiStoreFor } from '@/lib/server/ai/context';
import { REGISTRATION_ALLOWANCE, REGISTRATION_SOURCE_ALLOWANCE, UNUSED_CLIENTS_CAP, limitKey, sourceOf } from '@/lib/server/ai/limits';

export const dynamic = 'force-dynamic';

const HEADERS = { 'cache-control': 'no-store', 'access-control-allow-origin': '*' };

const busy = (retryAfter: number) => Response.json({ error: 'temporarily_unavailable', error_description: 'Too many registrations just now. Try again later.' }, { status: 429, headers: { ...HEADERS, 'retry-after': String(retryAfter) } });

/**
 * Dynamic client registration (RFC 7591), for clients that publish no metadata document (Grok
 * registers once per connection). Public clients only. Limited before anything is read
 * (limits.ts): so many an hour from one source address, so many an hour from everywhere, and none
 * while too many registrations have never been used. Every limit is counted in the database,
 * across all servers. Clients known by a metadata document (ChatGPT, Claude) never come here.
 */
export async function POST(request: Request) {
  const config = aiConfig();
  if (!config || !ownHost(request, config)) return new Response(null, { status: 404 });
  const store = aiStoreFor(config);
  // The source: Vercel's own account of the client's address, never a header the client chose.
  // Where there is none to trust, every request is one source, which is only stricter.
  const source = sourceOf(request) ?? 'unknown';
  // Counted in the database; if it cannot be reached, nothing is registered (never unlimited).
  let limited: number | null;
  try {
    const fromSource = await store.spendLimit(limitKey(config, 'source', source), 1, REGISTRATION_SOURCE_ALLOWANCE);
    const overall = fromSource.allowed ? await store.spendLimit(limitKey(config, 'registrations', 'all'), 1, REGISTRATION_ALLOWANCE) : fromSource;
    limited = overall.allowed ? null : overall.retryAfter;
  } catch (error) {
    console.warn(`[oauth] registration limits unavailable: ${error instanceof Error ? error.name : 'unknown'}`);
    return Response.json({ error: 'temporarily_unavailable' }, { status: 503, headers: { ...HEADERS, 'retry-after': '60' } });
  }
  if (limited !== null) return busy(limited);

  const text = await request.text().catch(() => '');
  if (text.length > 16 * 1024) return Response.json({ error: 'invalid_client_metadata', error_description: 'Too large' }, { status: 400, headers: HEADERS });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const registered = register(body);
  if ('error' in registered) return Response.json({ error: registered.error, error_description: registered.description }, { status: 400, headers: HEADERS });
  // Registering is the only way records are added, so it is where old unused ones are cleared
  // (CLIENT_RETENTION), with limits whose window ended long ago. A failure to tidy never stops a
  // registration.
  await store.pruneClients().catch((error: unknown) => console.warn(`[oauth] pruning failed: ${error instanceof Error ? error.name : 'unknown'}`));
  await store.pruneLimits().catch((error: unknown) => console.warn(`[oauth] pruning limits failed: ${error instanceof Error ? error.name : 'unknown'}`));
  // A great many registrations that never went on to an authorization are not clients but noise:
  // take no more until tidying has made room.
  if ((await store.unusedClients()) >= UNUSED_CLIENTS_CAP) {
    console.warn('[oauth] registration refused: too many unused registrations');
    return busy(3600);
  }
  await store.saveClient(registered.client);
  return Response.json(registered.body, { status: 201, headers: HEADERS });
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' } });
