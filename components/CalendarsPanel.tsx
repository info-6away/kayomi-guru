'use client';

import { addAccount, disconnect, showCalendar, signIn, sync, type External } from '@/lib/calendars/store';
import { hm } from '@/lib/dates';
import { install, useCanInstall } from '@/lib/install';

const QUIET = 'underline decoration-line underline-offset-4 hover:text-ink2 disabled:no-underline disabled:opacity-60';
const ROW = 'flex min-h-11 items-center gap-3 rounded-[4px] px-3.5';
const PILL = 'h-8 flex-none rounded-full border border-line px-3.5 text-[12.5px] text-ink2 hover:border-stone hover:text-ink';
const GROUP = 'px-3.5 text-[10.5px] tracking-[.18em] text-dow';

/** What Koyomi reads from a connected calendar, where it is kept and what it is used for. */
const PRIVACY = 'https://koyomi.guru/privacy';

const PROVIDERS = [{ id: 'google', heading: 'GOOGLE', unnamed: 'Google account' }] as const;

const readAt = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return `${sameDay ? '' : `${d.getDate()}/${d.getMonth() + 1} `}${hm(d.getHours() * 60 + d.getMinutes())}`;
};

interface Props {
  mobile: boolean;
  open: boolean;
  /** On a wide screen the drawer sits beside the calendar instead of over it. */
  pushes: boolean;
  external: External;
  onClose: () => void;
}

/**
 * Which calendars are on screen: Koyomi's own, always, and those of any account connected from
 * outside, each account under its own address. This is all there is to it. No accounts page,
 * no settings.
 */
export function CalendarsPanel({ mobile, open, pushes, external, onClose }: Props) {
  const { available, status, connections, calendars, syncing, note } = external;
  const canInstall = useCanInstall();
  const slideMs = mobile ? 260 : 220;
  const read = calendars.reduce<string | null>((latest, c) => (c.fetchedAt && (!latest || c.fetchedAt > latest) ? c.fetchedAt : latest), null);

  return (
    <section
      aria-label="Calendars"
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

      <div className="flex flex-none items-baseline gap-3 pt-5 pr-3.5 pb-3.5 pl-[26px]">
        <span className="font-mincho text-[24px] leading-none">Calendars</span>
        <span className="flex-1" />
        <button onClick={onClose} aria-label="Close calendars" className="size-9 self-center rounded-full text-[18px] text-muted hover:bg-wash hover:text-ink">
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-5">
        <div className={`${ROW} text-[15px] text-ink`}>
          <span className="flex-1">Koyomi</span>
          <span className="text-ink2">✓</span>
        </div>

        {PROVIDERS.map((provider) => {
          const accounts = connections.filter((connection) => connection.provider === provider.id);
          if (!accounts.length) return null;
          return (
            <div key={provider.id}>
              <p className={`${GROUP} mt-4`}>{provider.heading}</p>
              {accounts.map((connection) => {
                // An account is known by its address. Until that has been read, by what it is.
                const name = connection.account ?? provider.unnamed;
                const own = calendars.filter((calendar) => calendar.connectionId === connection.id);
                return (
                  <div key={connection.id} role="group" aria-label={name} className="mt-1.5">
                    <div className="flex min-h-9 items-center gap-3 px-3.5">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink2">{name}</span>
                      <button onClick={() => void disconnect(connection.id)} disabled={syncing} aria-label={`Disconnect ${name}`} className={`flex-none text-[12px] text-muted ${QUIET}`}>
                        Disconnect
                      </button>
                    </div>
                    {own.map((c) => (
                      <button
                        key={c.id}
                        role="switch"
                        aria-checked={c.visible}
                        onClick={() => void showCalendar(c.id, !c.visible)}
                        className={`${ROW} w-full text-left text-[15px] hover:bg-wash ${mobile ? 'min-h-[52px]' : ''}`}
                      >
                        <span className={`min-w-0 flex-1 truncate ${c.visible ? 'text-ink' : 'text-ink2'}`}>{c.name}</span>
                        {c.visible ? <span className="text-ink2">✓</span> : <span className="mr-px size-2.5 rounded-full border border-ink2" />}
                      </button>
                    ))}
                    {!own.length && connection.status === 'connected' && <p className="px-3.5 py-2 text-[13px] text-muted">{syncing ? 'Reading its calendars…' : 'No calendars yet.'}</p>}
                    {/* Only when Google itself has refused this account's permission. The others carry on. */}
                    {connection.status === 'reconnect' && (
                      <div className={`${ROW} text-[13px] text-ink2`}>
                        <span className="flex-1">Needs reconnecting</span>
                        <button onClick={addAccount} aria-label={`Reconnect ${name}`} className={PILL}>
                          Reconnect
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Said differently from an account that needs reconnecting, because it is a different thing.
            The sign-in ending leaves every connection where it is, so the way back is to sign in:
            Google is not asked again. */}
        {status === 'signin' && (
          <div className={`${ROW} mt-3 text-[13px] text-ink2`}>
            <span className="flex-1">Sign in again to keep Google Calendar up to date</span>
            <button onClick={signIn} className={PILL}>
              Sign in
            </button>
          </div>
        )}

        {/* Only where the server is set up for it. Without that, Koyomi's own calendar is all there is. */}
        {available && (
          <button
            onClick={addAccount}
            className={`flex min-h-11 w-full items-center gap-1.5 rounded-[4px] pr-3 pl-1.5 text-left text-[14px] text-muted hover:bg-wash hover:text-ink ${connections.length ? 'mt-3' : 'mt-1'}`}
          >
            <span className="w-8 text-center text-[17px] font-light">＋</span>Add calendar account
          </button>
        )}
        {available && status === 'off' && (
          <p className="mx-3.5 mt-3 text-[12px] leading-[1.6] text-pretty text-muted">
            Koyomi can show your Google calendars beside your own, to read only. Adding an account asks you to sign in with 6Away, then to let Koyomi
            read its calendars. It can never change them.{' '}
            {/* The policy is a page of the site, not of the calendar, so it opens beside it. */}
            <a href={PRIVACY} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-4 hover:text-ink2">
              Privacy
            </a>
          </p>
        )}

        {note && (
          <p role="status" className="mx-3.5 mt-3 text-[12.5px] leading-[1.6] text-ink2">
            {note}
          </p>
        )}
      </div>

      {(status !== 'off' || canInstall) && (
        <div className="flex-none px-[26px] pt-2.5 pb-[22px] text-[12px] leading-[1.6] text-muted">
          {status !== 'off' && (
            <>
              Read only. Koyomi never changes your Google Calendar.
              <span className="mt-1 flex flex-wrap items-center gap-x-4">
                {status === 'connected' && (
                  <button onClick={() => void sync()} disabled={syncing} className={QUIET}>
                    {syncing ? 'Refreshing…' : 'Refresh'}
                  </button>
                )}
                {read && <span className="ml-auto tabular-nums">Read {readAt(read)}</span>}
              </span>
            </>
          )}
          {/* Only while the browser offers it: never in Safari or Firefox, and never once installed. */}
          {canInstall && (
            <button onClick={install} className="mt-1 block underline decoration-line underline-offset-4 hover:text-ink2">
              Install Koyomi
            </button>
          )}
        </div>
      )}
    </section>
  );
}
