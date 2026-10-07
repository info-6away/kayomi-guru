'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { DAY_MIN, DOW, clamp, hm, pad, parts, weekday, type Span } from '@/lib/dates';
import { layoutDay, type Occurrence } from '@/lib/occurrences';
import type { PlanItem } from '@/lib/types';
import { EventPopover } from './EventPopover';
import { CAT, type Slot } from './ui';

/** Room kept under a popover so it stays inside the grid late in the day. */
const POPOVER_ROOM = 230;
/** Moving and resizing snap to this many minutes. */
const SNAP = 15;

interface Props {
  /** One day, or the seven days of a week. */
  days: string[];
  mobile: boolean;
  today: string;
  now: number;
  byDay: Map<string, Occurrence[]>;
  /** Height of one hour, in pixels. */
  hourH: number;
  sel: string | null;
  qa: Slot | null;
  /** The Plan item waiting for the user to choose a time. */
  placing: PlanItem | null;
  /** The Plan item being dragged in from the Plan drawer. */
  dragPlan: RefObject<PlanItem | null>;
  scroller: RefObject<HTMLDivElement | null>;
  onSelect: (key: string | null) => void;
  onQa: (slot: Slot | null) => void;
  onCreate: (slot: Slot, title: string) => void;
  onPlace: (itemId: string, date: string, min: number) => void;
  onMove: (o: Occurrence, to: Span) => void;
  onOpenDay: (date: string) => void;
  onSwipe: (dir: number) => void;
}

