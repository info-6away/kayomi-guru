import { auth } from '@/lib/server/auth';
import { connectionsConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

/** Where 6Away sends the visitor back. Verifies who they are and starts their session. */
export const GET = (request: Request) => (connectionsConfigured() ? auth.routes.callback(request) : new Response(null, { status: 404 }));
