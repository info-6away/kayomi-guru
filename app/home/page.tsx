import type { Metadata } from 'next';
import { TypedLine } from '@/components/TypedLine';
import { CAT } from '@/components/ui';

// The landing page. On koyomi.guru it is served at "/"; see next.config.ts.

const SITE_URL = 'https://koyomi.guru';
const TITLE = 'Koyomi — All your calendars. One quiet place.';
const DESCRIPTION = 'Koyomi brings Google, Microsoft, Yahoo and private calendar links together in one calm calendar.';

/** Takes the visitor to the calendar: app.koyomi.guru from the live site, this host's "/" anywhere else. */
const OPEN = '/open';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', url: '/', siteName: 'Koyomi', title: TITLE, description: DESCRIPTION },
};

// The sample week is an illustration, not live data. It is drawn the way the calendar draws a week:
// an event from a connected calendar is an outline with a grey bar, and only Koyomi's own event,
// written on this device, has a colour. Nothing is coloured by account, here or in the app.
const START = 8;
const END = 19;

type Source = 'koyomi' | 'personal' | 'work' | 'microsoft' | 'yahoo' | 'family';

/** The calendars the sample week is read from, in the order the Calendars pane lists them: Koyomi first. */
const SOURCES: { id: Source; name: string; kind: string }[] = [
  { id: 'koyomi', name: 'Koyomi', kind: 'This device' },
  { id: 'personal', name: 'Personal', kind: 'Google' },
  { id: 'work', name: 'Work', kind: 'Google' },
  { id: 'microsoft', name: 'Microsoft 365', kind: 'Microsoft' },
  { id: 'yahoo', name: 'Yahoo', kind: 'Yahoo' },
  { id: 'family', name: 'Family', kind: 'Link' },
];

/** Title, start and length in hours, and the calendar it comes from. */
type Sample = [title: string, start: number, hours: number, source: Source];

/**
 * Five days. A phone shows today alone, a narrower screen the first four, a wide one all five.
 * Each day's classes are written out whole, so the stylesheet can find them.
 */
const DAYS: { dow: string; num: number; today?: boolean; head: string; column: string; events: Sample[] }[] = [
  { dow: 'MON', num: 9, head: 'hidden min-[720px]:flex', column: 'hidden min-[720px]:block', events: [['Team check-in', 9.5, 0.5, 'work'], ['Gym', 17.5, 1, 'personal']] },
  {
    dow: 'TUE',
    num: 10,
    today: true,
    head: 'flex',
    column: 'block min-[720px]:border-l',
    events: [['Dentist', 10, 1, 'personal'], ['Team lunch', 12.5, 1, 'koyomi'], ['School pickup', 15.25, 0.5, 'family']],
  },
  { dow: 'WED', num: 11, head: 'hidden min-[720px]:flex', column: 'hidden min-[720px]:block border-l', events: [['Quarterly review', 11, 1.5, 'microsoft']] },
  { dow: 'THU', num: 12, head: 'hidden min-[720px]:flex', column: 'hidden min-[720px]:block border-l', events: [['Flight to Istanbul', 14, 3, 'yahoo']] },
  { dow: 'FRI', num: 13, head: 'hidden min-[1000px]:flex', column: 'hidden min-[1000px]:block border-l', events: [] },
];

/** The hours down the side, and the days across: one day on a phone, four from 720px, five from 1000px. */
const GRID =
  'grid grid-cols-[46px_minmax(0,1fr)] min-[720px]:grid-cols-[50px_repeat(4,minmax(0,1fr))] min-[1000px]:grid-cols-[50px_repeat(5,minmax(0,1fr))]';

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (hours: number) => `${pad(Math.floor(hours))}:${pad(Math.round((hours % 1) * 60))}`;

const WRAP = 'mx-auto w-full max-w-[1040px] px-6';
const SECTION = `${WRAP} pt-[clamp(96px,15vh,150px)]`;
const PAIR = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-x-16 gap-y-10';
const H2 = 'font-mincho text-[clamp(28px,3.4vw,38px)] leading-[1.3] font-normal';
const BODY = 'text-[16px] leading-[1.8] text-ink2';
const PILL =
  'flex h-[46px] flex-none items-center gap-3 rounded-full border border-ink px-6 text-[14px] tracking-[.04em] whitespace-nowrap text-ink transition-colors duration-200 hover:bg-ink hover:text-bg';

