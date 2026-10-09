import { auth } from '@/lib/server/auth';
import { signInConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

/**
 * Ends the Koyomi session on this device, then hands the visitor to 6Away to end theirs there.
 * It does not disconnect Google Calendar: the connection and what was already read stay, and
 * signing in again carries on. Nothing in the app leads here yet.
 */
const signout = () => (signInConfigured() ? auth.routes.signout() : new Response(null, { status: 404 }));

export const GET = signout;
export const POST = signout;
