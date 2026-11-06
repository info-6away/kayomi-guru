// Stand-ins for the services a calendar connection talks to, so the browser tests never touch a
// real account: 6Away Auth (who is signing in), and Google and Microsoft (whose calendar it is).
// Started by Playwright alongside the app (see playwright.config.ts). Nothing here is used by
// the app itself, and no real Google, Microsoft or 6Away address is ever contacted in a test.
//
//   /idp/...        6Away Auth: OpenID Connect, as auth.6away.ai speaks it
//   /google/...     Google: the consent screen, the token endpoints and the Calendar API
//   /microsoft/...  Microsoft: the account chooser and consent screen, the token endpoint
//                   (identity platform v2.0) and Microsoft Graph v1.0
//   /__fake/...     how a test sets up an account and sees what was asked of it
//
// Who signs in, and which Google or Microsoft account consents, is chosen by cookies on this
// server's own address (`fake_user`, `fake_google`, `fake_microsoft`), which a test sets before
// it adds an account. The last two are what picking an account on the provider's own list comes
// to: a test that connects two accounts changes them in between.

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

  // Signing out: 6Away ends its own session, then sends the browser back where the app asked.
  if (url.pathname === '/idp/oauth/logout') {
    const back = url.searchParams.get('post_logout_redirect_uri');
    return back ? redirect(res, back) : send(res, 200, { signed_out: true });
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
const blank = () => ({ calendars: new Map(), tokens: new Set(), revoked: false, fail: null, staleCursors: false, delay: 0, hold: null, waiting: [], log: [] });
const account = (id) => {
  if (!accounts.has(id)) accounts.set(id, blank());
  return accounts.get(id);
};
/**
 * Which accounts someone with no `fake_google` cookie is, one after the other: for adding
 * accounts by hand (scripts/preview-connected.mjs). The last one is who they stay.
 */
let turns = [];
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
    const who = cookie(req, 'fake_google') ?? (turns.length > 1 ? turns.shift() : turns[0]) ?? 'nobody';
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
    // The Calendar API is not enabled in the app's own Google Cloud project: Google's words for it.
    if (acct.fail === 'disabled') {
      return send(res, 403, {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'Google Calendar API has not been used in project 0 before or it is disabled.',
          errors: [{ domain: 'usageLimits', reason: 'accessNotConfigured' }],
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }],
        },
      });
    }
    if (acct.delay) await new Promise((resolve) => setTimeout(resolve, acct.delay));
    // A test is keeping this kind of question waiting. It is answered when the test lets go, so
    // whatever the test does in between happens while the reading is under way, however fast or
    // slow the machine is.
    const asks = url.pathname === '/google/calendar/v3/users/me/calendarList' ? 'calendars' : url.pathname === '/google/calendar/v3/users/me/calendarList/primary' ? 'account' : 'events';
    if (acct.hold === asks) await new Promise((resolve) => acct.waiting.push(resolve));
    const q = url.searchParams;

    // Which account this is: its own calendar, by id. All Koyomi ever learns of who it is.
    if (asks === 'account') {
      acct.log.push({ type: 'account', fields: q.get('fields') });
      const own = [...acct.calendars.values()].find((c) => c.entry.primary);
      // Every Google account has a calendar of its own, whether or not a test gave it one.
      return send(res, 200, { id: own?.entry.id ?? `${token.split('.')[1]}@account.example.test` });
    }

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

// ---------- Microsoft ----------

/** The tenant Microsoft signs every personal account in to. */
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
/**
 * One Microsoft account per test:
 *   kind       'personal' or 'work'
 *   tenant     its tenant's id: Microsoft's own, for a personal account
 *   address    its mailbox's address: the owner of its own calendars
 *   calendars  Map of id -> { entry (the calendar resource), deny, events: Map of id -> event }
 *   tokens     refresh and access tokens that still work
 *   log        everything the app asked for, for the test to read back
 */