/** Every way a calendar comes into Koyomi, as the page names them. */
const PROVIDERS = [
  { name: 'Google Calendar', note: 'Multiple accounts' },
  { name: 'Microsoft Outlook', note: 'Personal, work and school where permitted' },
  { name: 'Yahoo Calendar', note: 'Read-only connection' },
  { name: 'Calendar Link', note: 'Private published calendars' },
];

const MANY = [
  { name: 'Personal Google', via: 'GOOGLE' },
  { name: 'Work Google', via: 'GOOGLE' },
  { name: 'Microsoft 365', via: 'MICROSOFT' },
  { name: 'Yahoo', via: 'YAHOO' },
  { name: 'Family calendar', via: 'CALENDAR LINK' },
  { name: 'Published work calendar', via: 'CALENDAR LINK' },
];

function SampleEvent({ event: [title, start, hours, source] }: { event: Sample }) {
  const own = source === 'koyomi';
  // Tall enough for a second line, at either hour height: the time goes under the title.
  const tall = hours >= 1.5;
  return (
    <div
      className={`absolute inset-x-1 flex overflow-hidden rounded-[3px] pr-2 pl-3 ${tall ? 'flex-col items-start gap-px pt-[5px]' : 'items-center gap-2'} ${
        own ? '' : 'bg-sheet shadow-[inset_0_0_0_1px_var(--line)]'
      }`}
      style={{
        top: `calc(${start - START} * var(--h) + 1px)`,
        height: `max(26px, calc(${hours} * var(--h) - 2px))`,
        background: own ? `color-mix(in oklab, ${CAT.life} var(--tint), transparent)` : undefined,
      }}
    >
      <span className={`absolute top-1 bottom-1 left-0.5 w-0.5 rounded-[1px] ${own ? '' : 'bg-stone'}`} style={own ? { background: CAT.life } : undefined} />
      <span className={`max-w-full min-w-0 shrink truncate text-[13px] leading-[1.35] ${own ? 'font-medium text-ink' : 'text-ink2'}`}>{title}</span>
      {/* A short event has no room for its time beside the title on a wide screen, as in the design; on a phone it has. */}
      <span className={`flex-none text-[11px] whitespace-nowrap tabular-nums ${own ? 'text-event-time' : 'text-muted'} ${tall ? '' : 'min-[720px]:hidden'}`}>
        {tall ? `${clock(start)} – ${clock(start + hours)}` : clock(start)}
      </span>
    </div>
  );
}

