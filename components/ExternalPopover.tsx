'use client';

import type { CSSProperties } from 'react';
import { daysOf, timeLabel, type Showing } from '@/lib/calendars/showings';
import { DOW3, DOWL, MON, MON3, parts, weekday } from '@/lib/dates';
import { SURFACE } from './ui';

const PROVIDER = { google: 'Google Calendar' };

const short = (day: string) => `${DOW3[weekday(day)]} ${parts(day).d} ${MON3[parts(day).m - 1]}`;

/**
 * Shows one event from a connected calendar. There is nothing to edit and nothing to delete:
 * the event belongs to its own calendar, and Koyomi only reads it. So none of a Koyomi event's
 * actions are here, only the way to the place it can be changed.
 */
export function ExternalPopover({ s, style, onClose }: { s: Showing; style: CSSProperties; onClose: () => void }) {
  const ev = s.event;
  const day = parts(s.date);
  const { first, last } = daysOf(ev);
  const when = first === last ? (s.allDay ? 'All day' : timeLabel(ev)) : s.allDay ? `${short(first)} – ${short(last)}` : `${short(first)} ${timeLabel(ev)}`;

  return (
    <div
      data-popover
      data-external
      style={style}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      className={`absolute z-[8] flex w-[260px] scroll-mt-24 scroll-mb-4 flex-col gap-[5px] px-4 pt-3.5 pb-2 select-text ${SURFACE}`}
    >
      <div className="flex items-center gap-2 text-[11px] tracking-[.08em] text-muted">
        {/* A ring, where a Koyomi event has a coloured dot: this one is from somewhere else. */}
        <span className="size-1.5 flex-none rounded-full border border-muted" />
        <span>{`${DOWL[weekday(s.date)]} ${day.d} ${MON[day.m - 1]}`.toUpperCase()}</span>
      </div>

      <p className="font-mincho text-[20px] leading-[1.3] text-ink">{ev.title}</p>
      <p className="text-[13px] text-ink2 tabular-nums">{when}</p>
      <p className="text-[12px] text-muted">
        {PROVIDER[ev.provider]} · {s.calendar}
      </p>

      {ev.link && (
        <div className="-mx-2 mt-1.5 flex border-t border-line pt-2">
          <a href={ev.link} target="_blank" rel="noopener noreferrer" className="flex h-8 items-center rounded-[4px] px-2 text-[12.5px] text-ink2 hover:bg-wash">
            Open in Google Calendar
          </a>
        </div>
      )}
    </div>
  );
}
