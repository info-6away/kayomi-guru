'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DOW3, MON3, hm, parts, spanOf, weekday } from '@/lib/dates';
import { nearestDay, occurrenceKey } from '@/lib/occurrences';
import type { CalendarEvent, PlanItem } from '@/lib/types';
import { CAT, SURFACE, SearchIcon } from './ui';

const MAX = 30;
const ROW = 'flex min-h-10 w-full items-center gap-3 rounded-[4px] px-2.5 text-left hover:bg-wash focus-visible:bg-wash focus-visible:outline-none';

interface Props {
  mobile: boolean;
  events: CalendarEvent[];
  plan: PlanItem[];
  today: string;
  onClose: () => void;
  onEvent: (date: string, key: string) => void;
  onPlanItem: (item: PlanItem) => void;
}

/** Finds events and Plan items by title. */
export function SearchPanel({ mobile, events, plan, today, onClose, onEvent, onPlanItem }: Props) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const matches = (title: string) => title.toLowerCase().includes(q);
    const year = parts(today).y;

    const found = events.filter((e) => matches(e.title)).map((event) => {
      const date = nearestDay(event, today);
      const day = parts(date);
      return {
        event,
        date,
        start: spanOf(event).start,
        when: `${DOW3[weekday(date)]} ${day.d} ${MON3[day.m - 1]}${day.y === year ? '' : ` ${day.y}`} · ${event.allDay ? 'All day' : hm(spanOf(event).start)}`,
      };
    });
    // What is coming up first, soonest first; then the past, most recent first.
    const order = (a: (typeof found)[number], b: (typeof found)[number]) => a.date.localeCompare(b.date) || a.start - b.start;
    const ahead = found.filter((r) => r.date >= today).sort(order);
    const past = found.filter((r) => r.date < today).sort((a, b) => order(b, a));

    // A scheduled Plan item is already listed as its event.
    const scheduled = new Set(events.map((e) => e.planItemId));
    const items = plan.filter((p) => !scheduled.has(p.id) && matches(p.title));
    return { events: [...ahead, ...past].slice(0, MAX), items: items.slice(0, MAX) };
  }, [query, events, plan, today]);

  const first = results?.events[0];
  const firstItem = results?.items[0];

  return (
    <>
      <div onClick={onClose} className="absolute inset-0 z-[44]" />
      <div
        role="search"
        className={`absolute z-[45] flex flex-col ${SURFACE} ${
          mobile ? 'inset-x-2 top-[calc(env(safe-area-inset-top)+56px)]' : 'top-[58px] right-5 w-[340px]'
        }`}
      >
        <div className="flex h-12 flex-none items-center gap-2.5 px-4 text-muted">
          <SearchIcon />
          <input
            ref={input}
            aria-label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter') {
                if (first) onEvent(first.date, occurrenceKey(first.event.id, first.date));
                else if (firstItem) onPlanItem(firstItem);
              }
            }}
            placeholder="Search events and Plan"
            className={`h-8 min-w-0 flex-1 bg-transparent p-0 text-ink caret-verm outline-none ${mobile ? 'text-[16px]' : 'text-[14px]'}`}
          />
          {mobile ? (
            <button onClick={onClose} aria-label="Close search" className="-mr-2 size-9 text-[18px]">
              ×
            </button>
          ) : (
            <span className="text-[11px] tracking-[.03em]">esc</span>
          )}
        </div>

        {results && (
          <div className="max-h-[min(60vh,420px)] overflow-y-auto border-t border-line p-1.5">
            {results.events.map((r) => (
              <button key={r.event.id} onClick={() => onEvent(r.date, occurrenceKey(r.event.id, r.date))} className={ROW}>
                <span className="h-3.5 w-0.5 flex-none rounded-[1px]" style={{ background: CAT[r.event.category] }} />
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{r.event.title}</span>
                <span className="flex-none text-[12px] text-muted tabular-nums">{r.when}</span>
              </button>
            ))}
            {results.items.map((item) => (
              <button key={item.id} onClick={() => onPlanItem(item)} className={ROW}>
                <span
                  className={`-mx-1 size-2.5 flex-none rounded-full ${item.status === 'completed' ? 'bg-stone' : 'border border-ink2'}`}
                />
                <span className={`min-w-0 flex-1 truncate text-[14px] ${item.status === 'completed' ? 'text-muted line-through decoration-stone' : 'text-ink'}`}>
                  {item.title}
                </span>
                <span className="flex-none text-[12px] text-muted">{item.status === 'completed' ? 'Done' : 'Plan'}</span>
              </button>
            ))}
            {!results.events.length && !results.items.length && (
              <p className="px-2.5 py-3 font-mincho text-[15px] text-ink2">Nothing found.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