export function Timeline(p: Props) {
  const { days, mobile, today, now, sel, qa, placing, hourH } = p;
  const n = days.length;
  const oneDay = n === 1;
  const gutter = mobile ? 52 : oneDay ? 56 : 60;
  const cols = `${gutter}px repeat(${n}, minmax(0, 1fr))`;
  const todayShown = days.includes(today);
  const eventW = oneDay ? 'min(460px, calc(100% - 8px))' : 'calc(100% - 8px)';
  const minH = mobile ? 30 : 22;
  const totalH = 24 * hourH;
  const yOf = (min: number) => (min / 60) * hourH;
  const nowTop = Math.round(yOf(now));
  const minuteAt = (clientY: number, column: Element) => ((clientY - column.getBoundingClientRect().top) / hourH) * 60;
  /** The half-hour under the pointer that an hour-long event can start in. */
  const slotAt = (clientY: number, column: Element) => clamp(Math.floor(minuteAt(clientY, column) / 30) * 30, 0, DAY_MIN - 60);

  const [hover, setHover] = useState<(Slot & { drag?: boolean }) | null>(null);
  const [drag, setDrag] = useState<(Span & { key: string }) | null>(null);
  const columns = useRef(new Map<string, HTMLDivElement>());
  const justDragged = useRef(false);
  const touch = useRef({ x: 0, y: 0 });

  useLayoutEffect(() => {
    // Always open just after 07:30, whatever the hour: with the hour height sized to the window,
    // that puts the working day (about 08:00 to 20:00) on screen without scrolling.
    // Only when the timeline first appears; after that the scroll position is the user's.
    if (p.scroller.current) p.scroller.current.scrollTop = Math.round(7.6 * hourH);
  }, []);

  useEffect(() => {
    if (sel) p.scroller.current?.querySelector('[data-popover]')?.scrollIntoView({ block: 'nearest' });
  }, [sel, p.scroller]);

  useEffect(() => {
    const clear = () => setHover(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  /** Moves an event, or changes its end, by dragging with a mouse or pen. Touch scrolls instead. */
  const beginDrag = (e: ReactPointerEvent, o: Occurrence, mode: 'move' | 'resize') => {
    if (e.pointerType === 'touch' || e.button !== 0 || placing) return;
    e.stopPropagation();
    const origin = columns.current.get(o.date);
    if (!origin) return;
    const grab = minuteAt(e.clientY, origin) - o.start;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let date = o.date;
    let last: (Span & { key: string }) | null = null;

    const onMove = (ev: PointerEvent) => {
      if (!last && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (mode === 'move') {
        for (const [key, el] of columns.current) {
          const r = el.getBoundingClientRect();
          if (ev.clientX >= r.left && ev.clientX < r.right) date = key;
        }
      }
      const column = columns.current.get(date);
      if (!column) return;
      const at = Math.round(minuteAt(ev.clientY, column) / SNAP) * SNAP;
      let { start, end } = o;
      if (mode === 'move') {
        start = clamp(Math.round((minuteAt(ev.clientY, column) - grab) / SNAP) * SNAP, 0, DAY_MIN - (o.end - o.start));
        end = start + (o.end - o.start);
      } else {
        end = clamp(at, o.start + SNAP, DAY_MIN);
      }
      last = { key: o.key, date, start, end };
      setHover(null);
      setDrag(last);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      if (!last) return;
      // The click that ends a drag must not select the event or open quick-add.
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      if (last.date !== o.date || last.start !== o.start || last.end !== o.end) p.onMove(o, last);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const popoverStyle = (o: Occurrence): CSSProperties => {
    const top = yOf(o.start);
    const h = Math.max(22, yOf(o.end - o.start) - 2);
    const i = days.indexOf(o.date);
    if (mobile) return { top: Math.min(top + h + 8, totalH - POPOVER_ROOM), left: gutter + 8, right: 8, width: 'auto' };
    if (oneDay) return { top: Math.min(top, totalH - POPOVER_ROOM), left: `calc(${gutter}px + min(476px, 100% - 270px))` };
    return {
      top: Math.min(top, totalH - POPOVER_ROOM),
      left:
        i < 5
          ? `calc(${gutter}px + (100% - ${gutter}px) * ${(i + 1) / n} + 6px)`
          : `calc(${gutter}px + (100% - ${gutter}px) * ${i / n} - 266px)`,
    };
  };

  const shown = days.flatMap((d) => p.byDay.get(d) ?? []);
  const selected = sel ? shown.find((o) => o.key === sel) : undefined;
  const dragged = drag ? shown.find((o) => o.key === drag.key) : undefined;
  const incoming = hover?.drag ? p.dragPlan.current?.title : placing?.title;

  return (
    <div
      ref={p.scroller}
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        if (!mobile) return;
        const dx = e.changedTouches[0].clientX - touch.current.x;
        const dy = e.changedTouches[0].clientY - touch.current.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) p.onSwipe(dx < 0 ? 1 : -1);
      }}
      className="relative h-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto [overflow-anchor:none]"
    >
      {!mobile && n === 7 && (
        <div className="sticky top-0 z-[7] grid border-b border-line bg-bg pt-2.5 pb-3" style={{ gridTemplateColumns: cols }}>
          <div />
          {days.map((key) => {
            const isToday = key === today;
            const wkend = weekday(key) % 6 === 0;
            return (
              <button
                key={key}
                onClick={() => p.onOpenDay(key)}
                className="flex min-w-0 flex-col gap-[7px] rounded-[4px] px-3 py-1 text-left hover:bg-wash"
              >
                <span className={`flex h-3 items-center gap-[7px] text-[10.5px] tracking-[.18em] ${isToday ? 'text-ink' : 'text-dow'}`}>
                  {DOW[weekday(key)]}
                  {isToday && <span className="size-[5px] rounded-full bg-verm" />}
                </span>
                <span className={`font-mincho text-[26px] leading-none ${isToday ? 'text-verm' : wkend ? 'text-ink2' : 'text-ink'}`}>
                  {parts(key).d}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        className="relative grid select-none"
        style={{
          gridTemplateColumns: cols,
          height: totalH,
          margin: oneDay && !mobile ? '24px 40px 40px 0' : '0 0 40px',
          paddingRight: n === 7 ? 12 : 0,
        }}
      >
        <div className="relative">
          {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
            <span
              key={h}
              className="absolute text-[11px] leading-[14px] tracking-[.04em] text-hour tabular-nums"
              style={{ top: h * hourH - 7, right: mobile ? 12 : 14, opacity: todayShown && Math.abs(now - h * 60) < 14 ? 0 : 1 }}
            >
              {pad(h)}
            </span>
          ))}
          {todayShown && (
            <span
              className="absolute text-[11px] leading-[14px] font-medium text-verm tabular-nums"
              style={{ top: nowTop - 7, right: mobile ? 10 : 12 }}
            >
              {hm(now)}
            </span>
          )}
        </div>

        {days.map((key, i) => {
          const wkend = weekday(key) % 6 === 0;
          const placed = layoutDay(p.byDay.get(key) ?? [], (minH / hourH) * 60);
          const ghost = hover && hover.date === key && !(qa && qa.date === key && qa.min === hover.min) ? hover : null;
          return (
            <div
              key={key}
              data-day={key}
              ref={(el) => {
                if (el) columns.current.set(key, el);
                else columns.current.delete(key);
              }}
              onClick={(e) => {
                if (e.target !== e.currentTarget || justDragged.current) return;
                const min = slotAt(e.clientY, e.currentTarget);
                setHover(null);
                if (placing) p.onPlace(placing.id, key, min);
                else if (selected) p.onSelect(null);
                else p.onQa({ date: key, min });
              }}
              onPointerMove={(e) => {
                if (e.pointerType !== 'mouse' || drag) return;
                if (e.target !== e.currentTarget && !placing) {
                  if (hover) setHover(null);
                  return;
                }
                const min = slotAt(e.clientY, e.currentTarget);
                if (!hover || hover.date !== key || hover.min !== min) setHover({ date: key, min });
              }}
              onPointerLeave={() => hover && setHover(null)}
              onDragOver={(e) => {
                if (!p.dragPlan.current) return;
                e.preventDefault();
                const min = slotAt(e.clientY, e.currentTarget);
                if (!hover || hover.date !== key || hover.min !== min) setHover({ date: key, min, drag: true });
              }}
              onDrop={(e) => {
                e.preventDefault();
                setHover(null);
                if (p.dragPlan.current) p.onPlace(p.dragPlan.current.id, key, slotAt(e.clientY, e.currentTarget));
              }}
              className="relative min-w-0"
              style={{
                height: totalH,
                borderLeft: n > 1 ? '1px solid var(--line2)' : 0,
                backgroundColor: wkend && n > 1 ? 'color-mix(in oklab, var(--ink) 2.5%, transparent)' : 'transparent',
                backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${hourH}px)`,
                cursor: placing ? 'copy' : 'default',
              }}
            >
              {ghost && (
                <div
                  className={`pointer-events-none absolute left-1 z-[1] flex overflow-hidden rounded-[3px] bg-wash text-[11.5px] whitespace-nowrap text-muted tabular-nums ${
                    incoming ? 'items-start border border-dashed border-stone px-2.5 py-1.5' : 'items-center px-2.5'
                  }`}
                  style={{ top: yOf(ghost.min) + 1, height: incoming ? hourH - 2 : hourH / 2 - 1, width: eventW }}
                >
                  {incoming ? `${hm(ghost.min)}  ${incoming}` : hm(ghost.min)}
                </div>
              )}

              {key === today && (
                <div className="pointer-events-none absolute inset-x-0 z-[3] h-px bg-verm" style={{ top: nowTop }}>
                  <span className="absolute -top-[3px] -left-1 size-[7px] rounded-full bg-verm" />
                </div>
              )}

              {placed.map(({ item: o, col, cols: of }) => {
                const isSel = sel === o.key;
                const past = o.date < today || (o.date === today && o.end <= now);
                const moving = drag?.key === o.key;
                // What is over steps back, unless it is the event being looked at.
                const receded = past && !isSel;
                return (
                  <EventBox
                    key={o.key}
                    o={o}
                    mobile={mobile}
                    receded={receded}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!justDragged.current) p.onSelect(isSel ? null : o.key);
                    }}
                    onPointerDown={(e) => beginDrag(e, o, 'move')}
                    onResizeDown={(e) => beginDrag(e, o, 'resize')}
                    style={{
                      top: yOf(o.start) + 1,
                      height: Math.max(minH, yOf(o.end - o.start) - 2),
                      left: `calc(4px + ${eventW} * ${col / of})`,
                      width: of > 1 ? `calc(${eventW} / ${of} - 2px)` : eventW,
                      background: `color-mix(in oklab, ${CAT[o.event.category]} ${isSel ? 'var(--tint-selected)' : receded ? 'var(--past-tint)' : 'var(--tint)'}, transparent)`,
                      opacity: moving ? 0.3 : receded ? 'var(--past-opacity)' : 1,
                      zIndex: isSel ? 4 : 2,
                    }}
                  />
                );
              })}

              {drag && dragged && drag.date === key && (
                <EventBox
                  o={{ ...dragged, start: drag.start, end: drag.end }}
                  mobile={mobile}
                  style={{
                    top: yOf(drag.start) + 1,
                    height: Math.max(minH, yOf(drag.end - drag.start) - 2),
                    left: 4,
                    width: eventW,
                    background: `color-mix(in oklab, ${CAT[dragged.event.category]} var(--tint-selected), var(--bg))`,
                    zIndex: 5,
                    pointerEvents: 'none',
                  }}
                />
              )}

              {qa && qa.date === key && (
                <QuickAdd
                  key={qa.min}
                  slot={qa}
                  mobile={mobile}
                  onCommit={(title) => p.onCreate(qa, title)}
                  onCancel={() => p.onQa(null)}
                  style={{
                    top: yOf(qa.min) + 1,
                    height: hourH - 2,
                    ...(oneDay || mobile
                      ? { left: 4, width: oneDay && !mobile ? eventW : 'calc(100% - 8px)' }
                      : { [i >= 5 ? 'right' : 'left']: 4, width: 'max(calc(100% - 8px), 260px)' }),
                  }}
                />
              )}
            </div>
          );
        })}

        {selected && <EventPopover key={selected.key} o={selected} mobile={mobile} style={popoverStyle(selected)} onSelect={p.onSelect} />}
      </div>
    </div>
  );
}

function EventBox({
  o,
  mobile,
  receded = false,
  style,
  onClick,
  onPointerDown,
  onResizeDown,
}: {
  o: Occurrence;
  mobile: boolean;
  /** A past event: drawn quieter, but still easy to read. How much quieter is set per theme in globals.css. */
  receded?: boolean;
  style: CSSProperties;
  onClick?: (e: ReactMouseEvent) => void;
  onPointerDown?: (e: ReactPointerEvent) => void;
  onResizeDown?: (e: ReactPointerEvent) => void;
}) {
  const tall = (style.height as number) >= 40;
  return (
    <div
      data-event={o.key}
      role="button"
      tabIndex={onClick ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) e.currentTarget.click();
      }}
      onPointerDown={onPointerDown}
      className={`absolute flex cursor-pointer overflow-hidden rounded-[3px] pr-2 pl-3 transition-[background-color,opacity] duration-180 ease-kayomi hover:shadow-[inset_0_0_0_1px_var(--line)] ${
        tall ? 'flex-col items-start gap-px pt-[5px]' : 'items-center gap-2'
      }`}
      style={style}
    >
      <span
        className="absolute top-1 bottom-1 left-0.5 w-0.5 rounded-[1px]"
        style={{ background: o.done ? 'var(--stone)' : CAT[o.event.category], opacity: receded ? 'var(--past-bar)' : undefined }}
      />
      <span
        className={`max-w-full min-w-0 shrink truncate leading-[1.35] font-medium ${mobile ? 'text-[15px]' : 'text-[13px]'} ${
          o.done ? 'text-muted line-through' : receded ? 'text-past-title' : 'text-ink'
        }`}
      >
        {o.event.title}
      </span>
      <span
        className={`flex-none tracking-[.02em] whitespace-nowrap tabular-nums ${receded ? 'text-past-time' : 'text-event-time'} ${
          mobile ? 'text-[12.5px]' : 'text-[11.5px]'
        }`}
      >
        {tall ? `${hm(o.start)} – ${hm(o.end)}` : hm(o.start)}
      </span>
      {onResizeDown && <span onPointerDown={onResizeDown} className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" />}
    </div>
  );
}

/** The inline "14:00 │ What are you doing?" field. Enter creates the event; nothing else is asked. */
function QuickAdd({
  slot,
  mobile,
  style,
  onCommit,
  onCancel,
}: {
  slot: Slot;
  mobile: boolean;
  style: CSSProperties;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit) onCommit(input.current?.value.trim() ?? '');
    else onCancel();
  };

  return (
    <div
      className="absolute z-[6] flex animate-in items-start gap-2 rounded-[3px] border-l-2 border-verm bg-bg pt-[3px] pr-2.5 pl-3 shadow-[0_10px_28px_-14px_var(--shadow),0_0_0_1px_var(--line)] select-text"
      style={style}
    >
      <span className="flex-none text-[12px] leading-[26px] tracking-[.03em] text-verm tabular-nums">{hm(slot.min)}</span>
      <span className="mt-[5px] h-4 w-px flex-none bg-line" />
      <input
        ref={input}
        aria-label="New event"
        placeholder="What are you doing?"
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
        className={`h-[26px] min-w-0 flex-1 bg-transparent p-0 text-ink caret-verm outline-none ${mobile ? 'text-[16px]' : 'text-[14px]'}`}
      />
      <span className="flex-none text-[11px] leading-[26px] text-muted">↵</span>
    </div>
  );
}
