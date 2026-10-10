import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';

// The Privacy and Terms pages: the landing page's own type, colours and measure, and nothing
// else. They are pages of koyomi.guru, not of the calendar: no manifest, no worker.

export const SITE_URL = 'https://koyomi.guru';
/** Where privacy questions and requests go. The one address both pages give. */
export const CONTACT = 'privacy@6away.ai';
export const OPERATOR = '6Away AI FZE LLC';

const WRAP = 'mx-auto w-full max-w-[1080px] px-7';
const LINK = 'underline decoration-line underline-offset-4 hover:text-ink';

export const legalMetadata = (title: string, description: string, path: string): Metadata => ({
  metadataBase: new URL(SITE_URL),
  title: `${title} — Koyomi`,
  description,
  alternates: { canonical: path },
  openGraph: { type: 'article', url: path, siteName: 'Koyomi', title: `${title} — Koyomi`, description },
});

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col selection:bg-[color-mix(in_oklab,var(--verm)_22%,transparent)]">
      <header className={`${WRAP} flex items-center justify-between gap-4 pt-7`}>
        {/* /home is the landing page on every host: koyomi.guru answers it with "/". */}
        <a href="/home" className="flex items-center gap-2.5" aria-label="Koyomi, home">
          <span className="size-[9px] rounded-full bg-verm" />
          <span className="pb-0.5 font-mincho text-[21px] leading-none">koyomi</span>
        </a>
        <a href="/open" className="flex items-center gap-2 text-[13px] tracking-[.03em] text-ink2 hover:text-ink">
          Open Koyomi <span className="text-[15px]">→</span>
        </a>
      </header>

      <main className={`${WRAP} flex-1 pt-[clamp(64px,12vh,120px)] pb-[clamp(72px,12vh,120px)]`}>
        <article className="max-w-[42em]">
          <h1 className="font-mincho text-[clamp(34px,5vw,52px)] leading-[1.2] font-normal tracking-[-.005em]">{title}</h1>
          <p className="mt-5 text-[11px] tracking-[.2em] text-muted">LAST UPDATED {updated.toUpperCase()}</p>
          <div className="mt-10 flex flex-col gap-5">{children}</div>
        </article>
      </main>

      <SiteFooter className={WRAP} />
    </div>
  );
}

export const H2 = ({ children }: { children: ReactNode }) => <h2 className="mt-9 font-mincho text-[22px] leading-[1.4] font-normal text-ink">{children}</h2>;

export const P = ({ children }: { children: ReactNode }) => <p className="text-[15px] leading-[1.8] text-pretty text-ink2">{children}</p>;

export const List = ({ children }: { children: ReactNode }) => (
  <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-[1.8] text-pretty text-ink2 marker:text-muted">{children}</ul>
);

export const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} className={LINK}>
    {children}
  </a>
);

export const Mail = () => <A href={`mailto:${CONTACT}`}>{CONTACT}</A>;
