import type { Metadata } from 'next';
import Kayomi from '@/components/Kayomi';
import { connectionsConfigured } from '@/lib/server/env';

// The calendar. Its tab title and install details live here rather than in the shared layout,
// so the landing page (app/home) is not offered for installation.
export const metadata: Metadata = {
  title: 'Koyomi',
  description: 'A calm planning calendar. Calendar is scheduled time; Plan is what waits for time.',
  applicationName: 'Koyomi',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Koyomi', statusBarStyle: 'default' },
};

export default function Page() {
  // Decided when the site is built: whether this deployment has what calendar connections
  // need. Without it the calendar is exactly what it was, and never asks the server anything.
  return <Kayomi calendars={connectionsConfigured()} />;
}
