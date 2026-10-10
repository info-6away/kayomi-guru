import type { Metadata } from 'next';
import { SiteFooter } from '@/components/SiteFooter';
import { CAT } from '@/components/ui';
import type { Category } from '@/lib/types';

// The landing page. On koyomi.guru it is served at "/"; see next.config.ts.

const SITE_URL = 'https://koyomi.guru';
const TITLE = 'Koyomi — a calm calendar';
const DESCRIPTION = 'Koyomi holds two things: what has a time, and what doesn’t yet. Nothing else.';

/** Takes the visitor to the calendar: app.koyomi.guru from the live site, this host's "/" anywhere else. */
const OPEN = '/open';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', url: '/', siteName: 'Koyomi', title: TITLE, description: DESCRIPTION },
};

// The sample week is an illustration, not live data.
const HOUR = 40; // height of one hour, in pixels
const HEAD = 100; // room for the day heading above the first hour

/** Title, start, colour, hours below the first row, length in hours. */
type Sample = [title: string, time: string, category: Category, offset: number, hours: number];

const WEEK: { dow: string; num: number; today?: boolean; events: Sample[] }[] = [
  { dow: 'MON', num: 5, today: true, events: [['Gym', '07:30', 'life', 0, 1], ['Project review', '10:00', 'work', 2, 1.5], ['Lunch', '12:30', 'misc', 5, 0.75]] },
  { dow: 'TUE', num: 6, events: [['Bank', '10:00', 'work', 2, 0.75], ['Design work', '14:00', 'focus', 6, 2.5]] },
  { dow: 'WED', num: 7, events: [['Focus', '09:00', 'focus', 1, 2.5]] },
  { dow: 'THU', num: 8, events: [['Team sync', '11:00', 'work', 3, 1]] },
  { dow: 'FRI', num: 9, events: [['Project review', '09:30', 'work', 1.5, 1]] },
  { dow: 'SAT', num: 10, events: [] },
  { dow: 'SUN', num: 11, events: [['Call supplier', '18:00', 'life', 7, 0.5]] },
];

const FEATURES = [
  { label: 'CALENDAR', title: 'Things with a time.', text: 'Click an hour, type, press Enter. That’s an event.' },
  { label: 'PLAN', title: 'Things without one yet.', text: 'A short list beside your week. No projects, no priorities.' },
  { label: 'BETWEEN', title: 'Move one to the other.', text: 'Drag a thought onto an hour. Send it back if the day changes.' },
];

const WRAP = 'mx-auto w-full max-w-[1080px] px-7';
const PILL =
  'flex h-12 flex-none items-center gap-3 rounded-full border border-ink px-6 text-[14px] tracking-[.04em] whitespace-nowrap text-ink transition-colors duration-180 hover:bg-ink hover:text-bg';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col selection:bg-[color-mix(in_oklab,var(--verm)_22%,transparent)]">
      <header className={`${WRAP} flex items-center justify-between gap-4 pt-7`}>
        <div className="flex items-center gap-2.5">
          <span className="size-[9px] rounded-full bg-verm" />
          <span className="pb-0.5 font-mincho text-[21px] leading-none">koyomi</span>
        </div>
        <a href={OPEN} className="flex items-center gap-2 text-[13px] tracking-[.03em] text-ink2 hover:text-ink">
          Open Koyomi <span className="text-[15px]">→</span>
        </a>
      </header>

      <main className="flex-1">
        <section className={`${WRAP} flex flex-col items-start gap-9 pt-[clamp(96px,18vh,180px)] pb-[clamp(72px,12vh,120px)]`}>
          <h1 className="max-w-[13em] font-mincho text-[clamp(40px,6.4vw,76px)] leading-[1.18] font-normal tracking-[-.005em] text-balance">
            A calm calendar for planning your own life.
          </h1>
          <p className="max-w-[30em] text-[17px] leading-[1.85] text-pretty text-ink2">{DESCRIPTION}</p>
          <a href={OPEN} className={PILL}>
            Begin <span>→</span>
          </a>
        </section>

        <section className={WRAP} aria-label="A sample week">
          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-[18px]">
            <span className="font-mincho text-[18px]">5 — 11 October</span>
            <span className="text-[12px] tracking-[.04em] text-muted">A week, with space in it</span>
          </div>
          {/* Three days on a phone, the whole week from 680px. */}
          <div className="mt-[22px] grid grid-cols-3 border-b border-line2 min-[680px]:grid-cols-7">
            {WEEK.map((day, i) => (
              <div
                key={day.dow}
                className={`relative ${i ? 'border-l border-line2' : ''} ${i >= 3 ? 'hidden min-[680px]:block' : ''}`}
                style={{
                  height: HEAD + 8.5 * HOUR,
                  background: i >= 5 ? 'color-mix(in oklab, var(--ink) 2.5%, transparent)' : undefined,
                }}
              >
                <div className="flex flex-col gap-1.5 px-2.5 pt-1 pb-5">
                  <span className={`flex h-3 items-center gap-[7px] text-[10.5px] tracking-[.18em] ${day.today ? 'text-ink' : 'text-muted'}`}>
                    {day.dow}
                    {day.today && <span className="size-[5px] rounded-full bg-verm" />}
                  </span>
                  <span className={`font-mincho text-[26px] leading-none ${day.today ? 'text-verm' : 'text-ink'}`}>{day.num}</span>
                </div>
                {day.events.map(([title, time, category, offset, hours]) => {
                  const height = Math.max(24, hours * HOUR - 2);
                  const tall = height >= 40;
                  return (
                    <div
                      key={title}
                      className={`absolute inset-x-1 flex overflow-hidden rounded-[3px] pr-2 pl-3 ${tall ? 'flex-col items-start gap-px pt-[5px]' : 'items-center gap-2'}`}
                      style={{ top: HEAD + offset * HOUR, height, background: `color-mix(in oklab, ${CAT[category]} 6%, transparent)` }}
                    >
                      <span className="absolute top-1 bottom-1 left-0.5 w-0.5 rounded-[1px]" style={{ background: CAT[category] }} />
                      <span className="max-w-full min-w-0 truncate text-[13px] leading-[1.35] font-medium">{title}</span>
                      <span className="text-[11.5px] text-muted tabular-nums">{time}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <section className={`${WRAP} grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-12 gap-y-14 pt-[clamp(96px,16vh,160px)]`}>
          {FEATURES.map((feature) => (
            <div key={feature.label} className="flex flex-col gap-3.5">
              <span className="text-[11px] tracking-[.2em] text-muted">{feature.label}</span>
              <h2 className="font-mincho text-[24px] leading-[1.4] font-normal">{feature.title}</h2>
              <p className="text-[15px] leading-[1.8] text-pretty text-ink2">{feature.text}</p>
            </div>
          ))}
        </section>

        <section className={`${WRAP} flex flex-col items-center gap-8 pt-[clamp(120px,20vh,200px)] pb-[clamp(96px,16vh,160px)] text-center`}>
          <span className="size-[9px] rounded-full bg-verm" />
          <p className="font-mincho text-[clamp(26px,3.4vw,36px)] leading-[1.5] text-balance">Your day should have space in it.</p>
          <a href={OPEN} className={PILL}>
            Open Koyomi <span>→</span>
          </a>
          <span className="text-[12.5px] tracking-[.02em] text-muted">Free. Works in your browser. Install it on desktop or phone.</span>
        </section>
      </main>

      <SiteFooter className={WRAP} />
    </div>
  );
}
