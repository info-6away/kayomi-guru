'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DAY_MIN,
  DOW,
  DOWL,
  MON,
  MON3,
  addDays,
  addMonths,
  clamp,
  dayKey,
  mondayOf,
  monthGrid,
  nowMinutes,
  parts,
  weekday,
  type Span,
} from '@/lib/dates';
import { moved, occurrenceKey, occurrencesByDay, type Occurrence } from '@/lib/occurrences';
import { watchInstall } from '@/lib/install';
import { addEvent, init, schedulePlanItem, updateEvent, useData, type Data } from '@/lib/store';
import { registerServiceWorker } from '@/lib/sw-register';
import { toggleTheme, watchTheme } from '@/lib/theme';
import type { PlanItem } from '@/lib/types';
import { MonthView } from './MonthView';
import { PlanPanel } from './PlanPanel';
import { SearchPanel } from './SearchPanel';
import { Timeline } from './Timeline';
import { SearchIcon, hourHeight, things, type Slot, type View } from './ui';

const ROUND = 'rounded-full transition-colors duration-150 hover:bg-wash hover:text-ink';
const TAB = 'relative h-8 px-2.5 text-[13px] tracking-[.03em] transition-colors duration-150 hover:text-ink';
const HALF_MOON = 'rounded-full border border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]';

export default function Kayomi() {
  const viewport = useViewport();
  const data = useData();

  useEffect(() => {
    init();
    registerServiceWorker();
    const stopInstall = watchInstall();
    const stopTheme = watchTheme();
    return () => {
      stopInstall();
      stopTheme();
    };
  }, []);

  // Layout depends on the window and the calendar on this device's data, so there is nothing to draw before both are known.
  if (!viewport || !data.ready) return <div data-app className="h-dvh bg-bg" />;
  return <Calendar data={data} w={viewport.w} h={viewport.h} />;
}

function useViewport() {
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return viewport;
}

const readClock = () => {
  const d = new Date();
  return { today: dayKey(d), now: nowMinutes(d) };
};

