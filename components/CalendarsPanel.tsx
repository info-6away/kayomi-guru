'use client';

import { useEffect, useState } from 'react';
import { addAccount, connectYahoo, disconnect, reconnect, refresh, showCalendar, signIn, stopAsking, type Asking, type External } from '@/lib/calendars/store';
import { PROVIDERS } from '@/lib/calendars/types';
import { WORDS, listed, which } from '@/lib/calendars/words';
import { hm } from '@/lib/dates';
import { install, useCanInstall } from '@/lib/install';

const QUIET = 'underline decoration-line underline-offset-4 hover:text-ink2 disabled:no-underline disabled:opacity-60';
const ROW = 'flex min-h-11 items-center gap-3 rounded-[4px] px-3.5';
const PILL = 'h-8 flex-none rounded-full border border-line px-3.5 text-[12.5px] text-ink2 hover:border-stone hover:text-ink';
const GROUP = 'px-3.5 text-[10.5px] tracking-[.18em] text-dow';

/** What Koyomi reads from a connected calendar, where it is kept and what it is used for. */
const PRIVACY = 'https://koyomi.guru/privacy';
/** Yahoo's own page on making an app password. */
const YAHOO_HELP = 'https://help.yahoo.com/kb/SLN15241.html';
const FIELD = 'h-10 w-full rounded-[4px] border border-line bg-bg px-3 text-[14px] text-ink outline-none focus:border-stone';

/**
 * Yahoo's connection, asked for here: there is no Yahoo page to send anyone to. The app password
 * is held by this form only until it is sent, then let go; it is never shown again or kept.
 */
