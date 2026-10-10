import { ThemeToggle } from './ThemeToggle';

const LINK = 'hover:text-ink2';

/**
 * The quiet last line of the landing page and of the two pages it links to. The addresses are
 * plain paths: on koyomi.guru they are these pages, and app.koyomi.guru sends them there
 * (see next.config.ts).
 */
export function SiteFooter({ className }: { className: string }) {
  return (
    <footer className={`${className} flex items-center justify-between gap-4 border-t border-line pt-[22px] pb-8 text-[12px] tracking-[.03em] text-muted`}>
      <span>koyomi.guru</span>
      <div className="flex items-center gap-5">
        <a href="/privacy" className={LINK}>
          Privacy
        </a>
        <a href="/terms" className={LINK}>
          Terms
        </a>
        <ThemeToggle />
      </div>
    </footer>
  );
}