function useClock() {
  const [clock, setClock] = useState(readClock);
  useEffect(() => {
    const tick = () =>
      setClock((current) => {
        const next = readClock();
        return next.today === current.today && next.now === current.now ? current : next;
      });
    const timer = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return clock;
}

function Calendar({ data, w, h }: { data: Data; w: number; h: number }) {
  const { today, now } = useClock();
  const [view, setView] = useState<View>('week');
  const [date, setDate] = useState(today);
  const [monthOnPhone, setMonthOnPhone] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [qa, setQa] = useState<Slot | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const dragPlan = useRef<PlanItem | null>(null);
  const swipe = useRef({ x: 0, y: 0 });

  // Week is the home view on a desktop; a phone shows one day, with the month a tap away.
  const mobile = w < 760;
  const v: View = mobile ? (monthOnPhone ? 'month' : 'day') : view;
  const pushes = !mobile && w >= 1100;
  const hourH = hourHeight(mobile, h);
  const monday = mondayOf(date);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const cur = parts(date);
  const placing = (placingId && data.plan.find((p) => p.id === placingId)) || null;

  const byDay = useMemo(() => {
    if (v !== 'month') return occurrencesByDay(data.events, data.plan, monday, addDays(monday, 6));
    const grid = monthGrid(date);
    return occurrencesByDay(data.events, data.plan, grid.start, addDays(grid.start, grid.rows * 7 - 1));
  }, [data.events, data.plan, v, date, monday]);

  // Plan shows what is still waiting for a time; a scheduled item lives on the calendar instead.
  const { waiting, done } = useMemo(() => {
    const scheduled = new Set(data.events.map((e) => e.planItemId));
    return {
      waiting: data.plan
        .filter((p) => p.status === 'open' && !scheduled.has(p.id))
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
      done: data.plan.filter((p) => p.status === 'completed').sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)),
    };
  }, [data.events, data.plan]);

  let rangeLabel = MON[cur.m - 1];
  let rangeYear = String(cur.y);
  if (v === 'week') {
    const a = parts(monday);
    const b = parts(week[6]);
    rangeLabel = a.m === b.m ? `${a.d} — ${b.d} ${MON[a.m - 1]}` : `${a.d} ${MON3[a.m - 1]} — ${b.d} ${MON3[b.m - 1]}`;
    rangeYear = String(b.y);
  } else if (v === 'day') {
    rangeLabel = `${DOWL[weekday(date)]} ${cur.d} ${MON[cur.m - 1]}`;
  }

  const go = (next: string) => {
    setDate(next);
    setSel(null);
    setQa(null);
  };
  const step = (dir: number) => go(v === 'week' ? addDays(date, 7 * dir) : v === 'day' ? addDays(date, dir) : addMonths(date, dir));
  const changeView = (next: View) => {
    setView(next);
    setMonthOnPhone(next === 'month');
    setSel(null);
    setQa(null);
  };
  const openDay = (day: string) => {
    go(day);
    setView('day');
    setMonthOnPhone(false);
  };

  /** Starts an event at the next half-hour today, or at 09:00 on another day. */
  const quickAdd = () => {
    let day = date;
    if (v === 'week') day = week.includes(today) ? today : monday;
    if (v === 'month') setView('day');
    const min = clamp(day === today ? Math.ceil((now + 1) / 30) * 30 : 9 * 60, 0, DAY_MIN - 60);
    setDate(day);
    setQa({ date: day, min });
    setSel(null);
    setMonthOnPhone(false);
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el) return;
      const y = (min / 60) * hourH;
      if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - 120) el.scrollTop = y - 140;
    });
  };

  /** Shows an event on the calendar with its details open. */
  const reveal = (day: string, key: string) => {
    setDate(day);
    setSel(key);
    setQa(null);
    setSearching(false);
    setMonthOnPhone(false);
    if (view === 'month') setView('week');
    if (mobile) setPlanOpen(false);
  };

  const startPlacing = (item: PlanItem) => {
    setPlacingId(placingId === item.id ? null : item.id);
    setSel(null);
    setMonthOnPhone(false);
    if (view === 'month') setView('week');
    if (mobile) setPlanOpen(false);
  };

  const moveEvent = (o: Occurrence, to: Span) => {
    updateEvent(o.event.id, moved(o, to));
    if (sel === o.key) setSel(occurrenceKey(o.event.id, to.date));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (searching) setSearching(false);
        else if (sel) setSel(null);
        else if (placingId) setPlacingId(null);
        else if (planOpen) setPlanOpen(false);
      } else if (k === 'arrowleft') step(-1);
      else if (k === 'arrowright') step(1);
      else if (k === 't') go(today);
      else if (k === 'd') changeView('day');
      else if (k === 'w') changeView('week');
      else if (k === 'm') changeView('month');
      else if (k === 'p') setPlanOpen(!planOpen);
      else if (k === 'n' || k === '/') {
        // Otherwise the key would be typed into the field it opens.
        e.preventDefault();
        if (k === 'n') quickAdd();
        else setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const themeButton = (size: string, dot: string) => (
    <button onClick={toggleTheme} aria-label="Toggle ink mode" title="Ink mode" className={`grid place-items-center text-muted ${size}`}>
      <span className={`${HALF_MOON} ${dot}`} />
    </button>
  );

  return (
    // On a phone held sideways the notch eats into one side; the insets are zero everywhere else.
    <div data-app className="h-dvh pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      {/* overflow-clip, not hidden: the Plan drawer waits off-screen, and a clipped box cannot be scrolled sideways to it. */}
      <div className="relative flex h-full flex-col overflow-clip bg-bg pt-[env(safe-area-inset-top)]">
        {!mobile && (
          <header className="grid h-16 flex-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 pr-5 pl-7">
            <div className="flex items-center gap-2.5">
              <span className="size-[9px] flex-none rounded-full bg-verm" />
              <span className="pb-0.5 font-mincho text-[21px] leading-none tracking-[.01em]">koyomi</span>
            </div>
            <div className="flex min-w-0 items-center justify-center gap-1">
              <button onClick={() => step(-1)} aria-label="Previous" className={`size-8 text-[20px] leading-none text-muted ${ROUND}`}>
                ‹
              </button>
              <div className="flex min-w-[200px] items-baseline justify-center gap-2 text-center font-mincho text-[18px] whitespace-nowrap">
                <span>{rangeLabel}</span>
                <span className="text-[14px] text-muted">{rangeYear}</span>
              </div>
              <button onClick={() => step(1)} aria-label="Next" className={`size-8 text-[20px] leading-none text-muted ${ROUND}`}>
                ›
              </button>
              <button
                onClick={() => go(today)}
                className="ml-2.5 h-7 rounded-full border border-line px-3.5 text-[12.5px] tracking-[.03em] text-ink2 transition-colors duration-150 hover:border-stone hover:text-ink"
              >
                Today
              </button>
            </div>
            <div className="flex items-center justify-end gap-3">
              <nav className="flex gap-1">
                {(['day', 'week', 'month'] as const).map((x) => (
                  <button
                    key={x}
                    onClick={() => changeView(x)}
                    aria-pressed={view === x}
                    className={`${TAB} capitalize ${view === x ? 'text-ink underline decoration-ink decoration-1 underline-offset-8' : 'text-muted'}`}
                  >
                    {x}
                  </button>
                ))}
              </nav>
              <span className="h-4 w-px bg-line" />
              <button
                onClick={() => {
                  setPlanOpen(!planOpen);
                  setSel(null);
                }}
                aria-expanded={planOpen}
                className={`${TAB} flex items-center gap-2 ${planOpen ? 'text-ink' : 'text-ink2'}`}
              >
                <span>Plan</span>
                <span className="text-[11.5px] text-muted tabular-nums">{waiting.length}</span>
              </button>
              <button onClick={() => setSearching(true)} aria-label="Search" className={`grid size-8 place-items-center text-ink2 ${ROUND}`}>
                <SearchIcon />
              </button>
              <button onClick={quickAdd} aria-label="Add" className={`size-8 text-[20px] leading-none font-light text-ink2 ${ROUND}`}>
                ＋
              </button>
              {themeButton('-ml-1 h-8 w-6 transition-colors duration-150 hover:text-ink2', 'size-[9px]')}
            </div>
          </header>
        )}

        {mobile && (
          <>
            <header className="flex flex-none items-center gap-1 pt-2.5 pr-1.5 pb-0.5 pl-5">
              <div className="flex min-w-0 flex-1 items-center gap-[9px] overflow-hidden">
                <span className="size-2 flex-none rounded-full bg-verm" />
                <span className="pb-0.5 font-mincho text-[19px] leading-none">koyomi</span>
              </div>
              <button
                onClick={() => {
                  setMonthOnPhone(!monthOnPhone);
                  setSel(null);
                  setQa(null);
                }}
                aria-expanded={monthOnPhone}
                className="flex h-11 items-center gap-1.5 px-2.5 font-mincho text-[17px]"
              >
                <span>{MON[cur.m - 1]}</span>
                <span className={`-mt-1 inline-block text-[13px] text-muted transition-transform duration-200 ease-kayomi ${monthOnPhone ? 'rotate-180' : ''}`}>
                  ⌄
                </span>
              </button>
              <button onClick={() => setSearching(true)} aria-label="Search" className="grid h-11 w-10 place-items-center text-muted">
                <SearchIcon />
              </button>
              {themeButton('h-11 w-9', 'size-2.5')}
              <button onClick={quickAdd} aria-label="Add" className="size-11 text-[22px] font-light text-ink">
                ＋
              </button>
            </header>

            {!monthOnPhone && (
              <>
                <div
                  onTouchStart={(e) => (swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
                  onTouchEnd={(e) => {
                    const dx = e.changedTouches[0].clientX - swipe.current.x;
                    const dy = e.changedTouches[0].clientY - swipe.current.y;
                    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setDate(addDays(date, dx < 0 ? 7 : -7));
                  }}
                  className="grid flex-none grid-cols-7 px-2 pt-0.5 pb-1.5"
                >
                  {week.map((key) => {
                    const isToday = key === today;
                    const isSel = key === date;
                    return (
                      <button key={key} onClick={() => go(key)} aria-pressed={isSel} className="flex h-16 flex-col items-center justify-center gap-1">
                        <span className={`text-[10.5px] tracking-[.1em] ${isSel ? 'text-ink' : 'text-dow'}`}>{DOW[weekday(key)][0]}</span>
                        <span
                          className={`grid size-[34px] place-items-center rounded-full font-mincho text-[17px] leading-none transition-colors duration-200 ease-kayomi ${
                            isSel ? (isToday ? 'bg-verm text-bg' : 'bg-ink text-bg') : isToday ? 'text-verm-text' : 'text-ink'
                          }`}
                        >
                          {parts(key).d}
                        </span>
                        <span className={`size-[3px] rounded-full ${byDay.get(key)?.length && !isSel ? 'bg-muted' : ''}`} />
                      </button>
                    );
                  })}
                </div>
                <div className="flex min-h-10 flex-none items-center justify-between border-b border-line pt-1.5 pr-4 pb-2 pl-5">
                  <span className="text-[13px] tracking-[.02em] text-ink2">{`${DOWL[weekday(date)]}, ${cur.d} ${MON[cur.m - 1]}`}</span>
                  {date !== today && (
                    <button onClick={() => go(today)} className="h-[30px] rounded-full border border-line px-3.5 text-[12.5px] text-ink2">
                      Today
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}

        <div
          className="relative flex min-h-0 flex-1 transition-[padding-right] duration-[220ms] ease-kayomi"
          style={{ paddingRight: pushes && planOpen ? 320 : 0 }}
        >
          {v === 'day' && !mobile && w >= 900 && (
            <aside className="flex w-[280px] flex-none flex-col pt-9 pb-7 pl-10">
              <span className="text-[11px] tracking-[.2em] text-dow">{DOWL[weekday(date)].toUpperCase()}</span>
              <span className="mt-2.5 mb-1 -ml-1 font-mincho text-[112px] leading-none">{cur.d}</span>
              <span className="font-mincho text-[19px] text-ink2">{`${MON[cur.m - 1]} ${cur.y}`}</span>
              {date === today && (
                <span className="mt-4 flex items-center gap-2 text-[12px] tracking-[.04em] text-muted">
                  <span className="size-1.5 rounded-full bg-verm" />
                  Today
                </span>
              )}
              <div className="mt-auto grid grid-cols-[repeat(7,30px)] gap-0.5">
                {week.map((key) => (
                  <button key={key} onClick={() => go(key)} className="flex h-[46px] flex-col items-center gap-1.5 rounded-[4px] py-1.5 hover:bg-wash">
                    <span className="text-[9.5px] tracking-[.1em] text-dow">{DOW[weekday(key)][0]}</span>
                    <span
                      className={`border-b pb-[3px] font-mincho text-[15px] leading-none ${key === today ? 'text-verm-text' : 'text-ink'} ${
                        key === date ? 'border-ink' : 'border-transparent'
                      }`}
                    >
                      {parts(key).d}
                    </span>
                  </button>
                ))}
              </div>
            </aside>
          )}

          {v !== 'month' && (
            <Timeline
              days={v === 'week' ? week : [date]}
              mobile={mobile}
              today={today}
              now={now}
              byDay={byDay}
              hourH={hourH}
              sel={sel}
              qa={qa}
              placing={placing}
              dragPlan={dragPlan}
              scroller={scroller}
              onSelect={(key) => {
                setSel(key);
                setQa(null);
              }}
              onQa={setQa}
              onCreate={(slot, title) => {
                if (title) addEvent({ title, date: slot.date, start: slot.min, end: slot.min + 60 });
                setQa(null);
              }}
              onPlace={(itemId, day, min) => {
                schedulePlanItem(itemId, day, min);
                setPlacingId(null);
                dragPlan.current = null;
              }}
              onMove={moveEvent}
              onOpenDay={openDay}
              onSwipe={(dir) => go(addDays(date, dir))}
            />
          )}

          {v === 'month' && (
            <MonthView
              date={date}
              today={today}
              mobile={mobile}
              viewportH={h}
              byDay={byDay}
              label={rangeLabel}
              year={rangeYear}
              onOpenDay={openDay}
              onStep={step}
            />
          )}
        </div>

        {mobile && (
          <>
            <button
              onClick={() => {
                setPlanOpen(!planOpen);
                setSel(null);
              }}
              aria-expanded={planOpen}
              className="flex flex-none items-center gap-3 border-t border-line bg-bg px-[22px] text-left"
              style={{ height: 'calc(64px + env(safe-area-inset-bottom))', paddingBottom: 'calc(4px + env(safe-area-inset-bottom))' }}
            >
              <span className="font-mincho text-[18px]">Plan</span>
              <span className="flex-1 text-[12.5px] text-muted">{things(waiting.length)}</span>
              <span className="h-[3px] w-7 rounded-[2px] bg-line" />
            </button>
            <div
              onClick={() => setPlanOpen(false)}
              className={`absolute inset-0 z-[25] bg-[rgba(29,29,27,.22)] transition-opacity duration-[260ms] ease-kayomi ${
                planOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            />
          </>
        )}

        {placing && (
          <div
            className="pointer-events-none absolute inset-x-2 z-40 flex justify-center"
            style={{ top: mobile ? 'calc(env(safe-area-inset-top) + 62px)' : 72 }}
          >
            <div className="pointer-events-auto flex max-w-full animate-in items-center gap-2 rounded-full bg-ink py-1.5 pr-1.5 pl-4 whitespace-nowrap text-bg shadow-[0_10px_30px_-12px_var(--shadow)]">
              <span className="min-w-0 truncate text-[13px]">
                Choose a time for <span className="font-medium">{placing.title}</span>
              </span>
              <button onClick={() => setPlacingId(null)} className="h-7 flex-none px-2.5 text-[12.5px] opacity-70">
                Cancel
              </button>
            </div>
          </div>
        )}

        <PlanPanel
          mobile={mobile}
          open={planOpen}
          pushes={pushes}
          waiting={waiting}
          done={done}
          placingId={placingId}
          dragPlan={dragPlan}
          onClose={() => setPlanOpen(false)}
          onPlace={startPlacing}
        />

        {searching && (
          <SearchPanel
            mobile={mobile}
            events={data.events}
            plan={data.plan}
            today={today}
            onClose={() => setSearching(false)}
            onEvent={reveal}
            onPlanItem={() => {
              setSearching(false);
              setPlanOpen(true);
            }}
          />
        )}

        {data.saveFailed && (
          <div role="alert" className="pointer-events-none absolute inset-x-2 bottom-4 z-50 flex justify-center">
            <span className="rounded-full bg-ink px-4 py-1.5 text-[13px] text-bg shadow-[0_10px_30px_-12px_var(--shadow)]">
              Couldn’t save to this device. Your last change was not kept.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
