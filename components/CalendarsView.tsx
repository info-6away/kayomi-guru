'use client';

import { disconnect, showCalendar, sync, type External } from '@/lib/calendars/store';
import { hm } from '@/lib/dates';

const QUIET = 'underline decoration-line underline-offset-4 hover:text-ink2 disabled:no-underline disabled:opacity-60';
const ROW = 'flex min-h-11 items-center gap-3 rounded-[4px] px-3.5';

/** Leaves the calendar for 6Away's sign-in (if needed) and Google's own consent screen. */
const connect = () => location.assign('/api/google/connect');

const readAt = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return `${sameDay ? '' : `${d.getDate()}/${d.getMonth() + 1} `}${hm(d.getHours() * 60 + d.getMinutes())}`;
};

/**
 * Which calendars are on screen: Koyomi's own, always, and any connected from outside.
 * This is all there is to it. No accounts page, no settings.
 */
export function CalendarsView({ external, mobile, onBack }: { external: External; mobile: boolean; onBack: () => void }) {
  const { status, calendars, syncing, note } = external;
  const read = calendars.reduce<string | null>((latest, c) => (c.fetchedAt && (!latest || c.fetchedAt > latest) ? c.fetchedAt : latest), null);

  return (
    <>
      <div className="flex flex-none items-baseline gap-3 pt-5 pr-3.5 pb-3.5 pl-[26px]">
        <span className="font-mincho text-[24px] leading-none">Calendars</span>
        <span className="flex-1" />
        <button onClick={onBack} aria-label="Back to Plan" className="size-9 self-center rounded-full text-[18px] text-muted hover:bg-wash hover:text-ink">
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-5">
        <div className={`${ROW} text-[15px] text-ink`}>
          <span className="flex-1">Koyomi</span>
          <span className="text-ink2">✓</span>
        </div>

        {status === 'off' ? (
          <>
            <div className={`${ROW} text-[15px] text-ink`}>
              <span className="flex-1">Google Calendar</span>
              <button onClick={connect} className="h-8 rounded-full border border-line px-3.5 text-[12.5px] text-ink2 hover:border-stone hover:text-ink">
                Connect
              </button>
            </div>
            <p className="mx-3.5 mt-3 text-[12px] leading-[1.6] text-pretty text-muted">
              Koyomi can show your Google calendars beside your own, to read only. Connecting asks you to sign in with 6Away, then to let Koyomi read
              them. It can never change them.
            </p>
          </>
        ) : (
          <>
            <p className="mt-4 mb-1 px-3.5 text-[10.5px] tracking-[.18em] text-dow">GOOGLE</p>
            {calendars.map((c) => (
              <button
                key={c.id}
                role="switch"
                aria-checked={c.visible}
                onClick={() => void showCalendar(c.calendarId, !c.visible)}
                className={`${ROW} w-full text-left text-[15px] hover:bg-wash ${mobile ? 'min-h-[52px]' : ''}`}
              >
                <span className={`min-w-0 flex-1 truncate ${c.visible ? 'text-ink' : 'text-ink2'}`}>{c.name}</span>
                {c.visible ? <span className="text-ink2">✓</span> : <span className="mr-px size-2.5 rounded-full border border-ink2" />}
              </button>
            ))}
            {!calendars.length && <p className="px-3.5 py-2 text-[13px] text-muted">{syncing ? 'Reading your calendars…' : 'No calendars yet.'}</p>}

            {status === 'reconnect' && (
              <div className={`${ROW} mt-3 text-[13px] text-ink2`}>
                <span className="flex-1">Google Calendar needs reconnecting</span>
                <button onClick={connect} className="h-8 rounded-full border border-line px-3.5 text-[12.5px] text-ink2 hover:border-stone hover:text-ink">
                  Reconnect
                </button>
              </div>
            )}
          </>
        )}

        {note && (
          <p role="status" className="mx-3.5 mt-3 text-[12.5px] leading-[1.6] text-ink2">
            {note}
          </p>
        )}
      </div>

      {status !== 'off' && (
        <div className="flex-none px-[26px] pt-2.5 pb-[22px] text-[12px] leading-[1.6] text-muted">
          Read only. Koyomi never changes your Google Calendar.
          <span className="mt-1 flex flex-wrap items-center gap-x-4">
            {status === 'connected' && (
              <button onClick={() => void sync()} disabled={syncing} className={QUIET}>
                {syncing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
            <button onClick={() => void disconnect()} disabled={syncing} className={QUIET}>
              Disconnect
            </button>
            {read && <span className="ml-auto tabular-nums">Read {readAt(read)}</span>}
          </span>
        </div>
      )}
    </>
  );
}