const msAccounts = new Map();
const msBlank = () => ({ kind: 'personal', tenant: PERSONAL_TENANT, address: null, calendars: new Map(), tokens: new Set(), revoked: false, fail: null, delay: 0, hold: null, waiting: [], log: [], pageSize: 3, foreignNext: false });
const msAccount = (id) => {
  if (!msAccounts.has(id)) msAccounts.set(id, msBlank());
  return msAccounts.get(id);
};
/** Who chooses an account next, for someone with no `fake_microsoft` cookie (scripts/preview-connected.mjs). */
let msTurns = [];
const msCodes = new Map();
const MS_SCOPES = ['openid', 'offline_access', 'https://graph.microsoft.com/Calendars.Read'];
const MS_CLIENT = { id: 'microsoft-test', secret: 'microsoft-secret' };
/** The subject Microsoft gives one app for one person: the same every time, different in every other app. Mixed case, as Microsoft's is. */
const pairwise = (client, tenant, id) => createHash('sha256').update(`${client}:${tenant}:${id}`).digest('base64url').slice(0, 43);
/** A wall-clock time in UTC as Graph writes one: no offset, seven places after the second. */
const graphInstant = (dateTime) => Date.parse(`${String(dateTime).slice(0, 19)}Z`);

async function microsoft(req, res, url) {
  // The account chooser and consent screen. `fake_microsoft` says who is at the keyboard and what they do.
  if (url.pathname === '/microsoft/common/oauth2/v2.0/authorize') {
    const q = url.searchParams;
    const who = cookie(req, 'fake_microsoft') ?? (msTurns.length > 1 ? msTurns.shift() : msTurns[0]) ?? 'nobody';
    const [choice, id] = who.includes(':') ? who.split(':') : ['allow', who];
    const acct = msAccount(id);
    acct.log.push({ type: 'consent', choice, ...Object.fromEntries(q) });
    const back = new URL(q.get('redirect_uri'));
    back.searchParams.set('state', q.get('state') ?? '');
    // "Cancel", or a work account whose organisation needs an administrator to approve Koyomi first.
    if (choice === 'deny' || choice === 'admin') {
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('error_description', choice === 'admin' ? 'AADSTS90094: admin approval required' : 'the user canceled the authentication');
      return redirect(res, back.href);
    }
    const code = random();
    // "partial": a sign-in that came back without the permission to read calendars.
    msCodes.set(code, { id, client: q.get('client_id'), redirect: q.get('redirect_uri'), challenge: q.get('code_challenge'), nonce: q.get('nonce'), scope: choice === 'partial' ? MS_SCOPES.slice(0, 2) : MS_SCOPES });
    back.searchParams.set('code', code);
    return redirect(res, back.href);
  }

  if (url.pathname === '/microsoft/common/oauth2/v2.0/token') {
    const form = new URLSearchParams(await body(req));
    const refused = () => send(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000222: The provided client secret keys are expired.' });
    if (form.get('client_id') !== MS_CLIENT.id || form.get('client_secret') !== MS_CLIENT.secret) return refused();

    if (form.get('grant_type') === 'authorization_code') {
      const grant = msCodes.get(form.get('code'));
      // A code is good once, as it is at Microsoft.
      msCodes.delete(form.get('code'));
      const problem = !grant
        ? 'unknown or used code'
        : grant.client !== form.get('client_id')
          ? 'another client'
          : grant.redirect !== form.get('redirect_uri')
            ? 'another redirect address'
            : grant.challenge !== s256(form.get('code_verifier') ?? '')
              ? 'wrong PKCE secret'
              : null;
      exchanges.push({ code: form.get('code'), refused: problem });
      if (problem) return send(res, 400, { error: 'invalid_grant', error_description: `AADSTS70008: ${problem}` });
      const acct = msAccount(grant.id);
      if (acct.fail === 'secret') return refused();
      acct.revoked = false;
      const access = `mat.${grant.id}.${random()}`;
      const refresh = `mrt.${grant.id}.${random()}`;
      acct.tokens.add(access).add(refresh);
      acct.log.push({ type: 'grant', scope: grant.scope.join(' '), pkce: 'verified', client_id: form.get('client_id'), redirect_uri: form.get('redirect_uri'), asked: form.get('scope') });
      const idToken = await new SignJWT({ tid: acct.tenant, nonce: grant.nonce, ver: '2.0' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(`${ORIGIN}/microsoft/${acct.tenant}/v2.0`)
        .setAudience(grant.client)
        .setSubject(pairwise(grant.client, acct.tenant, grant.id))
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);
      // Microsoft writes what it granted with the resource's address or without it. Both are seen here.
      const scope = acct.kind === 'work' ? grant.scope.join(' ') : grant.scope.map((s) => s.replace('https://graph.microsoft.com/', '')).join(' ');
      return send(res, 200, { token_type: 'Bearer', scope, expires_in: 3599, access_token: access, ...(grant.scope.includes('offline_access') ? { refresh_token: refresh } : {}), id_token: idToken });
    }

    if (form.get('grant_type') === 'refresh_token') {
      const refresh = form.get('refresh_token') ?? '';
      const acct = msAccount(refresh.split('.')[1] ?? '');
      acct.log.push({ type: 'refresh', asked: form.get('scope') });
      if (acct.fail === 'secret') return refused();
      if (acct.fail === 'unavailable') return send(res, 503, { error: 'temporarily_unavailable' });
      if (acct.fail === 'mfa') return send(res, 400, { error: 'interaction_required', error_codes: [50076] });
      if (acct.revoked || !acct.tokens.has(refresh)) return send(res, 400, { error: 'invalid_grant', error_description: 'AADSTS70000: The refresh token is not valid.', error_codes: [70000] });
      const id = refresh.split('.')[1];
      const access = `mat.${id}.${random()}`;
      // A new refresh token with every use. Microsoft does not revoke the old one: it stays good.
      const next = `mrt.${id}.${random()}`;
      acct.tokens.add(access).add(next);
      return send(res, 200, { token_type: 'Bearer', scope: MS_SCOPES.join(' '), expires_in: 3599, access_token: access, refresh_token: next });
    }
    return send(res, 400, { error: 'unsupported_grant_type' });
  }

  // Microsoft Graph.
  if (url.pathname.startsWith('/microsoft/graph/v1.0/')) {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const acct = msAccount(token.split('.')[1] ?? '');
    if (acct.revoked || !acct.tokens.has(token)) return send(res, 401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired or is not yet valid.' } });
    if (acct.fail === 'nomailbox') return send(res, 404, { error: { code: 'MailboxNotEnabledForRESTAPI', message: 'The mailbox is either inactive, soft-deleted, or is hosted on-premise.' } });
    if (acct.fail === 'unavailable') return send(res, 503, { error: { code: 'ServiceNotAvailable' } });
    if (acct.fail === 'throttled') return send(res, 429, { error: { code: 'ApplicationThrottled', message: 'Application is over its MailboxConcurrency limit.' } }, { 'retry-after': '30' });
    if (acct.delay) await new Promise((resolve) => setTimeout(resolve, acct.delay));
    const asks = url.pathname === '/microsoft/graph/v1.0/me/calendars' ? 'calendars' : 'events';
    if (acct.hold === asks) await new Promise((resolve) => acct.waiting.push(resolve));

    const q = url.searchParams;
    const select = (q.get('$select') ?? '').split(',').filter(Boolean);
    // Graph sends only what was asked for.
    const pick = (resource) => (select.length ? Object.fromEntries(Object.entries(resource).filter(([key]) => select.includes(key))) : resource);
    const skip = Number(q.get('$skiptoken') ?? 0);
    const page = (items, size, again) => {
      const value = items.slice(skip, skip + size);
      const more = skip + size < items.length;
      return { value, ...(more ? { '@odata.nextLink': `${again}&$skiptoken=${skip + size}` } : {}) };
    };
    const common = { select: q.get('$select'), prefer: req.headers.prefer ?? null, skip };

    if (asks === 'calendars') {
      acct.log.push({ type: 'calendars', ...common });
      const all = [...acct.calendars.values()].map((c) => pick(c.entry));
      // Graph sends ten a page. The stand-in sends two, so that following the next page is tested.
      const answer = page(all, 2, `${ORIGIN}${url.pathname}?$select=${q.get('$select') ?? ''}`);
      // A next page on someone else's address: Koyomi must not follow it.
      if (acct.foreignNext && !answer['@odata.nextLink']) answer['@odata.nextLink'] = 'http://evil.example/graph/v1.0/me/calendars?$skiptoken=9';
      return send(res, 200, answer);
    }

    const match = /^\/microsoft\/graph\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/.exec(url.pathname);
    if (!match) return send(res, 404, { error: { code: 'BadRequest' } });
    const calendarId = decodeURIComponent(match[1]);
    const cal = acct.calendars.get(calendarId);
    if (!cal) return send(res, 404, { error: { code: 'ErrorItemNotFound' } });
    if (cal.deny) return send(res, 403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } });
    const [min, max] = [Date.parse(q.get('startDateTime')), Date.parse(q.get('endDateTime'))];
    if (Number.isNaN(min) || Number.isNaN(max)) return send(res, 400, { error: { code: 'ErrorInvalidParameter' } });
    const items = [...cal.events.values()].filter((event) => graphInstant(event.end?.dateTime) > min && graphInstant(event.start?.dateTime) < max);
    acct.log.push({ type: 'events', calendarId, top: q.get('$top'), startDateTime: q.get('startDateTime'), endDateTime: q.get('endDateTime'), count: items.length, ...common });
    const again = `${ORIGIN}${url.pathname}?startDateTime=${encodeURIComponent(q.get('startDateTime'))}&endDateTime=${encodeURIComponent(q.get('endDateTime'))}&$select=${q.get('$select') ?? ''}&$top=${q.get('$top') ?? ''}`;
    return send(res, 200, page(items.map(pick), acct.pageSize, again));
  }

  send(res, 404, { error: 'not_found' });
}

// ---------- Yahoo ----------

// CalDAV, as Yahoo's server at caldav.calendar.yahoo.com behaves, on an origin of its own (as
// Yahoo's is): Basic credentials on every request, a refusal that is a JSON body with no
// challenge, /.well-known/caldav sending the client to /principals/, the principal under
// /principals/users/<email>/, a calendar home of its own, and time spans matched to an event by
// its first occurrence only (Yahoo does not expand a series to see whether it reaches a span).
// Anything that would change a calendar is never answered, and is written down.

const YAHOO_PORT = Number(process.env.FAKE_YAHOO_PORT ?? 4316);
const YAHOO_ORIGIN = `http://localhost:${YAHOO_PORT}`;
/** One Yahoo account per test, by its email. */
const yahooAccounts = new Map();
/** Every request Koyomi must never send: anything but PROPFIND, REPORT and OPTIONS. */
const yahooWrites = [];
const yBlank = () => ({ password: null, id: random().replace(/[^a-z0-9]/gi, ''), calendars: new Map(), revoked: false, fail: null, hold: null, waiting: [], redirect: null, log: [] });
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Prefixes of its own, as a server's are: what is read is the namespace, never the prefix.
const multistatus = (responses) => `<?xml version="1.0" encoding="UTF-8"?>\n<D:multistatus xmlns:D="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav">${responses.join('')}</D:multistatus>`;
const found = (href, props) => `<D:response><D:href>${xml(href)}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
const refuse = (res) => {
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end('{"error":{"code": 4003, "message":"Invalid User credential"}}');
};
const basicOf = (req) => {
  const [, encoded] = /^Basic (.+)$/.exec(req.headers.authorization ?? '') ?? [];
  if (!encoded) return null;
  const text = Buffer.from(encoded, 'base64').toString('utf8');
  const at = text.indexOf(':');
  return at < 0 ? null : { email: text.slice(0, at).toLowerCase(), password: text.slice(at + 1) };
};
/** Roughly when an object's first occurrence is, which is all Yahoo matches a span on. Zones are not looked at. */
function firstSpan(ics) {
  const events = ics.replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r?\n?/g, '');
  const value = (name) => new RegExp(`^${name}(?:;[^:\\r\\n]*)?:([0-9TZ]+)`, 'm').exec(events)?.[1];
  const at = (v) => (!v ? NaN : v.length === 8 ? Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)) : Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13), +v.slice(13, 15)));
  const start = at(value('DTSTART'));
  const end = at(value('DTEND'));
  return [start, Number.isNaN(end) ? start + (value('DTSTART')?.length === 8 ? 864e5 : 3600e3) : Math.max(end, start + 1)];
}
const utc = (stamp) => Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13), +stamp.slice(13, 15));

async function yahoo(req, res) {
  const url = new URL(req.url, YAHOO_ORIGIN);
  const text = await body(req);
  if (!['PROPFIND', 'REPORT', 'OPTIONS'].includes(req.method)) {
    yahooWrites.push({ method: req.method, path: url.pathname });
    return send(res, 405, { error: 'Koyomi only reads' });
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(200, { dav: '1, 3, calendar-access' });
    return res.end();
  }
  const who = basicOf(req);
  const acct = who && yahooAccounts.get(who.email);
  // Yahoo sends the well-known address to its principals on the same server. A test can make it
  // send the client somewhere else instead, which must not be followed.
  if (url.pathname === '/.well-known/caldav') {
    const to = acct?.redirect === 'away' ? 'http://evil.example/principals/' : acct?.redirect === 'other-origin' ? `http://127.0.0.1:${YAHOO_PORT}/principals/` : '/principals/';
    res.writeHead(301, { location: to });
    return res.end();
  }
  if (!acct || acct.revoked || who.password !== acct.password) {
    if (acct) acct.log.push({ type: 'refused', method: req.method, path: url.pathname });
    return refuse(res);
  }
  const principal = `/principals/users/${who.email}/`;
  const home = `/dav/${acct.id}/Calendar/`;
  const kind = url.pathname === '/principals/' ? 'principal' : url.pathname === principal ? 'home' : url.pathname === home ? 'calendars' : 'events';
  const entry = { type: kind, method: req.method, path: url.pathname, depth: req.headers.depth ?? null, user: who.email };
  acct.log.push(entry);
  if (acct.fail === 'unavailable') return send(res, 503, {});
  if (acct.fail === 'throttled') return send(res, 429, {}, { 'retry-after': '30' });
  if (acct.hold === kind) await new Promise((resolve) => acct.waiting.push(resolve));
  const reply = (doc) => {
    res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
    res.end(doc);
  };
  if (acct.fail === 'malformed' && kind === 'events') return reply('<D:multistatus xmlns:D="DAV:"><D:response>');
  if (acct.fail === 'doctype') return reply('<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY a "aaaaaaaaaa">]><D:multistatus xmlns:D="DAV:"/>');

  if (kind === 'principal' && req.method === 'PROPFIND') return reply(multistatus([found('/principals/', `<D:current-user-principal><D:href>${xml(principal)}</D:href></D:current-user-principal>`)]));
  if (kind === 'home' && req.method === 'PROPFIND') return reply(multistatus([found(principal, `<CAL:calendar-home-set><D:href>${xml(home)}</D:href></CAL:calendar-home-set>`)]));
  if (kind === 'calendars' && req.method === 'PROPFIND') {
    const own = [...acct.calendars.values()].map((c) =>
      found(
        `${home}${c.id}/`,
        `<D:resourcetype><D:collection/><CAL:calendar/></D:resourcetype><D:displayname>${xml(c.name)}</D:displayname>` +
          `<CAL:supported-calendar-component-set><CAL:comp name="${c.todo ? 'VTODO' : 'VEVENT'}"/></CAL:supported-calendar-component-set>` +
          `<D:current-user-privilege-set><D:privilege><D:read/></D:privilege>${c.readOnly ? '' : '<D:privilege><D:write/></D:privilege>'}</D:current-user-privilege-set>`,
      ),
    );
    return reply(multistatus([found(home, '<D:resourcetype><D:collection/></D:resourcetype>'), ...own]));
  }
  const match = url.pathname.startsWith(home) ? /^([^/]+)\/$/.exec(url.pathname.slice(home.length)) : null;
  const cal = match && acct.calendars.get(decodeURIComponent(match[1]));
  if (!cal) return send(res, 404, {});
  if (req.method !== 'REPORT') return reply(multistatus([found(url.pathname, '<D:resourcetype><D:collection/><CAL:calendar/></D:resourcetype>')]));
  if (cal.denied) return send(res, 403, {});
  const range = /time-range\s+start="(\d{8}T\d{6}Z)"\s+end="(\d{8}T\d{6}Z)"/.exec(text);
  if (!range) return send(res, 400, {});
  const [from, to] = [utc(range[1]), utc(range[2])];
  const repeatingOnly = /prop-filter\s+name="RRULE"/.test(text);
  if (repeatingOnly && acct.fail === 'no-prop-filter') return send(res, 400, {});
  Object.assign(entry, { calendar: cal.id, start: range[1], end: range[2], repeatingOnly, parts: /<c:comp name="VEVENT">/i.test(text) });
  const objects = [...cal.objects.entries()].filter(([, ics]) => {
    const [start, end] = firstSpan(ics);
    return start < to && end > from && (!repeatingOnly || /^RRULE:/m.test(ics));
  });
  // The whole of each object, as Yahoo sends it, whatever parts were asked for.
  return reply(multistatus(objects.map(([name, ics]) => found(`${url.pathname}${name}.ics`, `<D:getetag>"${createHash('sha1').update(ics).digest('hex').slice(0, 12)}"</D:getetag><CAL:calendar-data>${xml(ics)}</CAL:calendar-data>`))));
}

