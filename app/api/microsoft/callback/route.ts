import { forgetAccess, storeFor } from '@/lib/server/api';
import { homeFor, takeFlow } from '@/lib/server/connecting';
import { accountKey, sealContext } from '@/lib/server/connections';
import { connectionsConfig } from '@/lib/server/env';
import { report } from '@/lib/server/log';
import { accountOf, exchangeCode, grantedNames, grantsCalendars, refusalOf } from '@/lib/server/microsoft';
import { seal } from '@/lib/server/seal';

export const dynamic = 'force-dynamic';

/**
 * Where Microsoft sends the visitor back. The code in the address is traded for tokens here, on
 * the server; the refresh token is sealed and stored as the connection for the account that
 * gave it, and the browser is sent home knowing only how it went: one of a few fixed words, to
 * the app's own address. Any other account the person has connected, at Microsoft or at Google,
 * is left exactly as it was.
 */
export async function GET(request: Request) {
  const config = connectionsConfig();
  if (!config?.microsoft) return new Response(null, { status: 404 });
  const microsoft = config.microsoft;
  const home = homeFor(config, 'microsoft');

  // Used once: whatever happens next, this attempt cannot be presented a second time.
  const { url, user, flow } = await takeFlow(request, config, 'microsoft');

  // "Cancel" on Microsoft's screen, or a work account whose organisation has not let its people
  // allow Koyomi: Microsoft's number for it says which. The log has its codes and nothing else.
  if (url.searchParams.has('error')) {
    const refusal = refusalOf(url.searchParams);
    console.log(`[calendars] microsoft: a sign-in came back refused: ${refusal.codes || 'no code'}`);
    return home(refusal.needsAdmin ? 'approval' : 'cancelled');
  }

  // An administrator back from approving Koyomi for their whole organisation, by Microsoft's
  // admin consent link. Nobody was connected by it, so there is no code. Microsoft's word that it
  // was approved is only shown back to whoever followed the link; it changes nothing here.
  if (url.searchParams.get('admin_consent')?.toLowerCase() === 'true' && !url.searchParams.has('code')) return home('approved');

  // Honoured only for the browser that started it (the sealed cookie), for the state that was
  // sent, within ten minutes, for Microsoft, and for the person who started it.
  const code = url.searchParams.get('code');
  if (!flow || !code || !user) return home('failed');

  try {
    const tokens = await exchangeCode(microsoft, code, flow.verifier);
    // What Microsoft granted, by permission name only: how a refusal later can be told apart.
    console.log(`[calendars] microsoft: a consent came back granting ${grantedNames(tokens.scope) || 'nothing named'}`);
    // Without the permission to read calendars, or without a way to read them again later,
    // there is nothing to keep. Microsoft has no way to hand a permission back: nothing is
    // stored, and its tokens are dropped here.
    if (!tokens.refreshToken || !grantsCalendars(tokens.scope)) return home('declined');

    // Which account this is decides which row it is: the same account again replaces its own
    // token, and another account becomes another row. Microsoft says which in the ID token that
    // came with the consent, for this attempt. Without knowing, there is nowhere to keep the
    // permission, so nothing is kept and the person is asked to try again.
    let account: string;
    try {
      account = accountOf(microsoft, tokens.idToken, flow.nonce);
    } catch {
      return home('failed');
    }

    const store = storeFor(config);
    const connection = { subject: user.sub, provider: 'microsoft' as const, accountKey: accountKey(config.tokenKey, user.sub, 'microsoft', account) };
    const id = await store.save(connection.subject, connection.provider, connection.accountKey, seal(tokens.refreshToken, config.tokenKey, sealContext(connection)), tokens.scope);
    forgetAccess(id);
    return home('connected');
  } catch (error) {
    report('connecting', error);
    return home('failed');
  }
}
