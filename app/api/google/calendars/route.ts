import { listAccounts } from '@/lib/server/listing';

// The address the calendar used for this before accounts at more than one provider could be
// connected. It answers as /api/calendars does, for a copy of the app loaded before then, with
// the Google accounts alone: that copy knows no other kind, and could neither show nor end one.
export const dynamic = 'force-dynamic';
export const GET = () => listAccounts('google');
