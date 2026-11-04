'use client';

import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { DAY_MIN, DOWL, MON, hm, parseTime, parts, spanOf, toInstant, weekday, type Span } from '@/lib/dates';
import { moved, occurrenceKey, type Occurrence } from '@/lib/occurrences';
import { deleteEvent, endSeriesBefore, skipOccurrence, updateEvent } from '@/lib/store';
import type { Frequency } from '@/lib/types';
import { CAT, CATEGORIES, CloseButton, SURFACE } from './ui';

const ACTION = 'rounded-[4px] px-2 text-[12.5px]';
const FIELD = 'bg-transparent outline-none focus:shadow-[0_1px_0_var(--line)]';

/** A title as long as anyone types, wrapped onto as many lines as it needs and never scrolled sideways. */
const grow = (field: HTMLTextAreaElement | null) => {
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
};


interface Props {
  o: Occurrence;
  mobile: boolean;
  style: CSSProperties;
  onSelect: (key: string | null) => void;
}

/** Shows one event and edits it in place. Changes to a repeating event apply to the whole series. */
export function EventPopover({ o, mobile, style, onSelect }: Props) {
  const ev = o.event;
  const [choosingDelete, setChoosingDelete] = useState(false);
  const day = parts(o.date);

  const reschedule = (to: Partial<Span>) => {
    const next = { date: o.date, start: o.start, end: o.end, ...to };
    updateEvent(ev.id, moved(o, next));
    if (next.date !== o.date) onSelect(occurrenceKey(ev.id, next.date));
  };

  const setRepeat = (freq: string) => {
    if (freq) {
      updateEvent(ev.id, { recurrence: { freq: freq as Frequency, until: ev.recurrence?.until ?? null, except: ev.recurrence?.except ?? [] } });
    } else if (ev.allDay) {
      updateEvent(ev.id, { start: o.date, end: o.date, recurrence: null });
    } else {
      // No longer repeating: what remains is the day being looked at.
      updateEvent(ev.id, { start: toInstant(o.date, o.start), end: toInstant(o.date, o.end), recurrence: null });
    }
  };

  /** Moves the event between the all-day row and a time. A series keeps the day it started on. */
  const setAllDay = (allDay: boolean) => {
    const first = spanOf(ev).date;
    if (allDay) updateEvent(ev.id, { allDay: true, start: first, end: first });
    else updateEvent(ev.id, { allDay: false, start: toInstant(first, 9 * 60), end: toInstant(first, 10 * 60) });
  };

  const close = () => onSelect(null);
  const target = mobile ? 'h-11' : 'h-8';

  const saveTitle = (field: HTMLTextAreaElement) => {
    // A title is one line of words: anything pasted across lines is joined back into one.
    const title = field.value.replace(/\s*\n\s*/g, ' ').trim();
    if (!title) field.value = ev.title;
    else if (title !== ev.title) updateEvent(ev.id, { title });
    grow(field);
  };

  return (
    <div
      data-popover
      style={style}
      className={`absolute z-[8] flex w-[260px] scroll-mt-24 scroll-mb-4 flex-col gap-[5px] px-4 pt-3.5 pb-2 select-text ${SURFACE}`}
    >
      <div className="flex items-center gap-2 text-[11px] tracking-[.08em] text-muted">
        <span className="size-1.5 flex-none rounded-full" style={{ background: CAT[ev.category] }} />
        <label
          className={`relative transition-colors duration-150 hover:text-ink has-[:focus-visible]:text-ink has-[:focus-visible]:underline ${mobile ? '-mt-2 py-3.5' : ''}`}
        >
          {`${DOWL[weekday(o.date)]} ${day.d} ${MON[day.m - 1]}`.toUpperCase()}
          <input
            type="date"
            aria-label="Date"
            value={o.date}
            onChange={(e) => e.target.value && reschedule({ date: e.target.value })}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker();
              } catch {
                // No picker to open here; the field still takes typed dates.
              }
            }}
            // 16px although it is never seen: iOS zooms the page when a smaller field takes focus.
            className="absolute inset-0 size-full cursor-pointer text-[16px] opacity-0"
          />
        </label>
        <CloseButton mobile={mobile} label="Close" onClose={close} />
      </div>

      <textarea
        key={ev.title}
        ref={grow}
        rows={1}
        aria-label="Title"
        defaultValue={ev.title}
        onInput={(e) => grow(e.currentTarget)}
        onBlur={(e) => saveTitle(e.currentTarget)}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          // Enter saves, as it always has: a title is never more than one line of words.
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.currentTarget.value = ev.title;
            close();
          }
        }}
        className={`block w-full resize-none overflow-hidden font-mincho text-[20px] leading-[1.3] text-ink [overflow-wrap:anywhere] ${FIELD}`}
      />

      {/* Times are typed, to the minute: "14:05", or "1405" on a keypad with no colon. */}
      <div className={`flex items-center gap-1 text-ink2 tabular-nums ${mobile ? 'text-[16px]' : 'text-[13px]'}`}>
        {ev.allDay ? (
          <span>All day</span>
        ) : (
          <>
            <TimeField
              label="Start"
              value={o.start}
              wide={mobile}
              onCommit={(min) => {
                if (min > DAY_MIN - 15) return false;
                reschedule({ start: min, end: Math.min(DAY_MIN, min + (o.end - o.start)) });
                return true;
              }}
            />
            <span>–</span>
            <TimeField
              label="End"
              value={o.end}
              wide={mobile}
              onCommit={(min) => {
                if (min <= o.start) return false;
                reschedule({ end: min });
                return true;
              }}
            />
          </>
        )}
        {/* The one way an event of Koyomi's own gets into the all-day row, and back out. */}
        <button
          onClick={() => setAllDay(!ev.allDay)}
          className={`ml-auto text-[12px] text-muted hover:text-ink focus-visible:text-ink ${mobile ? '-mr-2 min-h-11 px-2' : ''}`}
        >
          {ev.allDay ? 'Set a time' : 'All day'}
        </button>
      </div>

      <div className={`flex items-center ${mobile ? '-ml-3' : '-ml-1.5'}`}>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            aria-label={c.label}
            aria-pressed={ev.category === c.id}
            title={c.label}
            onClick={() => updateEvent(ev.id, { category: c.id })}
            className={`grid place-items-center rounded-full ${mobile ? 'size-11' : 'size-6'}`}
          >
            <span
              className="size-2 rounded-full"
              style={{ background: CAT[c.id], boxShadow: ev.category === c.id ? `0 0 0 2px var(--bg), 0 0 0 3px ${CAT[c.id]}` : 'none' }}
            />
          </button>
        ))}
        <select
          aria-label="Repeat"
          value={ev.recurrence?.freq ?? ''}
          onChange={(e) => setRepeat(e.target.value)}
          className={`ml-auto cursor-pointer appearance-none bg-transparent text-muted outline-none [text-align-last:right] hover:text-ink focus-visible:text-ink ${mobile ? 'h-11 text-[16px]' : 'text-[12px]'}`}
        >
          <option value="">Does not repeat</option>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
          <option value="yearly">Every year</option>
        </select>
      </div>

      {choosingDelete ? (
        <div role="group" aria-label="Delete repeating event" className="-mx-2 mt-1.5 flex gap-1 border-t border-line pt-2">
          <button
            onClick={() => {
              skipOccurrence(ev.id, o.date);
              close();
            }}
            className={`${ACTION} ${target} text-ink2 hover:bg-wash`}
          >
            This one
          </button>
          <button
            onClick={() => {
              endSeriesBefore(ev.id, o.date);
              close();
            }}
            className={`${ACTION} ${target} text-ink2 hover:bg-wash`}
          >
            This and after
          </button>
          <button
            onClick={() => {
              deleteEvent(ev.id);
              close();
            }}
            className={`${ACTION} ${target} ml-auto text-muted hover:text-verm-text`}
          >
            All
          </button>
        </div>
      ) : (
        <div className="-mx-2 mt-1.5 flex gap-1 border-t border-line pt-2">
          <button
            onClick={() => {
              if (ev.recurrence) return setChoosingDelete(true);
              deleteEvent(ev.id);
              close();
            }}
            className={`${ACTION} ${target} ml-auto text-muted hover:text-verm-text`}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/** A typed 24-hour time. An entry that cannot be used is put back as it was. */
function TimeField({ label, value, wide, onCommit }: { label: string; value: number; wide: boolean; onCommit: (min: number) => boolean }) {
  return (
    <input
      key={value}
      aria-label={label}
      inputMode="numeric"
      title="Type any time, such as 14:05"
      defaultValue={hm(value)}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        const min = parseTime(e.target.value);
        if (min === null || min === value || !onCommit(min)) e.target.value = hm(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = hm(value);
          e.currentTarget.blur();
        }
      }}
      // On a phone there is no hover to hint at it, so a time is underlined: it can be typed in.
      className={`${wide ? 'h-11 w-11 shadow-[0_1px_0_var(--line)]' : 'w-[33px] hover:shadow-[0_1px_0_var(--line)]'} ${FIELD}`}
    />
  );
}
