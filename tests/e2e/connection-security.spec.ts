import { expect, type Page } from '@playwright/test';
import { FAKE, actAs, cached, closeDrawer, connect, external, google, ist, openCalendars, refresh, refreshAndHold, signInOnly, start, test, toggle, view } from './connected';
import { addEvent, event, plan, stored } from './helpers';

// The parts of a calendar connection that are about trust rather than calendars: who is signed
// in, what a return from Google is allowed to do, where a redirect may lead, and how much one
// person may ask. Run against stand-ins for 6Away Auth and Google, like everything else.

const APP = 'http://localhost:4310';
const session = async (page: Page) => (await page.context().cookies(APP)).find((cookie) => cookie.name === 'koyomi_session');
const consents = async (id: string) => (await google.asked(id)).log.filter((entry) => entry.type === 'consent').length;
const endSession = (page: Page) => page.context().clearCookies({ name: 'koyomi_session' });

test.describe('a sign-in that has ended is not a connection that is lost', () => {
  test('it asks for sign-in, keeps what was read, and carries on afterwards without asking Google', async ({ page, id }) => {
    await start(page);
    await connect(page);
    await endSession(page);
    const askedBefore = (await google.asked(id)).log.length;
    await refresh(page);

    // Said as what it is: sign in. Not "reconnect", and no way to Google's consent screen.
    await expect(view(page)).toContainText('Sign in again to keep Google Calendar up to date');
    await expect(view(page).getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText(/reconnect/i)).toHaveCount(0);
    await expect(view(page).getByRole('button', { name: 'Reconnect' })).toHaveCount(0);
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBe('signin');
    // What was read is still there, and so are the calendars and the choice of them.
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-checked', 'true');
    // Signed out, the server cannot ask Google anything, and did not.
    expect((await google.asked(id)).log.length).toBe(askedBefore);

    await closeDrawer(page);
    await expect(page.getByRole('button', { name: 'Sign in again to update Google Calendar' })).toBeVisible();
    await page.keyboard.press('p');
    await expect(plan(page).getByRole('button', { name: 'Calendars · sign in again' })).toBeVisible();
    await page.keyboard.press('p');
    // Koyomi itself does not care.
    await addEvent(page, 'My own event', '17:00', '2026-10-07');

    // Meanwhile something changes at Google.
    await google.changes(id, { calendarId: 'me@example.test', upsert: [{ id: 'new', summary: 'Added meanwhile', start: { dateTime: ist('2026-10-07', '19:00') }, end: { dateTime: ist('2026-10-07', '20:00') } }] });

    // Sign in: back on the calendar, connected, with no visit to Google's consent screen.
    await page.getByRole('button', { name: 'Sign in again to update Google Calendar' }).click();
    await view(page).getByRole('button', { name: 'Sign in' }).click();
    await expect(external(page, 'Added meanwhile')).toBeVisible({ timeout: 15_000 });
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByText(/sign in again|reconnect/i)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBe('connected');
    expect(await consents(id)).toBe(1);
    expect((await google.asked(id)).log.filter((entry) => entry.type === 'grant')).toHaveLength(1);
    await expect(event(page, 'My own event')).toBeVisible();
    await openCalendars(page);
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  test('Google refusing the permission asks to reconnect, and does not ask for sign-in', async ({ page, id }) => {
    await start(page);
    await connect(page);
    await google.becomes(id, { revoked: true });
    await refresh(page);

    await expect(view(page)).toContainText('Google Calendar needs reconnecting');
    await expect(view(page).getByRole('button', { name: 'Reconnect' })).toBeVisible();
    await expect(page.getByText(/sign in/i)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBe('reconnect');
    // Still signed in: it is Google that said no.
    expect(await session(page)).toBeTruthy();
  });

  test('when both have happened, sign-in comes first and Google is asked only once it is known to be needed', async ({ page, id }) => {
    await start(page);
    await connect(page);
    await google.becomes(id, { revoked: true });
    await endSession(page);
    await refresh(page);
    // All the server can say to someone it does not know is: sign in.
    await expect(view(page)).toContainText('Sign in again to keep Google Calendar up to date');
    await expect(page.getByText(/reconnect/i)).toHaveCount(0);

    await view(page).getByRole('button', { name: 'Sign in' }).click();
    // Signed in, the reading finds that Google has withdrawn the permission.
    await expect(page.getByRole('button', { name: 'Google Calendar needs reconnecting' })).toBeVisible({ timeout: 15_000 });
    expect(await consents(id)).toBe(1);
    await expect(external(page, 'Dentist')).toBeVisible();

    await page.getByRole('button', { name: 'Google Calendar needs reconnecting' }).click();
    await view(page).getByRole('button', { name: 'Reconnect' }).click();
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toBeVisible({ timeout: 15_000 });
    expect(await consents(id)).toBe(2);
  });

  test('the connection stays with the person: someone else signing in here gets nothing of it', async ({ page, id }) => {
    await start(page);
    await connect(page);
    await endSession(page);
    await refresh(page);

    // A different person signs in on this device.
    await actAs(page, `someone-else-${id}`);
    await view(page).getByRole('button', { name: 'Sign in' }).click();
    // They have no connection, so this device lets go of the first person's events.
    await expect(page.locator('[data-external]')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();
    await expect.poll(() => page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
    await openCalendars(page);
    await expect(view(page).getByRole('button', { name: 'Connect' })).toBeVisible();
    // Nothing was revoked or deleted on the first person's behalf.
    expect((await google.asked(id)).revoked).toBe(false);

    // The first person comes back: their connection is exactly where it was. No consent screen.
    await endSession(page);
    await actAs(page, `user-${id}`);
    await view(page).getByRole('button', { name: 'Connect' }).click();
    await expect(toggle(page, 'Personal')).toBeVisible({ timeout: 15_000 });
    await expect(external(page, 'Dentist')).toBeVisible();
    expect(await consents(id)).toBe(1);
  });
});

test.describe('signing out', () => {
  test('ends the session here, by way of 6Away, and leaves the Google connection where it was', async ({ page, id }) => {
    await start(page);
    await connect(page);
    const askedBefore = (await google.asked(id)).log.length;

    await page.goto('/api/auth/signout');
    // To 6Away and back to the calendar, with nobody signed in.
    await expect(page.getByText('koyomi', { exact: true })).toBeVisible();
    expect(page.url()).toBe(`${APP}/`);
    expect(await session(page)).toBeUndefined();
    expect((await page.request.get('/api/google/calendars')).status()).toBe(401);

    // It is the sign-in that ended. What was read is still here, and Google heard nothing of it.
    await expect(external(page, 'Dentist')).toBeVisible();
    await refresh(page);
    await expect(view(page)).toContainText('Sign in again to keep Google Calendar up to date');
    await expect(page.getByText(/reconnect/i)).toHaveCount(0);
    const after = await google.asked(id);
    expect(after.revoked).toBe(false);
    expect(after.log.length).toBe(askedBefore);

    // Signing in again finds the connection as it was: no consent screen.
    await view(page).getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/sign in again/i)).toHaveCount(0, { timeout: 15_000 });
    await openCalendars(page);
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(await consents(id)).toBe(1);
  });

  test('goes only to 6Away, and back only to the app, whatever the request says', async ({ page }) => {
    const out = async (path: string, method: 'get' | 'post' = 'get', headers?: Record<string, string>) => {
      const response = await page.request[method](path, { maxRedirects: 0, headers });
      expect(response.status(), path).toBe(303);
      return new URL(response.headers().location);
    };

    await signInOnly(page);
    const signedIn = await out('/api/auth/signout?post_logout_redirect_uri=https://evil.example&returnTo=//evil.example', 'get', { host: 'evil.example' });
    expect(signedIn.origin + signedIn.pathname).toBe(`${FAKE}/idp/oauth/logout`);
    expect(signedIn.searchParams.get('post_logout_redirect_uri')).toBe(APP);
    // 6Away is told whose session to end, and nothing else is added.
    expect([...signedIn.searchParams.keys()]).toEqual(['client_id', 'post_logout_redirect_uri', 'id_token_hint']);
    expect(await session(page)).toBeUndefined();

    // With nobody signed in it answers the same way, with nobody to name.
    const nobody = await out('/api/auth/signout', 'post');
    expect(nobody.origin + nobody.pathname).toBe(`${FAKE}/idp/oauth/logout`);
    expect([...nobody.searchParams.keys()]).toEqual(['client_id', 'post_logout_redirect_uri']);
    expect(nobody.searchParams.get('post_logout_redirect_uri')).toBe(APP);
  });
});

/** The steps of the consent round trip, taken one at a time so each can be tampered with. */
const flow = {
  /** Presses Connect as far as the redirect to Google. The sealed cookie is now in the browser. */
  async begin(page: Page) {
    const response = await page.request.get('/api/google/connect', { maxRedirects: 0 });
    const to = new URL(response.headers().location);
    return { to, state: to.searchParams.get('state')! };
  },
  /** Google's screen, answered. Returns the address Google sends the browser back to. */
  async consent(page: Page, to: URL) {
    const back = new URL((await page.request.get(to.href, { maxRedirects: 0 })).headers().location);
    return { back, code: back.searchParams.get('code')! };
  },
  /** Arrives back at Koyomi. Returns how Koyomi says it went. */
  async finish(page: Page, back: URL | string) {
    const response = await page.request.get(String(back), { maxRedirects: 0 });
    const home = new URL(response.headers().location);
    expect(home.origin + home.pathname).toBe(`${APP}/`);
    return home.searchParams.get('calendars');
  },
};
const flowCookie = async (page: Page) => (await page.context().cookies(`${APP}/api/google/callback`)).find((cookie) => cookie.name === 'koyomi_google_oauth');

test.describe('the round trip to Google', () => {
  test('is remembered in a sealed cookie that page code cannot read, and that is gone once used', async ({ page }) => {
    await signInOnly(page);
    const first = await flow.begin(page);
    expect(first.to.origin + first.to.pathname).toBe(`${FAKE}/google/o/oauth2/v2/auth`);
    // 128 random bits of state, and a PKCE challenge, both new for every attempt.
    expect(Buffer.from(first.state, 'base64url')).toHaveLength(16);
    expect(first.to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(Buffer.from(first.to.searchParams.get('code_challenge')!, 'base64url')).toHaveLength(32);

    const cookie = (await flowCookie(page))!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/google' });
    const lifetime = cookie.expires - Date.now() / 1000;
    expect(lifetime).toBeGreaterThan(500);
    expect(lifetime).toBeLessThanOrEqual(601);
    // Sealed: neither the state nor anything else can be read out of it.
    expect(cookie.value).not.toContain(first.state);
    expect(cookie.value).toMatch(/^v1\./);
    // Not sent with the app's pages, and not visible to their scripts.
    expect((await page.context().cookies(`${APP}/`)).some((c) => c.name === 'koyomi_google_oauth')).toBe(false);
    expect(await page.evaluate(() => document.cookie)).not.toContain('koyomi_google_oauth');

    const second = await flow.begin(page);
    expect(second.state).not.toBe(first.state);
    expect(second.to.searchParams.get('code_challenge')).not.toBe(first.to.searchParams.get('code_challenge'));

    const { back } = await flow.consent(page, second.to);
    expect(await flow.finish(page, back)).toBe('connected');
    expect(await flowCookie(page)).toBeUndefined();
  });

  test('a return is honoured once: the same address a second time does nothing', async ({ page, id }) => {
    await signInOnly(page);
    const { to } = await flow.begin(page);
    const { back, code } = await flow.consent(page, to);
    expect(await flow.finish(page, back)).toBe('connected');
    // Google redeemed the code for this app, this address, and the secret behind the challenge.
    expect((await google.asked(id)).log.find((entry) => entry.type === 'grant')).toMatchObject({
      pkce: 'verified',
      client_id: 'google-test',
      redirect_uri: `${APP}/api/google/callback`,
    });

    expect(await flow.finish(page, back)).toBe('failed');
    expect(await flow.finish(page, back)).toBe('failed');
    // The code was presented to Google exactly once.
    expect(await google.exchanges(code)).toEqual([{ code, refused: null }]);
    // And the connection made the first time is untouched.
    expect((await page.request.get('/api/google/calendars')).status()).toBe(200);
  });

  test('a return with the wrong state is refused, the code is never redeemed, and the attempt is spent', async ({ page }) => {
    await signInOnly(page);
    const { to } = await flow.begin(page);
    const { back, code } = await flow.consent(page, to);

    for (const state of ['', 'AAAAAAAAAAAAAAAAAAAAAA', `${back.searchParams.get('state')}x`]) {
      const forged = new URL(back);
      forged.searchParams.set('state', state);
      expect(await flow.finish(page, forged), `state "${state}"`).toBe('failed');
    }
    const stateless = new URL(back);
    stateless.searchParams.delete('state');
    expect(await flow.finish(page, stateless)).toBe('failed');
    // One wrong try was enough to use the attempt up: the right address no longer works either.
    expect(await flow.finish(page, back)).toBe('failed');
    expect(await google.exchanges(code)).toEqual([]);
    expect((await page.request.get('/api/google/calendars')).status()).toBe(409);
  });

  test('a return in a browser that did not start it is refused', async ({ page, browser, id }) => {
    await signInOnly(page);
    const { to } = await flow.begin(page);
    const { back, code } = await flow.consent(page, to);

    // Someone is sent this address, in their own browser, signed in as themselves.
    const theirs = await browser.newContext();
    await theirs.addCookies([{ name: 'fake_user', value: `victim-${id}`, url: FAKE }]);
    const victim = await theirs.newPage();
    await signInOnly(victim);
    expect(await flow.finish(victim, back)).toBe('failed');
    // Even after starting an attempt of their own, the other one's state does not fit it.
    await flow.begin(victim);
    expect(await flow.finish(victim, back)).toBe('failed');
    expect(await google.exchanges(code)).toEqual([]);
    // They did not end up connected to the first person's Google account.
    expect((await victim.request.get('/api/google/calendars')).status()).toBe(409);
    await theirs.close();
  });

  test('a return is refused if someone else has signed in since it started, or nobody is signed in', async ({ page, id }) => {
    await signInOnly(page);
    const started = await flow.begin(page);
    const { back, code } = await flow.consent(page, started.to);
    await endSession(page);
    await actAs(page, `someone-else-${id}`);
    await signInOnly(page);
    expect(await flow.finish(page, back)).toBe('failed');
    expect(await google.exchanges(code)).toEqual([]);
    expect((await page.request.get('/api/google/calendars')).status()).toBe(409);

    await endSession(page);
    await actAs(page, `user-${id}`);
    await signInOnly(page);
    const again = await flow.begin(page);
    const second = await flow.consent(page, again.to);
    await endSession(page);
    expect(await flow.finish(page, second.back)).toBe('failed');
    expect(await google.exchanges(second.code)).toEqual([]);
  });

  test('a return with no attempt behind it is refused', async ({ page }) => {
    await signInOnly(page);
    expect(await flow.finish(page, `${APP}/api/google/callback?code=made-up&state=made-up`)).toBe('failed');
    expect(await flow.finish(page, `${APP}/api/google/callback?code=made-up`)).toBe('failed');
    expect(await flow.finish(page, `${APP}/api/google/callback`)).toBe('failed');
    expect(await google.exchanges('made-up')).toEqual([]);
  });
});

test.describe('redirects', () => {
  test('lead only to the app itself, to 6Away, or to Google, whatever the request says', async ({ page }) => {
    const location = async (path: string, headers?: Record<string, string>) => (await page.request.get(path, { maxRedirects: 0, headers })).headers().location;

    // Signed out, Connect goes to sign-in on the app's own address, and nowhere a parameter names.
    const signin = `${APP}/api/auth/signin?returnTo=${encodeURIComponent('/api/google/connect?signed=1')}`;
    for (const path of ['/api/google/connect', '/api/google/connect?returnTo=https://evil.example', '/api/google/connect?redirect_uri=https://evil.example&next=//evil.example']) {
      expect(await location(path), path).toBe(signin);
    }
    // A forged Host header changes nothing: addresses are built from the server's own setting.
    expect(await location('/api/google/connect', { host: 'evil.example' })).toBe(signin);
    // The way back from Google ends at the app, with one of a few fixed words.
    for (const path of ['/api/google/callback?error=access_denied&redirect=https://evil.example', '/api/google/callback?error=x&calendars=https://evil.example']) {
      expect(await location(path), path).toBe(`${APP}/?calendars=cancelled`);
    }
    expect(await location('/api/google/callback?code=x&state=y', { host: 'evil.example' })).toBe(`${APP}/?calendars=failed`);

    // After signing in, a "return to" that is not a path on this site is ignored.
    for (const target of ['https://evil.example/', '//evil.example/', '/\\evil.example', 'javascript:alert(1)']) {
      await endSession(page);
      await page.goto(`/api/auth/signin?returnTo=${encodeURIComponent(target)}`);
      await expect(page.getByText('koyomi', { exact: true })).toBeVisible();
      expect(page.url(), target).toBe(`${APP}/`);
    }

    // Signed in, Connect sends the browser to Google with the app's own callback and nothing else.
    const google = new URL(await location('/api/google/connect?redirect_uri=https://evil.example', { host: 'evil.example' }));
    expect(google.origin + google.pathname).toBe(`${FAKE}/google/o/oauth2/v2/auth`);
    expect(google.searchParams.get('redirect_uri')).toBe(`${APP}/api/google/callback`);
  });
});

test.describe('a word in the app’s own address', () => {
  test('cannot disconnect anything: only a Disconnect pressed in this tab can', async ({ page, id }) => {
    await start(page);
    await connect(page);
    // A link from anywhere, opened by someone who is connected and signed in.
    await page.goto('/?calendars=disconnect');
    await expect(external(page, 'Dentist')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    // A full reading later, everything is as it was.
    await refresh(page);
    await expect(toggle(page, 'Personal')).toHaveAttribute('aria-checked', 'true');
    expect((await google.asked(id)).revoked).toBe(false);
    expect(await session(page)).toBeTruthy();
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBe('connected');
    expect((await google.asked(id)).log.some((entry) => entry.type === 'revoke')).toBe(false);
  });

  test('cannot make the app believe a calendar is connected', async ({ page }) => {
    const untouched = async () => {
      expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBeNull();
      expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'kayomi', version: 1 }]);
      await expect(page.getByText(/sign in again|reconnect/i)).toHaveCount(0);
    };
    // Someone who has never connected anything follows a link.
    await start(page);
    for (const word of ['resume', 'disconnect']) {
      await page.goto(`/?calendars=${word}`);
      await expect(page.getByText('koyomi', { exact: true })).toBeVisible();
      expect(new URL(page.url()).search).toBe('');
      await untouched();
    }
    // "connected" makes the app ask the server, which says no. Nothing is remembered.
    await page.goto('/?calendars=connected');
    await expect(view(page).getByRole('button', { name: 'Connect' })).toBeVisible();
    await untouched();
    // The same for someone signed in who has no connection.
    await signInOnly(page);
    await page.goto('/?calendars=connected');
    await expect(view(page).getByRole('button', { name: 'Connect' })).toBeVisible();
    await untouched();
    await page.reload();
    await expect(page.getByText('koyomi', { exact: true })).toBeVisible();
    await untouched();
  });
});

test.describe('cookies and answers', () => {
  test('the session is a cookie page code cannot read, sent only over a secure connection', async ({ page }) => {
    await start(page);
    await connect(page);
    const cookie = (await session(page))!;
    // Lax, not Strict: the way back from 6Away and from Google is a link from another site.
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/', domain: 'localhost' });
    const days = (cookie.expires - Date.now() / 1000) / 86400;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
    // The cookies that carried the sign-in round trip are gone.
    const left = (await page.context().cookies(APP)).map((c) => c.name).filter((name) => !name.startsWith('fake_'));
    expect(left).toEqual(['koyomi_session']);
    expect(await page.evaluate(() => document.cookie.split('; ').filter((c) => !c.startsWith('fake_')))).toEqual([]);
  });

  test('an answer that is not data is one fixed word, and never a message, a token or a stack', async ({ page, id }) => {
    const origin = { origin: APP };
    const ask = { timeMin: '2026-10-01T00:00:00Z', timeMax: '2026-11-01T00:00:00Z', calendars: [{ calendarId: 'me@example.test', syncToken: null }] };
    const answers: [number, string][] = [];
    const note = async (response: Promise<{ status(): number; text(): Promise<string> }>) => {
      const r = await response;
      answers.push([r.status(), await r.text()]);
    };

    await note(page.request.get('/api/google/calendars'));
    await note(page.request.post('/api/google/events', { data: ask, headers: origin }));
    await signInOnly(page);
    await note(page.request.get('/api/google/calendars'));
    await start(page);
    await connect(page);
    await note(page.request.post('/api/google/events', { data: ask }));
    await note(page.request.post('/api/google/events', { data: { nonsense: true }, headers: origin }));
    await note(page.request.post('/api/google/events', { data: 'not json at all', headers: { ...origin, 'content-type': 'application/json' } }));
    await google.becomes(id, { fail: 'unavailable' });
    await note(page.request.post('/api/google/events', { data: ask, headers: origin }));
    await google.becomes(id, { fail: null, revoked: true });
    await note(page.request.post('/api/google/events', { data: ask, headers: origin }));

    expect(answers).toEqual([
      [401, '{"error":"signed_out"}'],
      [401, '{"error":"signed_out"}'],
      [409, '{"error":"not_connected"}'],
      [403, '{"error":"bad_request"}'],
      [400, '{"error":"bad_request"}'],
      [400, '{"error":"bad_request"}'],
      [503, '{"error":"busy"}'],
      [409, '{"error":"reconnect"}'],
    ]);
  });
});

test.describe('requests from another site', () => {
  test('cannot disconnect, read or change anything, even with the session cookie attached', async ({ page, id }) => {
    await start(page);
    await connect(page);

    // A page somewhere else gets this browser to send requests to Koyomi, cookies and all.
    const elsewhere = await page.context().newPage();
    await elsewhere.goto(`${FAKE}/__fake/health`);
    const sent = await elsewhere.evaluate(async (app) => {
      const statuses: number[] = [];
      const send = async (path: string, init: RequestInit) => {
        // "no-cors" is how a page that is not allowed to read the answer still gets it sent.
        await fetch(app + path, { credentials: 'include', mode: 'no-cors', ...init }).then(
          () => statuses.push(0),
          () => statuses.push(-1),
        );
      };
      await send('/api/google/disconnect', { method: 'POST', body: '{}' });
      await send('/api/google/disconnect', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
      await send('/api/google/events', { method: 'POST', body: '{}' });
      return statuses.length;
    }, APP);
    expect(sent).toBe(3);
    await elsewhere.close();

    // Nothing happened: still signed in, still connected, nothing revoked at Google.
    expect(await session(page)).toBeTruthy();
    expect((await page.request.get('/api/google/calendars')).status()).toBe(200);
    expect((await google.asked(id)).revoked).toBe(false);
    await refresh(page);
    await expect(external(page, 'Dentist')).toBeVisible();

    // The same requests without a browser's help: the wrong origin, or none, is refused outright.
    for (const headers of [{ origin: 'https://evil.example' }, { origin: FAKE }, { origin: 'null' }, {}] as Record<string, string>[]) {
      expect((await page.request.post('/api/google/disconnect', { data: {}, headers })).status(), JSON.stringify(headers)).toBe(403);
    }
    // Nothing that changes anything answers to a link, an image or a form's GET.
    for (const path of ['/api/google/disconnect', '/api/google/events']) expect((await page.request.get(path)).status(), path).toBe(405);
    expect((await google.asked(id)).revoked).toBe(false);
  });

  test('one person cannot reach, read or end another person’s connection', async ({ page, browser, id }) => {
    await start(page);
    await connect(page);
    const mine = await cached(page);

    const theirs = await browser.newContext();
    await theirs.addCookies([{ name: 'fake_user', value: `stranger-${id}`, url: FAKE }]);
    const stranger = await theirs.newPage();
    await signInOnly(stranger);
    const origin = { origin: APP };
    // Asking by the first person's calendar names gets nothing: there is no parameter that names a person.
    const ask = { timeMin: '2026-10-01T00:00:00Z', timeMax: '2026-11-01T00:00:00Z', calendars: [{ calendarId: 'me@example.test', syncToken: null }] };
    for (const path of ['/api/google/calendars', `/api/google/calendars?subject=user-${id}`, `/api/google/calendars?user=user-${id}&auth_subject=user-${id}`]) {
      expect((await stranger.request.get(path, { headers: { 'x-subject': `user-${id}`, 'x-user': `user-${id}` } })).status(), path).toBe(409);
    }
    expect((await stranger.request.post('/api/google/events', { data: { ...ask, subject: `user-${id}` }, headers: origin })).status()).toBe(409);
    // Their own Disconnect ends their own (nonexistent) connection, and nobody else's.
    expect((await stranger.request.post('/api/google/disconnect', { data: { subject: `user-${id}` }, headers: origin })).status()).toBe(200);
    await theirs.close();

    expect((await google.asked(id)).revoked).toBe(false);
    await refresh(page);
    await expect(external(page, 'Dentist')).toBeVisible();
    expect(await cached(page)).toMatchObject({ events: mine.events.map((e) => ({ id: e.id })) });
    expect((await stored(page)).events).toEqual([]);
  });
});

test.describe('how much one person may ask', () => {
  test('asking far faster than the app would is refused quietly, Google is spared, and nobody else is affected', async ({ page, browser, id }) => {
    test.setTimeout(90_000);
    await start(page);
    await connect(page);
    const before = (await google.asked(id)).log.filter((entry) => entry.type === 'calendars').length;

    // A script with this person's cookie asks for the calendar list 140 times in a row.
    const statuses: number[] = [];
    let refusal: { body: string; retryAfter: string | undefined } | null = null;
    for (let i = 0; i < 140; i++) {
      const response = await page.request.get('/api/google/calendars');
      statuses.push(response.status());
      if (response.status() === 429 && !refusal) refusal = { body: await response.text(), retryAfter: response.headers()['retry-after'] };
    }
    const answered = statuses.filter((status) => status === 200).length;
    // 120 a minute, less the handful connecting used.
    expect(answered).toBeGreaterThan(100);
    expect(answered).toBeLessThanOrEqual(120);
    // Once refused, refused until the minute is up.
    expect(statuses.slice(answered)).toEqual(new Array(140 - answered).fill(429));
    expect(refusal!.body).toBe('{"error":"slow_down"}');
    expect(Number(refusal!.retryAfter)).toBeGreaterThan(0);
    expect(Number(refusal!.retryAfter)).toBeLessThanOrEqual(60);
    // Google was asked only for the ones that were answered.
    expect((await google.asked(id)).log.filter((entry) => entry.type === 'calendars').length - before).toBe(answered);
    // Reading events is refused too, and costs Google nothing.
    const events = (await google.asked(id)).log.filter((entry) => entry.type === 'events').length;
    const ask = { timeMin: '2026-10-01T00:00:00Z', timeMax: '2026-11-01T00:00:00Z', calendars: [{ calendarId: 'me@example.test', syncToken: null }] };
    expect((await page.request.post('/api/google/events', { data: ask, headers: { origin: APP } })).status()).toBe(429);
    expect((await google.asked(id)).log.filter((entry) => entry.type === 'events').length).toBe(events);

    // In the app this is not an error: pressing Refresh simply changes nothing, and says nothing.
    await refresh(page);
    await expect(external(page, 'Dentist')).toBeVisible();
    await expect(view(page).getByRole('button', { name: 'Refresh' })).toBeEnabled();
    await expect(page.getByText(/reconnect|sign in|couldn’t|slow|limit|too many/i)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('koyomi-calendars'))).toBe('connected');

    // Someone else, at the same moment, is answered as usual.
    const other = `other${id}`;
    await google.has(other, { calendars: [{ id: 'them@example.test', summary: 'Personal', primary: true, selected: true, events: [] }] });
    const theirs = await browser.newContext({ timezoneId: 'Europe/Istanbul' });
    await theirs.addCookies([
      { name: 'fake_user', value: `user-${other}`, url: FAKE },
      { name: 'fake_google', value: other, url: FAKE },
    ]);
    const them = await theirs.newPage();
    await start(them);
    await connect(them);
    expect((await them.request.get('/api/google/calendars')).status()).toBe(200);
    await theirs.close();
  });

  test('the same question asked many times at once is put to Google once', async ({ page, id }) => {
    await start(page);
    await connect(page);
    // Google takes a moment, so the requests really are waiting together.
    await google.becomes(id, { delay: 500 });
    const count = async (type: string) => (await google.asked(id)).log.filter((entry) => entry.type === type).length;

    const lists = await count('calendars');
    const answers = await Promise.all(Array.from({ length: 8 }, () => page.request.get('/api/google/calendars')));
    expect(answers.map((answer) => answer.status())).toEqual(new Array(8).fill(200));
    const bodies = await Promise.all(answers.map((answer) => answer.text()));
    expect(new Set(bodies).size).toBe(1);
    expect((await count('calendars')) - lists).toBe(1);

    const reads = await count('events');
    const ask = { timeMin: '2026-10-01T00:00:00Z', timeMax: '2026-11-01T00:00:00Z', calendars: [{ calendarId: 'me@example.test', syncToken: null }, { calendarId: 'work@example.test', syncToken: null }] };
    const read = await Promise.all(Array.from({ length: 6 }, () => page.request.post('/api/google/events', { data: ask, headers: { origin: APP } })));
    expect(read.map((answer) => answer.status())).toEqual(new Array(6).fill(200));
    // Two calendars, each read once, not six times.
    expect((await count('events')) - reads).toBe(2);
    // A different question is a different reading.
    await page.request.post('/api/google/events', { data: { ...ask, calendars: ask.calendars.slice(0, 1) }, headers: { origin: APP } });
    expect((await count('events')) - reads).toBe(3);
  });

  test('in the app, asking again while a reading is under way adds one reading, not many', async ({ page, id }) => {
    await start(page);
    await connect(page);
    const lists = (await google.asked(id)).log.filter((entry) => entry.type === 'calendars').length;

    // Refresh, then show another calendar several times over before the first reading is back.
    // Google keeps that reading's first answer until all of it has been asked for.
    await refreshAndHold(page, id, 'calendars');
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    await toggle(page, 'Holidays').click();
    // The choice is saved first and the reading asked for after, so once it is saved it has been asked.
    await expect.poll(async () => (await cached(page)).calendars.find((c) => c.name === 'Holidays').visible).toBe(true);
    await google.becomes(id, { hold: null });
    await expect(external(page, 'Republic Day')).toBeVisible({ timeout: 15_000 });
    // The reading that was running, and one more after it: two, however many times it was asked.
    // The second begins a moment after the first ends, so it is waited for by what it asks, not
    // by the word on the button, which is briefly "Refresh" in between.
    const readings = async () => (await google.asked(id)).log.filter((entry) => entry.type === 'calendars').length - lists;
    await expect.poll(readings, { timeout: 15_000 }).toBe(2);
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0, { timeout: 15_000 });
    expect(await readings()).toBe(2);
  });

  test('showing one more calendar reads that calendar and nothing else', async ({ page, id }) => {
    await start(page);
    await connect(page);
    const before = (await google.asked(id)).log.length;
    await toggle(page, 'Holidays').click();
    await expect(external(page, 'Republic Day')).toBeVisible();
    await expect(view(page).getByText('Refreshing…')).toHaveCount(0);
    expect((await google.asked(id)).log.slice(before).map((entry) => `${entry.type} ${entry.calendarId ?? ''}`.trim())).toEqual(['events holidays@example.test']);
  });

  test('only what the app itself would ask for is accepted', async ({ page }) => {
    await start(page);
    await connect(page);
    const ask = { timeMin: '2026-09-01T21:00:00.000Z', timeMax: '2027-04-14T21:00:00.000Z', calendars: [{ calendarId: 'me@example.test', syncToken: null }] };
    const status = async (body: unknown) => (await page.request.post('/api/google/events', { data: body, headers: { origin: APP } })).status();
    // The span the app reads is fine...
    expect(await status(ask)).toBe(200);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ calendarId: `c${i}@example.test`, syncToken: null }));
    expect(await status({ ...ask, calendars: many(25) })).toBe(200);
    // ...and anything wider, longer, emptier or stranger is not.
    for (const [why, body] of [
      ['a span of eight months', { ...ask, timeMax: '2027-05-01T00:00:00.000Z' }],
      ['years of history', { ...ask, timeMin: '2015-01-01T00:00:00.000Z' }],
      ['a span that ends before it starts', { ...ask, timeMin: ask.timeMax, timeMax: ask.timeMin }],
      ['26 calendars', { ...ask, calendars: many(26) }],
      ['no calendars', { ...ask, calendars: [] }],
      ['a calendar id of 300 characters', { ...ask, calendars: [{ calendarId: 'x'.repeat(300), syncToken: null }] }],
      ['a calendar id with a line break', { ...ask, calendars: [{ calendarId: 'a\r\nHost: evil.example', syncToken: null }] }],
      ['an empty calendar id', { ...ask, calendars: [{ calendarId: '', syncToken: null }] }],
      ['a cursor that is not text', { ...ask, calendars: [{ calendarId: 'me@example.test', syncToken: { $ne: null } }] }],
      ['a cursor of 5,000 characters', { ...ask, calendars: [{ calendarId: 'me@example.test', syncToken: 'x'.repeat(5000) }] }],
    ] as const) {
      expect(await status(body), why).toBe(400);
    }
  });
});
