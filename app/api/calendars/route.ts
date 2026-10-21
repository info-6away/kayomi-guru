import { listAccounts } from '@/lib/server/listing';

export const dynamic = 'force-dynamic';

/**
 * Every account the signed-in person has connected, at any provider, each with the calendars it
 * can see (lib/server/listing.ts). Someone with nothing connected gets an empty list.
 */
export const GET = () => listAccounts();