async function yahooControl(req, res, email, what) {
  if (req.method === 'PUT') yahooAccounts.set(email, yBlank());
  const acct = yahooAccounts.get(email) ?? (yahooAccounts.set(email, yBlank()), yahooAccounts.get(email));
  // The log has the email and what was asked, and never a password.
  if (req.method === 'GET') return send(res, 200, { log: acct.log, held: acct.waiting.length, writes: yahooWrites });
  const data = JSON.parse((await body(req)) || '{}');
  // PUT /__fake/yahoo/:email  { password, calendars: [{ id, name, readOnly?, todo?, objects: { name: ics } }] }
  if (!what) {
    acct.password = data.password;
    acct.calendars = new Map(data.calendars.map((c) => [c.id, { id: c.id, name: c.name, readOnly: !!c.readOnly, todo: !!c.todo, denied: false, objects: new Map(Object.entries(c.objects ?? {})) }]));
    return send(res, 200, { home: `/dav/${acct.id}/Calendar/` });
  }
  // POST .../change  { calendar, put?: { name: ics }, remove?: [names] }: something changed at Yahoo.
  if (what === '/change') {
    const cal = acct.calendars.get(data.calendar);
    for (const [name, ics] of Object.entries(data.put ?? {})) cal.objects.set(name, ics);
    for (const name of data.remove ?? []) cal.objects.delete(name);
    return send(res, 200, {});
  }
  // POST .../state  { revoked?, password?, fail?: null | 'unavailable' | 'throttled' | 'malformed' | 'doctype' | 'no-prop-filter',
  //                   hold?: null | 'principal' | 'home' | 'calendars' | 'events', redirect?: null | 'away' | 'other-origin', deny? }
  if ('revoked' in data) acct.revoked = data.revoked;
  if ('password' in data) acct.password = data.password;
  if ('fail' in data) acct.fail = data.fail;
  if ('redirect' in data) acct.redirect = data.redirect;
  if (data.deny) acct.calendars.get(data.deny).denied = true;
  if ('hold' in data) {
    acct.hold = data.hold;
    if (!data.hold) acct.waiting.splice(0).forEach((answer) => answer());
  }
  return send(res, 200, {});
}

