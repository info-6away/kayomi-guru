// Stand-ins for the two services a calendar connection talks to, so the browser tests never
// touch a real account: 6Away Auth (who is signing in) and Google (whose calendar it is).
// Started by Playwright alongside the app (see playwright.config.ts). Nothing here is used by
// the app itself, and no real Google or 6Away address is ever contacted in a test.
//
//   /idp/...      6Away Auth: OpenID Connect, as auth.6away.ai speaks it
//   /google/...   Google: the consent screen, the token endpoints and the Calendar API
//   /__fake/...   how a test sets up an account and sees what was asked of it
//
// Who signs in, and which Google account consents, is chosen by two cookies on this server's
// own address (`fake_user`, `fake_google`), which a test sets before it presses Connect.

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const PORT = Number(process.env.FAKE_PORT ?? 4315);
const ORIGIN = `http://localhost:${PORT}`;
const ISSUER = `${ORIGIN}/idp`;

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: 'fake-key', alg: 'RS256', use: 'sig' };

const random = () => randomBytes(12).toString('base64url');
const s256 = (verifier) => createHash('sha256').update(verifier).digest('base64url');
const cookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(req.headers.cookie ?? '')?.[1];
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const redirect = (res, to) => {
  res.writeHead(302, { location: to });
  res.end();
};
const body = (req) =>
  new Promise((resolve) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => resolve(text));
  });

// ---------- 6Away Auth ----------

const idpCodes = new Map();