function YahooForm({ asking }: { asking: Asking }) {
  const known = asking.connection?.account ?? null;
  const [email, setEmail] = useState(known ?? '');
  const [password, setPassword] = useState('');
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const secret = password;
    setPassword('');
    void connectYahoo(known ?? email, secret);
  };
  return (
    <form aria-label={known ? 'Reconnect Yahoo Calendar' : 'Connect Yahoo Calendar'} onSubmit={send} className="mx-3.5 mt-3 flex flex-col gap-2.5">
      <p className="text-[14px] text-ink">{known ? 'Reconnect Yahoo Calendar' : 'Connect Yahoo Calendar'}</p>
      {known ? (
        <p className="truncate text-[12.5px] text-ink2">{known}</p>
      ) : (
        <label className="flex flex-col gap-1 text-[12.5px] text-ink2">
          Yahoo email
          <input type="email" required autoComplete="email" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-[12.5px] text-ink2">
        Yahoo app password
        <input type="password" required autoComplete="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} />
      </label>
      <p className="text-[12px] leading-[1.6] text-pretty text-muted">
        Use a Yahoo app password, not your normal Yahoo password. To make one: Yahoo Account, Account Security, External connections, Create app
        password.{' '}
        <a href={YAHOO_HELP} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-4 hover:text-ink2">
          How
        </a>
      </p>
      {asking.error && (
        <p role="status" className="text-[12.5px] leading-[1.6] text-ink2">
          {asking.error}
        </p>
      )}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={asking.sending} className={`${PILL} disabled:opacity-60`}>
          {asking.sending ? 'Connecting…' : 'Connect Yahoo'}
        </button>
        <button type="button" onClick={stopAsking} className={`text-[12.5px] text-muted ${QUIET}`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Which accounts the person has opened or closed in Calendars, on this device: a convenience,
 * nothing more. Without it every account starts as it would on a new device.
 */
const FOLDS = 'koyomi-calendars-open';
const readFolds = (): Record<string, boolean> => {
  try {
    const kept = JSON.parse(localStorage.getItem(FOLDS) ?? '{}');
    return kept && typeof kept === 'object' ? kept : {};
  } catch {
    return {};
  }
};

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
  const { available, providers, status, connections, calendars, syncing, note, asking } = external;
  const canInstall = useCanInstall();
  const slideMs = mobile ? 260 : 220;
  const read = calendars.reduce<string | null>((latest, c) => (c.fetchedAt && (!latest || c.fetchedAt > latest) ? c.fetchedAt : latest), null);
  // Where more than one provider is offered, adding an account first asks which. Nothing more.
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    if (!open) setChoosing(false);
  }, [open]);
  const add = () => {
    if (asking) stopAsking();
    if (providers.length > 1) setChoosing(!choosing);
    else addAccount(providers[0]);
  };
  // Once a provider is chosen, the choice is done with.
  const choose = (id: (typeof providers)[number]) => {
    setChoosing(false);
    addAccount(id);
  };
  // What the words below are about: the providers of the accounts there are, or that could be added.
  const connected = which(connections.map((connection) => connection.provider));
  // With several accounts, each is one line until it is opened: its address, how many of its
  // calendars are shown, and the way in. With one, there is nothing to fold away.
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  useEffect(() => setFolds(readFolds()), []);
  const fold = (id: string, opened: boolean) =>
    setFolds((now) => {
      const next = { ...now, [id]: opened };
      try {
        localStorage.setItem(FOLDS, JSON.stringify(next));
      } catch {
        // No storage: the choice lasts as long as this page.
      }
      return next;
    });

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

        {PROVIDERS.map((id) => {
          const accounts = connections.filter((connection) => connection.provider === id);
          if (!accounts.length) return null;
          const provider = WORDS[id];
          return (
            <div key={id}>
              <p className={`${GROUP} mt-4`}>{provider.heading}</p>
              {accounts.map((connection) => {
                // An account is known by its address. Until that has been read, by what it is.
                const name = connection.account ?? provider.unnamed;
                const own = calendars.filter((calendar) => calendar.connectionId === connection.id);
                // Open where the person opened it; otherwise when it is the only account, or when
                // something about it needs them.
                const opened = folds[connection.id] ?? (connections.length === 1 || connection.status !== 'connected');
                const shown = own.filter((calendar) => calendar.visible).length;
                // Folded, what needs the person is said on the account's own line. Open, it is said below.
                const attention = connection.status === 'reconnect' ? 'Needs reconnecting' : connection.status === 'blocked' ? 'Can’t be read' : null;
                const summary = attention ? (opened ? '' : attention) : own.length ? `${shown} of ${own.length}` : '';
                const body = `account-${connection.id}`;
                return (
                  <div key={connection.id} role="group" aria-label={name} className="mt-1">
                    <button
                      data-account
                      aria-expanded={opened}
                      aria-controls={body}
                      onClick={() => fold(connection.id, !opened)}
                      className={`${ROW} w-full text-left hover:bg-wash ${mobile ? 'min-h-[52px]' : ''}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink2">{name}</span>
                      {summary && <span className="flex-none text-[12px] text-muted tabular-nums">{summary}</span>}
                      <span aria-hidden className={`w-3 flex-none text-center text-[14px] text-muted transition-transform duration-150 ${opened ? 'rotate-90' : ''}`}>
                        ›
                      </span>
                    </button>
                    {opened && (
                      <div id={body}>
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
                        {/* Only when the provider itself has refused this account's permission. The others carry on. */}
                        {connection.status === 'reconnect' && (
                          <div className={`${ROW} text-[13px] text-ink2`}>
                            <span className="flex-1">Needs reconnecting</span>
                            <button onClick={() => reconnect(connection)} aria-label={`Reconnect ${name}`} className={PILL}>
                              Reconnect
                            </button>
                          </div>
                        )}
                        {/* Not something consenting again would mend, so there is nothing to press but Disconnect. */}
                        {connection.status === 'blocked' && <p className="px-3.5 py-2 text-[13px] text-muted">{provider.blocked}</p>}
                        {/* Last, and only once the account is opened: ending it is never one stray tap away. */}
                        <div className="flex min-h-9 items-center justify-end px-3.5">
                          <button onClick={() => void disconnect(connection.id)} disabled={syncing} aria-label={`Disconnect ${name}`} className={`text-[12px] text-muted ${QUIET}`}>
                            Disconnect
                          </button>
                        </div>
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
            no provider is asked again. */}
        {status === 'signin' && (
          <div className={`${ROW} mt-3 text-[13px] text-ink2`}>
            <span className="flex-1">
              Sign in again to keep {connected === 'microsoft' ? 'your Microsoft calendar' : connected === 'yahoo' ? 'your Yahoo calendar' : connected === 'several' ? 'your calendars' : 'Google Calendar'} up to date
            </span>
            <button onClick={signIn} className={PILL}>
              Sign in
            </button>
          </div>
        )}

        {/* Only where the server is set up for it. Without that, Koyomi's own calendar is all there is. */}
        {available && (
          <button
            onClick={add}
            aria-expanded={providers.length > 1 ? choosing : undefined}
            className={`flex min-h-11 w-full items-center gap-1.5 rounded-[4px] pr-3 pl-1.5 text-left text-[14px] text-muted hover:bg-wash hover:text-ink ${connections.length ? 'mt-3' : 'mt-1'}`}
          >
            <span className="w-8 text-center text-[17px] font-light">＋</span>Add calendar account
          </button>
        )}
        {choosing && (
          <div className="pl-[38px]">
            {providers.map((id) => (
              <button key={id} onClick={() => choose(id)} className={`${ROW} w-full text-left text-[14px] text-ink2 hover:bg-wash hover:text-ink`}>
                {WORDS[id].label}
              </button>
            ))}
          </div>
        )}
        {asking?.provider === 'yahoo' && <YahooForm key={asking.connection?.id ?? 'new'} asking={asking} />}
        {available && status === 'off' && !asking && (
          <p className="mx-3.5 mt-3 text-[12px] leading-[1.6] text-pretty text-muted">
            Koyomi can show your {listed(providers)} calendars beside your own, to read only. Adding an account asks you to sign in with 6Away, then to let Koyomi
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
              Read only. Koyomi never changes your {connected === 'several' ? 'calendars' : WORDS[connected ?? 'google'].yours}.
              <span className="mt-1 flex flex-wrap items-center gap-x-4">
                {status === 'connected' && (
                  <button onClick={() => void refresh()} disabled={syncing} className={QUIET}>
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
