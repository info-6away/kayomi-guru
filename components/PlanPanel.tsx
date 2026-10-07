'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { External } from '@/lib/calendars/store';
import { install, useCanInstall } from '@/lib/install';
import { addPlanItem, setPlanStatus } from '@/lib/store';
import type { PlanItem } from '@/lib/types';
import { CalendarsView } from './CalendarsView';
import { things } from './ui';

interface Props {
  mobile: boolean;
  open: boolean;
  /** On a wide screen the drawer sits beside the calendar instead of over it. */
  pushes: boolean;
  /** Open items with no time yet: the active Plan. */
  waiting: PlanItem[];
  done: PlanItem[];
  placingId: string | null;
  dragPlan: RefObject<PlanItem | null>;
  /** Connected calendars, and whether the drawer is showing them instead of Plan. */
  external: External;
  view: 'plan' | 'calendars';
  onView: (view: 'plan' | 'calendars') => void;
  onClose: () => void;
  onPlace: (item: PlanItem) => void;
}

export function PlanPanel({ mobile, open, pushes, waiting, done, placingId, dragPlan, external, view, onView, onClose, onPlace }: Props) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canInstall = useCanInstall();
  const slideMs = mobile ? 260 : 220;

  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

  const add = () => {
    const title = text.trim();
    if (title) addPlanItem(title);
    setText('');
    return !!title;
  };

  return (
    <section
      aria-label={view === 'calendars' ? 'Calendars' : 'Plan'}
      className={
        mobile
          ? 'absolute inset-x-0 bottom-0 z-30 flex h-[74%] flex-col rounded-t-2xl bg-paper pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_50px_-24px_var(--shadow)]'
          : 'absolute top-16 right-0 bottom-0 z-20 flex w-80 flex-col border-l border-line bg-paper'
      }
      style={{
        transform: open ? 'none' : mobile ? 'translateY(104%)' : 'translateX(101%)',
        // Hidden once it has slid away, so nothing inside can take focus.
        visibility: open ? 'visible' : 'hidden',
        transition: `transform ${slideMs}ms cubic-bezier(.2,0,0,1), visibility 0s linear ${open ? 0 : slideMs}ms`,
        boxShadow: mobile ? undefined : open && !pushes ? '-24px 0 48px -32px var(--shadow)' : 'none',
      }}
    >
      {mobile && (
        <div onClick={onClose} className="grid h-[22px] flex-none cursor-pointer place-items-center">
          <span className="h-1 w-9 rounded-[2px] bg-line" />
        </div>
      )}

      {view === 'calendars' ? (
        <CalendarsView external={external} mobile={mobile} onBack={() => onView('plan')} />
      ) : (
        <>

      <div className="flex flex-none items-baseline gap-3 pt-5 pr-3.5 pb-3.5 pl-[26px]">
        <span className="font-mincho text-[24px] leading-none">Plan</span>
        <span className="flex-1 text-[12.5px] text-muted">{things(waiting.length)}</span>
        <button
          onClick={onClose}
          aria-label="Close plan"
          className="size-9 self-center rounded-full text-[18px] text-muted hover:bg-wash hover:text-ink"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-5">
        {waiting.map((item) => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => {
              dragPlan.current = item;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', item.title);
            }}
            onDragEnd={() => (dragPlan.current = null)}
            className={`flex cursor-grab items-center gap-1.5 rounded-[4px] pr-3 pl-1.5 transition-colors duration-150 hover:bg-wash ${
              mobile ? 'min-h-[52px]' : 'min-h-11'
            } ${placingId === item.id ? 'bg-wash' : ''}`}
          >
            <button
              onClick={() => setPlanStatus(item.id, 'completed')}
              aria-label={`Mark done: ${item.title}`}
              className="grid size-8 flex-none place-items-center rounded-full"
            >
              <span className="size-3.5 rounded-full border border-ink2" />
            </button>
            <button onClick={() => onPlace(item)} className="min-w-0 flex-1 cursor-[inherit] py-2 text-left text-[15px] leading-[1.4] text-ink">
              {item.title}
            </button>
          </div>
        ))}

        {adding ? (
          <div className="flex min-h-11 items-center gap-1.5 pr-3 pl-1.5">
            <span className="grid w-8 flex-none place-items-center">
              <span className="size-3.5 rounded-full border border-dashed border-stone" />
            </span>
            <input
              ref={input}
              aria-label="New Plan item"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setText('');
                  setAdding(false);
                }
                // Enter keeps the field open for the next thought; an empty Enter closes it.
                if (e.key === 'Enter' && !add()) setAdding(false);
              }}
              onBlur={() => {
                add();
                setAdding(false);
              }}
              placeholder="Something to do"
              className={`h-8 min-w-0 flex-1 bg-transparent p-0 text-ink caret-verm outline-none ${mobile ? 'text-[16px]' : 'text-[15px]'}`}
            />
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex min-h-11 w-full items-center gap-1.5 rounded-[4px] pr-3 pl-1.5 text-left text-[14px] text-muted hover:bg-wash hover:text-ink"
          >
            <span className="w-8 text-center text-[17px] font-light">＋</span>Add
          </button>
        )}

        {waiting.length === 0 && (
          <p className="mx-3.5 mt-[18px] font-mincho text-[15px] leading-[1.7] text-pretty text-ink2">
            Nothing waiting.
            <br />
            Your week has space in it.
          </p>
        )}

      </div>

      {done.length > 0 && (
        <div className="max-h-[40%] flex-none overflow-y-auto px-3 pb-1">
          <button
            onClick={() => setDoneOpen(!doneOpen)}
            aria-expanded={doneOpen}
            className="flex h-9 items-center gap-2 px-3.5 text-[12px] tracking-[.03em] text-muted hover:text-ink2"
          >
            <span>Completed</span>
            <span className="tabular-nums">{done.length}</span>
            <span className={`inline-block transition-transform duration-200 ease-kayomi ${doneOpen ? 'rotate-90' : ''}`}>›</span>
          </button>
          {doneOpen &&
            done.map((item) => (
              <div key={item.id} className="flex min-h-10 items-center gap-1.5 pr-3 pl-1.5">
                <button
                  onClick={() => setPlanStatus(item.id, 'open')}
                  aria-label={`Mark not done: ${item.title}`}
                  className="grid size-8 flex-none place-items-center"
                >
                  <span className="size-3.5 rounded-full bg-stone" />
                </button>
                <span className="text-[14px] text-muted line-through decoration-stone">{item.title}</span>
              </div>
            ))}
        </div>
      )}

      <div className="flex-none px-[26px] pt-2.5 pb-[22px] text-[12px] leading-[1.6] text-muted">
        {mobile ? 'Tap a thing, then tap a time to schedule it.' : 'Drag onto your week, or click a thing and choose a time.'}
        {/* Only where the server is set up for it. The way to calendars from elsewhere, kept out of the way. */}
        {external.available && (
          <button onClick={() => onView('calendars')} className="mt-1 block underline decoration-line underline-offset-4 hover:text-ink2">
            {external.status === 'reconnect' ? 'Calendars · needs reconnecting' : 'Calendars'}
          </button>
        )}
        {/* Only while the browser offers it: never in Safari or Firefox, and never once installed. */}
        {canInstall && (
          <button onClick={install} className="mt-1 block underline decoration-line underline-offset-4 hover:text-ink2">
            Install Koyomi
          </button>
        )}
      </div>
        </>
      )}
    </section>
  );
}
