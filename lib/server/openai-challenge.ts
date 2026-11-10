// OpenAI's domain verification for a public ChatGPT plugin: OpenAI's portal gives a token, and the
// MCP server's host must answer https://<host>/.well-known/openai-apps-challenge with exactly that
// token, as plain text (developers.openai.com/plugins/deploy/submission). Koyomi's MCP host is
// app.koyomi.guru (next.config.ts rewrites the well-known path here).
//
// The token comes from one server setting and nothing else. Unset, empty, or not a plain token,
// the address is not there at all: a 404 with nothing in it, the same as any address Koyomi does not
// serve. Nothing else from the settings is ever read or said here.

/** The server setting holding the token. Set only when OpenAI's portal issues one. */
export const CHALLENGE_SETTING = 'OPENAI_APPS_CHALLENGE';

/** What a token may be: printable characters with no spaces, and not absurdly long. */
const TOKEN = /^[\x21-\x7e]{1,512}$/;

/** The token to serve, or null. Surrounding white space (a pasted line break) is not part of it. */
export function challengeToken(env: Record<string, string | undefined> = process.env): string | null {
  const token = env[CHALLENGE_SETTING]?.trim() ?? '';
  return TOKEN.test(token) ? token : null;
}

const notHere = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

/** The answer to the challenge address: the token alone, as plain text, or a 404. */
export function challengeResponse(env: Record<string, string | undefined> = process.env, method = 'GET'): Response {
  const token = challengeToken(env);
  if (!token) return notHere();
  const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  return new Response(method === 'HEAD' ? null : token, { status: 200, headers });
}
