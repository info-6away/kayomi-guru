import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { robotsFor } from '@/lib/seo';

// Answered per request: the same deployment is koyomi.guru, app.koyomi.guru and its Vercel
// addresses, and each is told something different. See lib/seo.ts.
export default async function robots(): Promise<MetadataRoute.Robots> {
  return robotsFor((await headers()).get('host'));
}
