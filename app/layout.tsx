import type { Viewport } from 'next';
import { Shippori_Mincho, Zen_Kaku_Gothic_New } from 'next/font/google';
import { THEME_BG, themeBootScript, themeBootStyle } from '@/lib/theme';
import './globals.css';

// One call per weight, on purpose. Each weight of these families comes as about 120 slices, most of
// them unlabelled Japanese ranges, and when two weights share a call next/font takes the second
// weight's slices for "latin" and preloads all of them: hundreds of font requests on every visit.
// Loaded one weight at a time, only the Latin slice of each is preloaded; the rest load when needed.
const mincho = Shippori_Mincho({ weight: '400', subsets: ['latin'], variable: '--font-shippori', display: 'swap' });
const gothic = Zen_Kaku_Gothic_New({ weight: '400', subsets: ['latin'], variable: '--font-zen', display: 'swap' });
const gothicMedium = Zen_Kaku_Gothic_New({ weight: '500', subsets: ['latin'], variable: '--font-zen-medium', display: 'swap' });

// Shared by the calendar (app/page.tsx) and the landing page (app/home). Each sets its own title.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_BG.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_BG.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The boot script sets data-theme before React loads, so the attribute differs from the server's.
    <html lang="en" className={`${mincho.variable} ${gothic.variable} ${gothicMedium.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <style dangerouslySetInnerHTML={{ __html: themeBootStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
