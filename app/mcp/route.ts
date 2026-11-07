import { createMcpHandler } from '@modelcontextprotocol/server';
import { SCOPE, aiConfig, ownHost } from '@/lib/server/ai/config';
import { grantFor, originAllowed, unauthorized } from '@/lib/server/ai/context';
import { requestId, serverFor, type ToolLog } from '@/lib/server/ai/mcp';
import type { Grant } from '@/lib/server/ai/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The MCP endpoint (docs/MCP.md): https://app.koyomi.guru/mcp. Streamable HTTP, stateless: every
// request is authenticated on its own, served by a server made for it, and forgotten. Spec
// 2026-07-28 and the 2025 revisions are both answered here.

/** One line per request: what was done and how it went. Never a title, a name, a time or a token. */
function logLine(id: string, grant: Grant | null, started: number, entries: ToolLog[], status?: string) {
  const tools = entries.map((e) => `${e.tool}:${e.status}${e.calendars !== undefined ? `:c${e.calendars}` : ''}${e.events !== undefined ? `:e${e.events}` : ''}`).join(',');
  console.info(`[mcp] req=${id} grant=${grant ? grant.id.slice(0, 8) : '-'} ms=${Date.now() - started}${tools ? ` tools=${tools}` : ''}${status ? ` status=${status}` : ''}`);
}

const handler = createMcpHandler(({ authInfo }) => {
  const extra = authInfo?.extra as { config: NonNullable<ReturnType<typeof aiConfig>>; grant: Grant; log: (entry: ToolLog) => void } | undefined;
  // The route never calls the handler without a checked grant; this is the last word if it did.
  if (!extra) throw new Error('unauthenticated');
  return serverFor(extra.config, extra.grant, extra.log);
}, { responseMode: 'json', maxRequestBodySize: 64 * 1024 });

export async function POST(request: Request): Promise<Response> {
  const config = aiConfig();
  if (!config || !ownHost(request, config)) return new Response(null, { status: 404 });
  const id = requestId();
  const started = Date.now();
  if (!originAllowed(request.headers.get('origin'))) {
    logLine(id, null, started, [], 'origin');
    return new Response(null, { status: 403 });
  }
  const found = await grantFor(config, request);
  if (!found) {
    const presented = request.headers.has('authorization');
    logLine(id, null, started, [], presented ? 'invalid_token' : 'no_token');
    return unauthorized(config, presented);
  }
  const entries: ToolLog[] = [];
  const response = await handler.fetch(request, {
    authInfo: {
      token: found.token,
      clientId: found.grant.clientId,
      scopes: [SCOPE],
      expiresAt: found.expiresAt,
      resource: new URL(config.resource),
      extra: { config, grant: found.grant, log: (entry: ToolLog) => entries.push(entry) },
    },
  });
  logLine(id, found.grant, started, entries, String(response.status));
  return new Response(response.body, { status: response.status, headers: new Headers({ ...Object.fromEntries(response.headers), 'cache-control': 'no-store' }) });
}

/** No sessions and no server-sent stream to open: the modern protocol posts every message. */
const notAllowed = () => (aiConfig() ? new Response(null, { status: 405, headers: { allow: 'POST' } }) : new Response(null, { status: 404 }));
export const GET = notAllowed;
export const DELETE = notAllowed;
