import type { MetadataRoute } from 'next';
import { SITEMAP } from '@/lib/seo';

// koyomi.guru's pages. Asked of app.koyomi.guru, /sitemap.xml redirects here (next.config.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP;
}
