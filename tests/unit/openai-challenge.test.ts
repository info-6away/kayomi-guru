import { expect, test } from '@playwright/test';
import { CHALLENGE_SETTING, challengeResponse, challengeToken } from '../../lib/server/openai-challenge';

// OpenAI's domain verification (developers.openai.com/plugins/deploy/submission): the MCP host
// answers /.well-known/openai-apps-challenge with exactly the token the portal gave, as plain
// text, read from one server setting. Without a token the address is simply not there.

const TOKEN = 'oai-apps-challenge_0123456789abcdefABCDEF.-~';

test('with the setting, the answer is exactly the token, as plain text, and never kept', async () => {
  const response = challengeResponse({ [CHALLENGE_SETTING]: TOKEN });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(TOKEN);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  // HEAD: the same answer without the body.
  const head = challengeResponse({ [CHALLENGE_SETTING]: TOKEN }, 'HEAD');
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
});

test('a token pasted with a line break or spaces around it is served without them', async () => {
  for (const pasted of [`${TOKEN}\n`, `  ${TOKEN}\r\n`, `\t${TOKEN} `]) {
    expect(await challengeResponse({ [CHALLENGE_SETTING]: pasted }).text(), JSON.stringify(pasted)).toBe(TOKEN);
  }
});

test('without a token, or with something that is not one, the address is not there: a 404 with nothing in it', async () => {
  for (const value of [undefined, '', '   ', '\n', 'two words', 'line\nbreak', 'tab\there', 'é-accented', 'x'.repeat(513), '\u0000nul']) {
    const response = challengeResponse({ [CHALLENGE_SETTING]: value });
    expect(response.status, JSON.stringify(value)).toBe(404);
    expect(await response.text(), JSON.stringify(value)).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(challengeToken({ [CHALLENGE_SETTING]: value })).toBeNull();
  }
  // The longest a token may be is still served.
  expect(await challengeResponse({ [CHALLENGE_SETTING]: 'x'.repeat(512) }).text()).toBe('x'.repeat(512));
});

test('nothing but that one setting is ever read or said', async () => {
  const secrets = {
    TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
    SESSION_SECRET: 'session-secret-value',
    DATABASE_URL: 'postgres://user:password@host/db',
    KOYOMI_MCP_ALLOWLIST: 'subject-1',
    OPENAI_APPS_CHALLENGE_OTHER: 'not-this-one',
  };
  // Without the setting: nothing, whatever else is set.
  const none = challengeResponse(secrets);
  expect([none.status, await none.text()]).toEqual([404, '']);
  // With it: the token and nothing else.
  const body = await challengeResponse({ ...secrets, [CHALLENGE_SETTING]: TOKEN }).text();
  expect(body).toBe(TOKEN);
  for (const value of Object.values(secrets)) expect(body).not.toContain(value);
  // The setting's name is the one documented, and it is not a public (browser) setting.
  expect(CHALLENGE_SETTING).toBe('OPENAI_APPS_CHALLENGE');
  expect(CHALLENGE_SETTING.startsWith('NEXT_PUBLIC_')).toBe(false);
});