// ---------- Test controls ----------

async function control(req, res, url) {
  if (url.pathname === '/__fake/health') return send(res, 200, { ok: true });
  if (url.pathname === '/__fake/exchanges') return send(res, 200, exchanges.filter((e) => e.code === url.searchParams.get('code')));
  // PUT /__fake/turns  ["first", "second"]: who consents next, for someone with no cookie to say.
  if (url.pathname === '/__fake/turns') {
    turns = JSON.parse((await body(req)) || '[]');
    return send(res, 200, {});
  }
  // PUT /__fake/microsoft-turns  ["first", "second"]: the same, at Microsoft.
  if (url.pathname === '/__fake/microsoft-turns') {
    msTurns = JSON.parse((await body(req)) || '[]');
    return send(res, 200, {});
  }
  const ms = /^\/__fake\/microsoft\/([^/]+)(\/change|\/state)?$/.exec(url.pathname);
  if (ms) return msControl(req, res, decodeURIComponent(ms[1]), ms[2]);
  const ya = /^\/__fake\/yahoo\/([^/]+)(\/change|\/state)?$/.exec(url.pathname);
  if (ya) return yahooControl(req, res, decodeURIComponent(ya[1]).toLowerCase(), ya[2]);
  const match = /^\/__fake\/google\/([^/]+)(\/change|\/state)?$/.exec(url.pathname);
  if (!match) return send(res, 404, {});
  const id = decodeURIComponent(match[1]);
  // Setting an account up starts it from nothing: no tokens, no history, nothing left from an earlier test.
  if (req.method === 'PUT') accounts.set(id, blank());
  const acct = account(id);
  const data = req.method === 'GET' ? null : JSON.parse((await body(req)) || '{}');

  // What the app has asked of this account so far.
  if (req.method === 'GET') return send(res, 200, { log: acct.log, revoked: acct.revoked, liveTokens: acct.tokens.size, held: acct.waiting.length });

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

  // POST .../state  { revoked?, fail?: null | 'unavailable' | 'limited' | 'disabled', staleCursors?, delay?,
  //                   hold?: null | 'calendars' | 'events', removeCalendar? }
  if ('revoked' in data) {
    acct.revoked = data.revoked;
    if (data.revoked) acct.tokens.clear();
  }
  if ('fail' in data) acct.fail = data.fail;
  if ('staleCursors' in data) acct.staleCursors = data.staleCursors;
  if ('delay' in data) acct.delay = data.delay;
  if ('hold' in data) {
    acct.hold = data.hold;
    // Letting go answers everything that was kept waiting.
    if (!data.hold) acct.waiting.splice(0).forEach((answer) => answer());
  }
  if (data.removeCalendar) acct.calendars.delete(data.removeCalendar);
  return send(res, 200, {});
}

