import type { MetadataRoute } from 'next';

// What search engines are told, per host. One deployment serves two sites (see next.config.ts):
//
//   koyomi.guru, www.koyomi.guru   the landing page, Privacy and Terms: the pages worth indexing.
//                                  robots.txt points at the sitemap.
//   app.koyomi.guru                the calendar. Crawlable as before, but it has no sitemap of its
//                                  own; /sitemap.xml there redirects to koyomi.guru's.
//   anything else                  Vercel addresses, localhost: kept out of search entirely, so a
//                                  deployment URL never competes with koyomi.guru.

export const SITE_URL = 'https://koyomi.guru';

export type HostKind = 'site' | 'app' | 'other';

/** Which of the deployment's sites a Host header names. A port, if any, is ignored. */
export function hostKind(host: string | null | undefined): HostKind {
  const name = (host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  if (name === 'koyomi.guru' || name === 'www.koyomi.guru') return 'site';
  if (name === 'app.koyomi.guru') return 'app';
  return 'other';
}

/** The public pages of koyomi.guru. The landing page is served at "/" there. */
export const SITEMAP: MetadataRoute.Sitemap = [
  { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
  { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
];

export function robotsFor(host: string | null | undefined): MetadataRoute.Robots {
  switch (hostKind(host)) {
    case 'site':
      return { rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: `${SITE_URL}/sitemap.xml` };
    case 'app':
      return { rules: { userAgent: '*', allow: '/', disallow: '/api/' } };
    default:
      return { rules: { userAgent: '*', disallow: '/' } };
  }
}
