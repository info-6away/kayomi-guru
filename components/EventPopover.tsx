'use client';

import { useState, type CSSProperties } from 'react';
import { DAY_MIN, DOWL, MON, hm, parseTime, parts, toInstant, weekday, type Span } from '@/lib/dates';
import { moved, occurrenceKey, type Occurrence } from '@/lib/occurrences';
import { backToPlan, deleteEvent, endSeriesBefore, setPlanStatus, skipOccurrence, updateEvent } from '@/lib/store';
import type { Frequency } from '@/lib/types';
import { CAT, CATEGORIES, SURFACE } from './ui';

const ACTION = 'h-8 rounded-[4px] px-2 text-[12.5px]';
const FIELD = 'bg-transparent outline-none focus:shadow-[0_1px_0_var(--line)]';

interface Props {
  o: Occurrence;
  mobile: boolean;
  style: CSSProperties;
  onSelect: (key: string | null) => void;
}

/** Shows one event and edits it in place. Changes to a repeating event apply to the whole series. */
export function EventPopover({ o, mobile, style, onSelect }: Props) {
  const ev = o.event;
  const fromPlan = ev.planItemId;
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
    } else {
      // No longer repeating: what remains is the day being looked at.
      updateEvent(ev.id, { start: toInstant(o.date, o.start), end: toInstant(o.date, o.end), recurrence: null });
    }
  };

  const close = () => onSelect(null);

  return (
    <div
      data-popover
      style={style}
      className={`absolute z-[8] flex w-[260px] scroll-mt-24 scroll-mb-4 flex-col gap-[5px] px-4 pt-3.5 pb-2 select-text ${SURFACE}`}
    >
      <div className="flex items-center gap-2 text-[11px] tracking-[.08em] text-muted">
        <span className="size-1.5 rounded-full" style={{ background: CAT[ev.category] }} />
        <label className="relative transition-colors duration-150 hover:text-ink has-[:focus-visible]:text-ink has-[:focus-visible]:underline">
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
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>

      <input
        key={ev.title}
        aria-label="Title"
        defaultValue={ev.title}
        onBlur={(e) => {
          const title = e.target.value.trim();
          if (!title) e.target.value = ev.title;
          else if (title !== ev.title) updateEvent(ev.id, { title });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.currentTarget.value = ev.title;
            close();
          }
        }}
        className={`w-full font-mincho text-[20px] leading-[1.3] ${FIELD} ${o.done ? 'text-muted line-through' : 'text-ink'}`}
      />

      <div className={`flex items-center gap-1 text-ink2 tabular-nums ${mobile ? 'text-[16px]' : 'text-[13px]'}`}>
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
      </div>

      <div className="-ml-1.5 flex items-center">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            aria-label={c.label}
            aria-pressed={ev.category === c.id}
            title={c.label}
            onClick={() => updateEvent(ev.id, { category: c.id })}
            className="grid size-6 place-items-center rounded-full"
          >
            <span
              className="size-2 rounded-full"
              style={{ background: CAT[c.id], boxShadow: ev.category === c.id ? `0 0 0 2px var(--bg), 0 0 0 3px ${CAT[c.id]}` : 'none' }}
            />
          </button>
        ))}
        {!fromPlan && (
          <select
            aria-label="Repeat"
            value={ev.recurrence?.freq ?? ''}
            onChange={(e) => setRepeat(e.target.value)}
            className={`ml-auto cursor-pointer appearance-none bg-transparent text-muted outline-none [text-align-last:right] hover:text-ink focus-visible:text-ink ${mobile ? 'text-[16px]' : 'text-[12px]'}`}
          >
            <option value="">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            <option value="yearly">Every year</option>
          </select>
        )}
      </div>

      {choosingDelete ? (
        <div role="group" aria-label="Delete repeating event" className="-mx-2 mt-1.5 flex gap-1 border-t border-line pt-2">
          <button
            onClick={() => {
              skipOccurrence(ev.id, o.date);
              close();
            }}
            className={`${ACTION} text-ink2 hover:bg-wash`}
          >
            This one
          </button>
          <button
            onClick={() => {
              endSeriesBefore(ev.id, o.date);
              close();
            }}
            className={`${ACTION} text-ink2 hover:bg-wash`}
          >
            This and after
          </button>
          <button
            onClick={() => {
              deleteEvent(ev.id);
              close();
            }}
            className={`${ACTION} ml-auto text-muted hover:text-verm`}
          >
            All
          </button>
        </div>
      ) : (
        <div className="-mx-2 mt-1.5 flex gap-1 border-t border-line pt-2">
          {/* Only an event that came from Plan is a task: it can be done, or go back to waiting. */}
          {fromPlan && (
            <>
              <button
                onClick={() => {
                  setPlanStatus(fromPlan, o.done ? 'open' : 'completed');
                  close();
                }}
                className={`${ACTION} text-ink hover:bg-wash`}
              >
                {o.done ? 'Not done' : 'Mark done'}
              </button>
              <button
                onClick={() => {
                  backToPlan(ev.id);
                  close();
                }}
                className={`${ACTION} text-ink2 hover:bg-wash`}
              >
                Back to Plan
              </button>
            </>
          )}
          <button
            onClick={() => {
              if (ev.recurrence) return setChoosingDelete(true);
              deleteEvent(ev.id);
              close();
            }}
            className={`${ACTION} ml-auto text-muted hover:text-verm`}
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
      className={`${wide ? 'w-[41px]' : 'w-[33px]'} ${FIELD}`}
    />
  );
}