async function msControl(req, res, id, what) {
  // Setting an account up starts it from nothing: no tokens, no history, nothing left from an earlier test.
  if (req.method === 'PUT') msAccounts.set(id, msBlank());
  const acct = msAccount(id);
  if (req.method === 'GET') return send(res, 200, { log: acct.log, revoked: acct.revoked, liveTokens: acct.tokens.size, held: acct.waiting.length, kind: acct.kind, tenant: acct.tenant });
  const data = JSON.parse((await body(req)) || '{}');

  // PUT /__fake/microsoft/:account  { kind?, tenant?, address, calendars: [{ id, name, isDefaultCalendar?, canEdit?, owner?, deny?, events: [...] }] }
  if (!what) {
    acct.kind = data.kind ?? 'personal';
    acct.tenant = data.tenant ?? (acct.kind === 'work' ? '72f988bf-86f1-41af-91ab-2d7cd011db47' : PERSONAL_TENANT);
    acct.address = data.address;
    acct.calendars = new Map(
      data.calendars.map(({ events = [], deny = false, ...entry }) => [
        entry.id,
        { entry: { canEdit: true, isDefaultCalendar: false, owner: { name: 'Test Person', address: data.address }, ...entry }, deny, events: new Map(events.map((e) => [e.id, e])) },
      ]),
    );
    return send(res, 200, {});
  }

  // POST .../change  { calendarId, upsert?: [...events], cancel?: [...ids] }: something changed at Microsoft.
  if (what === '/change') {
    const cal = acct.calendars.get(data.calendarId);
    for (const event of data.upsert ?? []) cal.events.set(event.id, event);
    for (const eventId of data.cancel ?? []) cal.events.delete(eventId);
    return send(res, 200, {});
  }

  // POST .../state  { revoked?, fail?: null | 'unavailable' | 'throttled' | 'nomailbox' | 'mfa' | 'secret', delay?,
  //                   hold?: null | 'calendars' | 'events', pageSize?, foreignNext?, removeCalendar?, deny? }
  if ('revoked' in data) {
    acct.revoked = data.revoked;
    if (data.revoked) acct.tokens.clear();
  }
  if ('fail' in data) acct.fail = data.fail;
  if ('delay' in data) acct.delay = data.delay;
  if ('pageSize' in data) acct.pageSize = data.pageSize;
  if ('foreignNext' in data) acct.foreignNext = data.foreignNext;
  if ('hold' in data) {
    acct.hold = data.hold;
    if (!data.hold) acct.waiting.splice(0).forEach((answer) => answer());
  }
  if (data.removeCalendar) acct.calendars.delete(data.removeCalendar);
  if (data.deny) acct.calendars.get(data.deny).deny = true;
  return send(res, 200, {});
}

createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  const handler = url.pathname.startsWith('/idp/') ? idp : url.pathname.startsWith('/google/') ? google : url.pathname.startsWith('/microsoft/') ? microsoft : control;
  handler(req, res, url).catch((error) => send(res, 500, { error: String(error?.message ?? error) }));
}).listen(PORT, () => console.log(`fake providers on ${ORIGIN}`));

// Yahoo's CalDAV server has an origin of its own.
createServer((req, res) => {
  yahoo(req, res).catch((error) => send(res, 500, { error: String(error?.message ?? error) }));
}).listen(YAHOO_PORT, () => console.log(`fake Yahoo CalDAV on ${YAHOO_ORIGIN}`));
