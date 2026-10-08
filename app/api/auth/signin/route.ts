import { auth } from '@/lib/server/auth';
import { connectionsConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

/** Sends the visitor to 6Away to sign in. Reached only from "Connect" in Calendars. */
export const GET = (request: Request) => (connectionsConfigured() ? auth.routes.signin(request) : new Response(null, { status: 404 }));