function SampleWeek() {
  const hours = Array.from({ length: END - START - 1 }, (_, i) => START + 1 + i);
  return (
    <section aria-label="Koyomi week view" className={WRAP}>
      {/* One hour is 42px on a phone and 36px wider up; everything in the week is placed by it. */}
      <div className="relative flex flex-col overflow-hidden rounded-[6px] border border-line2 bg-sheet shadow-[0_40px_80px_-48px_var(--shadow)] [--h:42px] min-[720px]:[--h:36px] min-[1000px]:flex-row">
        <div className="min-w-0 flex-1 pt-[22px] pr-[18px] pb-[18px] pl-1.5">
          <div className="flex items-baseline justify-between gap-3 pr-1.5 pb-[18px] pl-4">
            <span className="font-mincho text-[17px]">
              <span className="min-[720px]:hidden">Tuesday 10 November</span>
              <span className="hidden min-[720px]:inline">November</span>
            </span>
            <span className="text-[11px] tracking-[.14em] text-muted">2026</span>
          </div>
          <div className={`${GRID} border-b border-line2`}>
            <div />
            {DAYS.map((day) => (
              <div key={day.dow} className={`${day.head} min-w-0 flex-col gap-1.5 px-2.5 pb-3`}>
                <span className={`flex h-3 items-center gap-[7px] text-[10.5px] tracking-[.18em] ${day.today ? 'text-ink' : 'text-muted'}`}>
                  {day.dow}
                  {day.today && <span className="size-[5px] rounded-full bg-verm" />}
                </span>
                <span className={`font-mincho text-[30px] leading-none min-[720px]:text-[24px] ${day.today ? 'text-verm' : 'text-ink'}`}>{day.num}</span>
              </div>
            ))}
          </div>
          <div className={`${GRID} pt-1.5`}>
            <div className="relative">
              {hours.map((hour) => (
                <span
                  key={hour}
                  className="absolute right-3 text-[11px] leading-3 tracking-[.04em] text-muted tabular-nums"
                  style={{ top: `calc(${hour - START} * var(--h) - 6px)` }}
                >
                  {pad(hour)}
                </span>
              ))}
            </div>
            {DAYS.map((day) => (
              <div
                key={day.dow}
                className={`${day.column} relative min-w-0 border-line2`}
                style={{
                  height: `calc(${END - START} * var(--h))`,
                  backgroundImage: 'repeating-linear-gradient(to bottom, var(--line2) 0 1px, transparent 1px var(--h))',
                }}
              >
                {day.events.map((event) => (
                  <SampleEvent key={event[0]} event={event} />
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* The calendars the week is read from: beside it on a wide screen, below it in two columns
            on a narrower one, and in one column on a phone. */}
        <div className="border-t border-line2 px-3 pt-[22px] pb-5 min-[720px]:grid min-[720px]:grid-cols-2 min-[720px]:gap-x-6 min-[1000px]:block min-[1000px]:w-[250px] min-[1000px]:flex-none min-[1000px]:border-t-0 min-[1000px]:border-l min-[1000px]:bg-[color-mix(in_oklab,var(--ink)_1.5%,transparent)] min-[1000px]:px-3.5 min-[1000px]:py-6">
          <div className="flex items-baseline gap-2.5 px-2.5 pb-3.5 min-[720px]:col-span-2">
            <span className="font-mincho text-[20px] leading-none">Calendars</span>
            <span className="text-[11.5px] text-muted">{SOURCES.length}</span>
          </div>
          {SOURCES.map((source) => (
            <div key={source.id} className="flex min-h-[38px] items-center gap-3 px-2.5">
              <span className="min-w-0 flex-1 truncate text-[13.5px] leading-[1.3]">{source.name}</span>
              <span className="text-[11px] tracking-[.04em] whitespace-nowrap text-muted">{source.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col selection:bg-[color-mix(in_oklab,var(--verm)_22%,transparent)] [&_a:focus-visible]:rounded-[4px] [&_a:focus-visible]:outline-[1.5px] [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-verm">
      <header className={`${WRAP} flex items-center justify-between gap-4 pt-[26px]`}>
        <div className="flex items-center gap-2.5">
          <span className="size-[9px] rounded-full bg-verm" />
          <span className="pb-0.5 font-mincho text-[21px] leading-none">koyomi</span>
        </div>
        <a href={OPEN} className="flex h-11 items-center text-[13px] tracking-[.03em] whitespace-nowrap text-ink2 hover:text-ink">
          Open Koyomi
        </a>
      </header>

      <main className="flex-1">
        <section className={`${WRAP} flex flex-col items-center gap-[22px] pt-[clamp(56px,10vh,108px)] pb-[clamp(44px,6vh,64px)] text-center`}>
          <p className="font-mincho text-[clamp(15px,1.5vw,17px)] tracking-[.02em] text-muted">Calendar, simplified.</p>
          <h1 className="max-w-[11em] font-mincho text-[clamp(40px,6vw,74px)] leading-[1.15] font-normal tracking-[-.005em] text-balance">
            All your calendars.
            <br />
            One quiet place.
          </h1>
          <p className="max-w-[30em] text-[clamp(16px,1.6vw,18px)] leading-[1.8] text-balance text-ink2">
            Bring Google, Microsoft, Yahoo and private calendars together in one simple view.
          </p>
          <a href={OPEN} className={`${PILL} mt-3`}>
            Open Koyomi <span aria-hidden="true">→</span>
          </a>
          <div className="mt-[18px] flex flex-wrap justify-center gap-x-7 gap-y-2.5 text-[12px] tracking-[.08em] text-muted">
            <span>GOOGLE</span>
            <span>MICROSOFT</span>
            <span>YAHOO</span>
            <span>CALENDAR LINK</span>
          </div>
        </section>

        <SampleWeek />

        <section className={`${SECTION} ${PAIR} items-start`}>
          <div className="flex flex-col gap-[18px]">
            <h2 className={`${H2} text-balance`}>
              One person.
              <br />
              Many calendars.
            </h2>
            <p className={`${BODY} max-w-[26em] text-pretty`}>Koyomi puts them on the same timeline.</p>
          </div>
          <div className="flex flex-col border-t border-line">
            {MANY.map((calendar) => (
              <div key={calendar.name} className="flex min-h-[46px] items-baseline justify-between gap-4 border-b border-line2 px-0.5 py-3">
                <span className="text-[15px]">{calendar.name}</span>
                <span className="text-[12px] tracking-[.04em] whitespace-nowrap text-muted">{calendar.via}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={`${SECTION} flex flex-col gap-10`}>
          <div className="flex max-w-[34em] flex-col gap-3.5">
            <h2 className={H2}>Bring your calendars together</h2>
            <p className={`${BODY} text-pretty`}>Connect Google, Microsoft and Yahoo calendars, or subscribe to a private calendar link.</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-x-10 gap-y-7 border-t border-line pt-7">
            {PROVIDERS.map((provider) => (
              <div key={provider.name} className="flex flex-col gap-2">
                <h3 className="font-mincho text-[20px] font-normal">{provider.name}</h3>
                <p className="text-[14px] leading-[1.7] text-ink2">{provider.note}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-x-16 gap-y-7 pt-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-[15px] font-medium">Multiple accounts. Different providers. Same view.</h3>
              <p className="text-[14.5px] leading-[1.75] text-pretty text-ink2">
                Personal Google, work Google, Microsoft, Yahoo — Koyomi keeps them together without mixing them up.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[15px] font-medium">A calendar doesn’t offer direct connection?</h3>
              <p className="text-[14.5px] leading-[1.75] text-pretty text-ink2">Add a private read-only calendar link and keep it in the same view.</p>
            </div>
          </div>
        </section>

        <section className={`${SECTION} ${PAIR} items-start`}>
          <h2 className={`${H2} text-balance`}>Your calendars stay where they are.</h2>
          <div className={`${BODY} flex flex-col gap-[22px]`}>
            <p className="text-pretty">
              Connected calendars remain in Google, Microsoft, Yahoo or their original source. Koyomi reads them so you can see everything together.
            </p>
            <p className="text-pretty">
              You can use Koyomi without creating an account. Events you create in Koyomi stay on your device. Connecting an external calendar only happens
              when you choose to.
            </p>
            <a href="/privacy" className="self-start border-b border-line pb-px text-[13px] tracking-[.03em] text-muted hover:border-ink hover:text-ink">
              Privacy policy
            </a>
          </div>
        </section>

        <section className={`${SECTION} ${PAIR} items-start`}>
          <h2 className={H2}>Just your calendar.</h2>
          <div className="flex flex-col gap-[22px]">
            <p className="font-mincho text-[clamp(19px,2vw,22px)] leading-[1.7]">
              No tasks. No projects. No feeds.
              <br />
              No productivity system to maintain.
            </p>
            <p className={`${BODY} text-pretty`}>Koyomi brings your schedule together and gets out of the way.</p>
          </div>
        </section>

        <section className={`${SECTION} ${PAIR} items-center`}>
          <div className="flex flex-col gap-3.5">
            <h2 className={H2}>Adding something is one line.</h2>
            <p className={BODY}>Click a time. Type. Enter.</p>
          </div>
          <div className="flex flex-col rounded-[6px] border border-line2 bg-sheet px-[22px] py-[26px]">
            <div className="h-[38px] border-t border-line2" />
            <TypedLine />
            <div className="h-[38px] border-t border-line2" />
            <div className="border-t border-line2" />
          </div>
        </section>

        <section className={`${WRAP} flex flex-col items-center gap-7 pt-[clamp(120px,18vh,180px)] pb-[clamp(72px,12vh,120px)] text-center`}>
          <span className="size-[7px] rounded-full bg-verm" />
          <h2 className="font-mincho text-[clamp(28px,3.8vw,42px)] leading-[1.3] font-normal text-balance">
            Your whole schedule.
            <br />
            One quiet place.
          </h2>
          <a href={OPEN} className={PILL}>
            Open Koyomi <span aria-hidden="true">→</span>
          </a>
        </section>
      </main>

      {/* The design's one quiet line, with the two pages the site must link to. */}
      <footer className={`${WRAP} flex flex-wrap items-center justify-center gap-x-6 pt-2 pb-4 text-[12px] tracking-[.04em] text-muted`}>
        <span>Koyomi · 6Away</span>
        {/* Small to the eye, a full 44px to a finger. */}
        <a href="/privacy" className="flex min-h-11 items-center hover:text-ink2">
          Privacy
        </a>
        <a href="/terms" className="flex min-h-11 items-center hover:text-ink2">
          Terms
        </a>
      </footer>
    </div>
  );
}