async function idp(req, res, url) {
  if (url.pathname === '/idp/.well-known/jwks.json') return send(res, 200, { keys: [jwk] });

  if (url.pathname === '/idp/oauth/authorize') {
    const q = url.searchParams;
    const code = random();
    idpCodes.set(code, { sub: cookie(req, 'fake_user') ?? 'someone', nonce: q.get('nonce'), client: q.get('client_id'), redirect: q.get('redirect_uri'), challenge: q.get('code_challenge') });
    return redirect(res, `${q.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(q.get('state') ?? '')}`);
  }

  if (url.pathname === '/idp/oauth/token') {
    const form = new URLSearchParams(await body(req));
    const grant = idpCodes.get(form.get('code'));
    idpCodes.delete(form.get('code'));
    if (!grant || grant.redirect !== form.get('redirect_uri') || grant.challenge !== s256(form.get('code_verifier') ?? '')) return send(res, 400, { error: 'invalid_grant' });
    const idToken = await new SignJWT({ nonce: grant.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer(ISSUER)
      .setAudience(grant.client)
      .setSubject(grant.sub)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    return send(res, 200, { access_token: `idp.${grant.sub}`, id_token: idToken, token_type: 'Bearer', expires_in: 900 });
  }

  if (url.pathname === '/idp/oauth/userinfo') {
    const sub = /^Bearer idp\.(.+)$/.exec(req.headers.authorization ?? '')?.[1];
    return sub ? send(res, 200, { sub, email: `${sub}@example.test`, name: 'Test Person' }) : send(res, 401, { error: 'invalid_token' });
  }

  send(res, 404, { error: 'not_found' });
}

// ---------- Google ----------

/**
 * One Google account per test:
 *   calendars  Map of id -> { entry (the calendarList resource), events: Map of id -> event,
 *                             version, changes: [{ version, ids }] }
 *   tokens     refresh and access tokens that still work
 *   log        everything the app asked for, for the test to read back
 */
const accounts = new Map();
const blank = () => ({ calendars: new Map(), tokens: new Set(), revoked: false, fail: null, staleCursors: false, delay: 0, log: [] });
const account = (id) => {
  if (!accounts.has(id)) accounts.set(id, blank());
  return accounts.get(id);
};
const googleCodes = new Map();
/** Every attempt to trade a code for tokens, by any account. */
const exchanges = [];
const ALL_SCOPES = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'];

const cursor = (calendarId, version) => `cursor.${Buffer.from(calendarId).toString('base64url')}.${version}`;
const instants = (event) =>
  event.start?.date
    ? [Date.parse(`${event.start.date}T00:00:00Z`), Date.parse(`${event.end.date}T00:00:00Z`)]
    : [Date.parse(event.start?.dateTime), Date.parse(event.end?.dateTime)];

async function google(req, res, url) {
  // The consent screen. `fake_google` says who is at the keyboard and what they do.
  if (url.pathname === '/google/o/oauth2/v2/auth') {
    const q = url.searchParams;
    const who = cookie(req, 'fake_google') ?? 'nobody';
    const [choice, id] = who.includes(':') ? who.split(':') : ['allow', who];
    const acct = account(id);
    acct.log.push({ type: 'consent', choice, ...Object.fromEntries(q) });
    const back = new URL(q.get('redirect_uri'));
    back.searchParams.set('state', q.get('state') ?? '');
    if (choice === 'deny') {
      back.searchParams.set('error', 'access_denied');
      return redirect(res, back.href);
    }
    const code = random();
    // "partial": they unticked reading events, and gave only the list of calendars.
    googleCodes.set(code, { id, client: q.get('client_id'), redirect: q.get('redirect_uri'), challenge: q.get('code_challenge'), scope: choice === 'partial' ? ALL_SCOPES.slice(0, 1) : ALL_SCOPES });
    back.searchParams.set('code', code);
    return redirect(res, back.href);
  }

  if (url.pathname === '/google/token') {
    const form = new URLSearchParams(await body(req));
    if (form.get('client_id') !== 'google-test' || form.get('client_secret') !== 'google-secret') return send(res, 401, { error: 'invalid_client' });

    if (form.get('grant_type') === 'authorization_code') {
      const grant = googleCodes.get(form.get('code'));
      // A code is good once, as it is at Google.
      googleCodes.delete(form.get('code'));
      const refused = !grant
        ? 'unknown or used code'
        : grant.client !== form.get('client_id')
          ? 'another client'
          : grant.redirect !== form.get('redirect_uri')
            ? 'another redirect address'
            : grant.challenge !== s256(form.get('code_verifier') ?? '')
              ? 'wrong PKCE secret'
              : null;
      exchanges.push({ code: form.get('code'), refused });
      if (refused) return send(res, 400, { error: 'invalid_grant' });
      const acct = account(grant.id);
      acct.revoked = false;
      const refresh = `rt.${grant.id}.${random()}`;
      const access = `at.${grant.id}.${random()}`;
      acct.tokens.add(refresh).add(access);
      // Reaching here means the secret sent now hashes to the challenge shown at consent.
      acct.log.push({ type: 'grant', scope: grant.scope.join(' '), pkce: 'verified', client_id: form.get('client_id'), redirect_uri: form.get('redirect_uri') });
      return send(res, 200, { access_token: access, refresh_token: refresh, expires_in: 3599, scope: grant.scope.join(' '), token_type: 'Bearer' });
    }

    if (form.get('grant_type') === 'refresh_token') {
      const refresh = form.get('refresh_token') ?? '';
      const acct = account(refresh.split('.')[1] ?? '');
      acct.log.push({ type: 'refresh' });
      if (acct.fail === 'unavailable') return send(res, 503, { error: 'backendError' });
      if (acct.revoked || !acct.tokens.has(refresh)) return send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      const access = `at.${refresh.split('.')[1]}.${random()}`;
      acct.tokens.add(access);
      return send(res, 200, { access_token: access, expires_in: 3599, scope: ALL_SCOPES.join(' '), token_type: 'Bearer' });
    }
    return send(res, 400, { error: 'unsupported_grant_type' });
  }

  // Revoking any token ends the whole grant, as it does at Google.
  if (url.pathname === '/google/revoke') {
    const token = new URLSearchParams(await body(req)).get('token') ?? '';
    const acct = account(token.split('.')[1] ?? '');
    if (!acct.tokens.has(token)) return send(res, 400, { error: 'invalid_token' });
    acct.tokens.clear();
    acct.revoked = true;
    acct.log.push({ type: 'revoke' });
    return send(res, 200, {});
  }

  // The Calendar API.
  if (url.pathname.startsWith('/google/calendar/v3/')) {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const acct = account(token.split('.')[1] ?? '');
    if (acct.revoked || !acct.tokens.has(token)) return send(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
    if (acct.fail === 'unavailable') return send(res, 503, { error: { code: 503, status: 'UNAVAILABLE' } });
    if (acct.fail === 'limited') return send(res, 403, { error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] } });
    if (acct.delay) await new Promise((resolve) => setTimeout(resolve, acct.delay));
    const q = url.searchParams;

    if (url.pathname === '/google/calendar/v3/users/me/calendarList') {
      acct.log.push({ type: 'calendars', fields: q.get('fields') });
      return send(res, 200, { items: [...acct.calendars.values()].map((c) => c.entry) });
    }

    const match = /^\/google\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    const cal = match && acct.calendars.get(decodeURIComponent(match[1]));
    if (!match) return send(res, 404, { error: { code: 404 } });
    if (!cal) return send(res, 404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
    const calendarId = decodeURIComponent(match[1]);
    const next = cursor(calendarId, cal.version);
    const common = { singleEvents: q.get('singleEvents'), fields: q.get('fields') };

    const given = q.get('syncToken');
    if (given) {
      // A cursor and a span together are refused, as Google refuses them.
      if (q.has('timeMin') || q.has('timeMax')) return send(res, 400, { error: { code: 400 } });
      const version = Number(given.split('.')[2]);
      if (acct.staleCursors || !given.startsWith(cursor(calendarId, '')) || !(version <= cal.version)) {
        acct.log.push({ type: 'events', calendarId, mode: 'stale cursor', ...common });
        return send(res, 410, { error: { code: 410, errors: [{ reason: 'fullSyncRequired' }] } });
      }
      const changed = new Set(cal.changes.filter((c) => c.version > version).flatMap((c) => c.ids));
      acct.log.push({ type: 'events', calendarId, mode: 'changes', count: changed.size, ...common });
      return send(res, 200, { items: [...changed].map((id) => cal.events.get(id) ?? { id, status: 'cancelled' }), nextSyncToken: next });
    }

    const [min, max] = [Date.parse(q.get('timeMin')), Date.parse(q.get('timeMax'))];
    const items = [...cal.events.values()].filter((event) => {
      const [start, end] = instants(event);
      return end > min && start < max;
    });
    acct.log.push({ type: 'events', calendarId, mode: 'everything', count: items.length, timeMin: q.get('timeMin'), timeMax: q.get('timeMax'), ...common });
    return send(res, 200, { items, nextSyncToken: next });
  }

  send(res, 404, { error: 'not_found' });
}

// ---------- Test controls ----------

async function control(req, res, url) {
  if (url.pathname === '/__fake/health') return send(res, 200, { ok: true });
  if (url.pathname === '/__fake/exchanges') return send(res, 200, exchanges.filter((e) => e.code === url.searchParams.get('code')));
  const match = /^\/__fake\/google\/([^/]+)(\/change|\/state)?$/.exec(url.pathname);
  if (!match) return send(res, 404, {});
  const id = decodeURIComponent(match[1]);
  // Setting an account up starts it from nothing: no tokens, no history, nothing left from an earlier test.
  if (req.method === 'PUT') accounts.set(id, blank());
  const acct = account(id);
  const data = req.method === 'GET' ? null : JSON.parse((await body(req)) || '{}');

  // What the app has asked of this account so far.
  if (req.method === 'GET') return send(res, 200, { log: acct.log, revoked: acct.revoked, liveTokens: acct.tokens.size });

  // PUT /__fake/google/:account  { calendars: [{ id, summary, primary?, selected?, events: [...] }] }
  if (!match[2]) {
    acct.calendars = new Map(
      data.calendars.map(({ events = [], ...entry }) => [entry.id, { entry, events: new Map(events.map((e) => [e.id, e])), version: 1, changes: [] }]),
    );
    return send(res, 200, {});
  }

  // POST .../change  { calendarId, upsert?: [...events], cancel?: [...ids] }: something changed at Google.
  if (match[2] === '/change') {
    const cal = acct.calendars.get(data.calendarId);
    cal.version += 1;
    for (const event of data.upsert ?? []) cal.events.set(event.id, event);
    for (const id of data.cancel ?? []) cal.events.delete(id);
    cal.changes.push({ version: cal.version, ids: [...(data.upsert ?? []).map((e) => e.id), ...(data.cancel ?? [])] });
    return send(res, 200, {});
  }

  // POST .../state  { revoked?, fail?: null | 'unavailable' | 'limited', staleCursors?, delay?, removeCalendar? }
  if ('revoked' in data) {
    acct.revoked = data.revoked;
    if (data.revoked) acct.tokens.clear();
  }
  if ('fail' in data) acct.fail = data.fail;
  if ('staleCursors' in data) acct.staleCursors = data.staleCursors;
  if ('delay' in data) acct.delay = data.delay;
  if (data.removeCalendar) acct.calendars.delete(data.removeCalendar);
  return send(res, 200, {});
}

createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  const handler = url.pathname.startsWith('/idp/') ? idp : url.pathname.startsWith('/google/') ? google : control;
  handler(req, res, url).catch((error) => send(res, 500, { error: String(error?.message ?? error) }));
}).listen(PORT, () => console.log(`fake providers on ${ORIGIN}`));
