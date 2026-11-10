import { challengeResponse } from '@/lib/server/openai-challenge';

export const dynamic = 'force-dynamic';

/** Served at /.well-known/openai-apps-challenge (next.config.ts): OpenAI's domain verification token, or a 404. */
export const GET = () => challengeResponse(process.env, 'GET');
export const HEAD = () => challengeResponse(process.env, 'HEAD');
