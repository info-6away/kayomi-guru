import { aiConfig, ownHost } from '@/lib/server/ai/config';
import { aiStoreFor } from '@/lib/server/ai/context';
import { redeemCode, refresh } from '@/lib/server/ai/oauth';

export const dynamic = 'force-dynamic';

const HEADERS = { 'cache-control': 'no-store', pragma: 'no-cache', 'access-control-allow-origin': '*' };

/** The token endpoint (docs/MCP.md): codes with PKCE, and refresh tokens, for public clients. */
export async function POST(request: Request) {
  const config = aiConfig();
  if (!config || !ownHost(request, config)) return new Response(null, { status: 404 });
  const text = await request.text().catch(() => '');
  if (text.length > 8192) return Response.json({ error: 'invalid_request' }, { status: 400, headers: HEADERS });
  const form = new URLSearchParams(text);
  const store = aiStoreFor(config);
  const grantType = form.get('grant_type');
  const answer =
    grantType === 'authorization_code'
      ? await redeemCode(config, store, form)
      : grantType === 'refresh_token'
        ? await refresh(config, store, form)
        : { status: 400, body: { error: 'unsupported_grant_type', error_description: 'Use authorization_code or refresh_token' } };
  return Response.json(answer.body, { status: answer.status, headers: HEADERS });
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' } });
