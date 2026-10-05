'use client';

import { addDays, hm, monthGrid, parts } from '@/lib/dates';
import type { Occurrence } from '@/lib/occurrences';
import { CAT } from './ui';

const DOWS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

interface Props {
  /** Any day in the month shown. */
  date: string;
  today: string;
  mobile: boolean;
  viewportH: number;
  byDay: Map<string, Occurrence[]>;
  label: string;
  year: string;
  onOpenDay: (date: string) => void;
  onStep: (dir: number) => void;
}

export function MonthView({ date, today, mobile, viewportH, byDay, label, year, onOpenDay, onStep }: Props) {
  const { start, rows } = monthGrid(date);
  const month = parts(date).m;
  // How many events fit in a cell before the rest collapse into "+n more".
  const fit = Math.max(1, Math.floor(((viewportH - 64 - 56) / rows - 44) / 20));

  return (
    <div className={`flex min-w-0 flex-1 flex-col ${mobile ? 'px-2 pb-2' : 'px-7 pt-2 pb-5'}`}>
      {mobile && (
        <div className="flex items-center justify-between px-1.5 pt-1 pb-2">
          <button onClick={() => onStep(-1)} aria-label="Previous month" className="size-11 text-[22px] text-muted">
            ‹
          </button>
          <span className="font-mincho text-[17px]">
            {label} <span className="text-[14px] text-muted">{year}</span>
          </span>
          <button onClick={() => onStep(1)} aria-label="Next month" className="size-11 text-[22px] text-muted">
            ›
          </button>
        </div>
      )}

      <div className="grid grid-cols-7 pb-2.5">
        {DOWS.map((d) => (
          <span key={d} className={`text-[10.5px] tracking-[.18em] text-muted ${mobile ? 'text-center' : 'px-3 text-left'}`}>
            {mobile ? d[0] : d}
          </span>
        ))}
      </div>

      <div
        className={`grid min-h-0 flex-1 grid-cols-7 ${mobile ? '' : 'border-b border-line'}`}
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: rows * 7 }, (_, i) => {
          const key = addDays(start, i);
          const day = parts(key);
          const inMonth = day.m === month;
          const isToday = key === today;
          const list = byDay.get(key) ?? [];

          if (mobile) {
            const isSel = key === date;
            return (
              <button
                key={key}
                onClick={() => onOpenDay(key)}
                className={`flex min-h-0 flex-col items-center gap-1.5 border-t border-line2 py-2 ${inMonth ? '' : 'opacity-40'}`}
              >
                <span
                  className={`grid size-8 place-items-center rounded-full font-mincho text-[16px] leading-none ${
                    isSel ? (isToday ? 'bg-verm text-bg' : 'bg-ink text-bg') : isToday ? 'text-verm' : 'text-ink'
                  }`}
                >
                  {day.d}
                </span>
                {list.length > 0 && (
                  <span className="flex h-1 justify-center gap-[3px]">
                    {list.slice(0, 3).map((o) => (
                      <span key={o.key} className="size-1 rounded-full" style={{ background: CAT[o.event.category] }} />
                    ))}
                  </span>
                )}
              </button>
            );
          }

          const max = list.length > fit ? Math.max(1, fit - 1) : fit;
          return (
            <button
              key={key}
              onClick={() => onOpenDay(key)}
              className={`flex min-h-0 flex-col items-stretch gap-[5px] overflow-hidden border-t border-line px-3 pt-2.5 pb-2 text-left transition-colors duration-150 hover:bg-wash ${
                i % 7 ? 'border-l border-l-line2' : ''
              } ${inMonth ? '' : 'opacity-40'}`}
              style={{ backgroundColor: i % 7 >= 5 ? 'color-mix(in oklab, var(--ink) 2.5%, transparent)' : undefined }}
            >
              <span className={`mb-1 font-mincho text-[17px] leading-none ${isToday ? 'text-verm' : 'text-ink'}`}>{day.d}</span>
              {list.slice(0, max).map((o) => (
                <span key={o.key} className="flex min-w-0 items-center gap-[7px] text-[12px] leading-[1.35]">
                  <span className="h-[11px] w-0.5 flex-none rounded-[1px]" style={{ background: CAT[o.event.category] }} />
                  <span className="flex-none text-muted tabular-nums">{hm(o.start)}</span>
                  <span className={`min-w-0 truncate ${o.done ? 'text-muted line-through' : 'text-ink'}`}>{o.event.title}</span>
                </span>
              ))}
              {list.length > max && <span className="pl-[9px] text-[11.5px] text-muted">+{list.length - max} more</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
