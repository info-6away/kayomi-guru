import type { Metadata } from 'next';
import Kayomi from '@/components/Kayomi';
import { connectionsConfigured } from '@/lib/server/env';

// The calendar. Its tab title and install details live here rather than in the shared layout,
// so the landing page (app/home) is not offered for installation.
export const metadata: Metadata = {
  title: 'Koyomi',
  description: 'Calendar, simplified. All your calendars in one quiet place.',
  applicationName: 'Koyomi',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Koyomi', statusBarStyle: 'default' },
};

export default function Page() {
  // Decided when the site is built: whether this deployment has what calendar connections
  // need. Without it there is Koyomi's own calendar and nothing to connect, and the server is
  // never asked anything.
  return <Kayomi calendars={connectionsConfigured()} />;
}
