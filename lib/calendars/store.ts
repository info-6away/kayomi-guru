import { useSyncExternalStore } from 'react';
import { dayKey } from '../dates';
import { deleteExternal, loadExternal, saveExternal, type ExternalChange } from './db';
import type { ApiError, CalendarInfo, CalendarResult, EventsRequest, EventsResponse, ExternalCalendar, ExternalEvent } from './types';
import { covers, spanOfWindow, syncWindow, within } from './window';

// Connected calendars on this device: what is known about them, kept in memory and written
// through to their own database (db.ts). Nothing here runs, and no request is made, for
// someone who has not connected one.

export interface External {
  /** Whether this server offers calendar connections at all. */
  available: boolean;
  /**
   * - `off`: nothing connected.
   * - `connected`: reading normally.
   * - `signin`: the Koyomi sign-in on this device has ended. The connection to Google is still
   *   there, on the server, under the same 6Away identity; signing in again picks it up.
   * - `reconnect`: Google itself no longer honours the permission. Only asking Google again mends it.
   *
   * In the last two, what was read before stays on screen.
   */
  status: 'off' | 'connected' | 'signin' | 'reconnect';
  calendars: ExternalCalendar[];
  events: ExternalEvent[];
  /** A reading is under way. */
  syncing: boolean;
  /** The last thing asked for did not happen, in words for the person. */
  note: string | null;
}

/** Remembers that a calendar is connected, so the first thing a visit does is not a request. Not a credential. */
const FLAG = 'koyomi-calendars';
/** How old a reading may be before the app looks again when it is opened or returned to. */
const STALE_MS = 5 * 60_000;
const EVERY_MS = 15 * 60_000;
/** The most calendars the server reads in one request. More than that are asked for in turns. */
const BATCH = 25;

const EMPTY: External = { available: false, status: 'off', calendars: [], events: [], syncing: false, note: null };
let state = EMPTY;
const listeners = new Set<() => void>();
function set(next: Partial<External>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useExternal = () => useSyncExternalStore(subscribe, () => state, () => EMPTY);

const flag = {
  get: (): External['status'] => {
    try {
      const value = localStorage.getItem(FLAG);
      return value === 'connected' || value === 'signin' || value === 'reconnect' ? value : 'off';
    } catch {
      return 'off';
    }
  },
  set: (status: External['status']) => {
    try {
      if (status === 'off') localStorage.removeItem(FLAG);
      else localStorage.setItem(FLAG, status);
    } catch {
      // Storage is blocked: the connection is found again the next time Calendars is opened.
    }
  },
};

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError | 'offline' };

async function call<T>(path: string, body?: unknown): Promise<Result<T>> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data };
    return { ok: false, error: data?.error ?? 'busy' };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

let channel: BroadcastChannel | null = null;
let started = false;
/** Settles once this device's copy has been read, so nothing that follows can be overwritten by it. */
let ready: Promise<void> = Promise.resolve();
/** Something asked for a reading while one was under way: one more follows it, however many asked. */
let again = false;
/** The address says a connection was just made, and the server has not yet confirmed it. */
let unconfirmed = false;

/**
 * Remembers, for this tab only, that the person asked to disconnect and had to sign in first.
 * The address they come back to says "disconnect", but an address can be a link from anywhere,
 * so it is acted on only if this is here too. Nothing outside this site can put it here.
 */
const INTENT = 'koyomi-calendars-intent';
const intent = {
  leave: (what: string) => {
    try {
      sessionStorage.setItem(INTENT, what);
    } catch {
      // No storage: after signing in, Disconnect has to be pressed once more.
    }
  },
  take: (): string | null => {
    try {
      const what = sessionStorage.getItem(INTENT);
      sessionStorage.removeItem(INTENT);
      return what;
    } catch {
      return null;
    }
  },
};

async function load() {
  const status = flag.get();
  if (status === 'off') return set({ status, calendars: [], events: [] });
  const { calendars, events } = await loadExternal();
  set({ status, calendars: order(calendars), events });
}

const order = (calendars: ExternalCalendar[]) => [...calendars].sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));

async function save(change: ExternalChange) {
  await saveExternal(change);
  channel?.postMessage('changed');
}

function become(status: 'connected' | 'signin' | 'reconnect') {
  flag.set(status);
  set({ status, syncing: false });
  channel?.postMessage('changed');
}

/** Forgets the connection on this device: the flag, and the whole copy of its events. */
async function forget(note: string | null = null) {
  flag.set('off');
  set({ status: 'off', calendars: [], events: [], syncing: false, note });
  await deleteExternal();
  channel?.postMessage('changed');
}

/**
 * What to do when the server could not answer. Each reason is kept apart: a sign-in that has
 * ended is not a connection that is lost, and neither is Google being slow.
 */
async function failed(error: ApiError | 'offline') {
  again = false;
  // Only the address claimed there was a connection, and the server does not bear it out.
  // Nothing was connected before, so nothing is now: no state to mend, nothing to show.
  if (unconfirmed) {
    unconfirmed = false;
    // If it is only that Google or the network was slow, say what to do; otherwise say nothing.
    const passing = error === 'busy' || error === 'offline' || error === 'slow_down';
    return set({ status: 'off', syncing: false, note: passing ? 'Your calendars couldn’t be read just now. Press Connect again in a moment.' : null });
  }
  // This device is no longer signed in to Koyomi. The connection is untouched on the server.
  if (error === 'signed_out') become('signin');
  // Google has refused the stored permission.
  else if (error === 'reconnect') become('reconnect');
  // Signed in, and there is no connection: it was ended somewhere else. This device follows.
  else if (error === 'not_connected') await forget();
  // Offline, Google busy, or asked too often: what was read before is still good. Try again later.
  else set({ syncing: false });
}

/**
 * The provider's list of calendars, laid over what this device remembers of each. The name and
 * the like are the provider's. Whether a calendar is shown, and how far it has been read, are
 * this device's and are kept. One new to this device starts as it is ticked in Google's own app.
 */
const listedOver = (remembered: ExternalCalendar[], listed: CalendarInfo[]): ExternalCalendar[] => {
  const known = new Map(remembered.map((c) => [c.calendarId, c]));
  return listed.map((info) => ({
    id: `google:${info.calendarId}`,
    provider: 'google',
    visible: info.selected,
    syncToken: null,
    windowFrom: null,
    windowTo: null,
    fetchedAt: null,
    ...known.get(info.calendarId),
    ...info,
  }));
};

const lastRead = () => state.calendars.reduce<string | null>((latest, c) => (c.fetchedAt && (!latest || c.fetchedAt > latest) ? c.fetchedAt : latest), null);
const stale = () => {
  const read = lastRead();
  return !read || Date.now() - Date.parse(read) > STALE_MS;
};

/**
 * Reads the connected calendars again: which exist, then the events of the ones being shown.
 * A calendar read recently is asked only for what changed since.
 *
 * Only one reading runs at a time. Asking again while one is under way does not start a second:
 * a single further reading follows the first, however many times it was asked for.
 *
 * @param only Read just this calendar's events, without listing calendars again.
 */
export async function sync(only?: string): Promise<void> {
  await ready;
  if (state.status === 'off') return;
  if (state.syncing) {
    again = true;
    return;
  }
  set({ syncing: true, note: null });

  let listed: CalendarInfo[] | null = null;
  if (!only) {
    const answer = await call<{ calendars: CalendarInfo[] }>('/api/google/calendars');
    if (!answer.ok) return failed(answer.error);
    listed = answer.data.calendars;
  }

  const today = dayKey(new Date());
  const window = syncWindow(today);
  // What is asked for is what is shown at this moment. What comes back is kept apart until all
  // of it is in: while it is on its way, the person can still show or hide a calendar.
  const shown = (listed ? listedOver(state.calendars, listed) : state.calendars).filter((c) => c.visible && (!only || c.calendarId === only));
  const readings: { result: CalendarResult; since: string | null; fetchedAt: string }[] = [];

  for (let i = 0; i < shown.length; i += BATCH) {
    const asked = shown.slice(i, i + BATCH).map((c) => ({ calendarId: c.calendarId, syncToken: covers(c, today) ? c.syncToken : null }));
    const request: EventsRequest = { ...spanOfWindow(window), calendars: asked };
    const read = await call<EventsResponse>('/api/google/events', request);
    if (!read.ok) return failed(read.error);

    const fetchedAt = new Date().toISOString();
    for (const result of read.data.calendars) {
      readings.push({ result, since: asked.find((c) => c.calendarId === result.calendarId)?.syncToken ?? null, fetchedAt });
    }
  }

  // Everything is in, and nothing below waits. So this starts from the calendars as they are
  // now, not as they were when the reading began, and adds to them only what was read. Which
  // calendars are shown is the person's choice, and is never put back to what it was.
  let calendars = listed ? listedOver(state.calendars, listed) : state.calendars;
  const dropCalendars = listed ? state.calendars.map((c) => c.calendarId).filter((id) => !listed.some((info) => info.calendarId === id)) : [];
  const change: ExternalChange = { dropCalendars, clearEvents: [], putEvents: [], removeEvents: [] };

  for (const { result, since, fetchedAt } of readings) {
    if ('gone' in result) {
      dropCalendars.push(result.calendarId);
      calendars = calendars.filter((c) => c.calendarId !== result.calendarId);
      continue;
    }
    const now = calendars.find((c) => c.calendarId === result.calendarId);
    // Hidden since it was asked for: a hidden calendar's events are not kept.
    if (!now?.visible) continue;
    // Only what changed since a reading this device no longer holds (the calendar was hidden
    // and shown again, or read in another tab). There is nothing here to add it to, and its
    // cursor would say otherwise. The calendar keeps the cursor it has, and is read from there.
    if (!result.full && now.syncToken !== since) continue;

    if (result.full) change.clearEvents!.push(result.calendarId);
    change.putEvents!.push(...result.events.filter((event) => within(event, window)));
    change.removeEvents!.push(...result.removed.map((id) => `google:${result.calendarId}:${id}`));
    calendars = calendars.map((c) =>
      c.calendarId === result.calendarId
        ? { ...c, syncToken: result.syncToken, fetchedAt, ...(result.full ? { windowFrom: window.from, windowTo: window.to } : {}) }
        : c,
    );
  }

  change.calendars = calendars;
  const gone = new Set([...dropCalendars, ...change.clearEvents!]);
  const removed = new Set(change.removeEvents);
  const put = new Map(change.putEvents!.map((event) => [event.id, event]));
  const events = [...state.events.filter((e) => !gone.has(e.calendarId) && !removed.has(e.id) && !put.has(e.id)), ...put.values()];

  unconfirmed = false;
  flag.set('connected');
  set({ status: 'connected', calendars: order(calendars), events, syncing: false });
  await save(change).catch(() => {});

  if (again) {
    again = false;
    await sync();
  }
}

/** Shows or hides one calendar. A hidden calendar is not read, and its events are not kept. */
export async function showCalendar(calendarId: string, visible: boolean) {
  const calendars = state.calendars.map((c) =>
    c.calendarId === calendarId ? { ...c, visible, ...(visible ? {} : { syncToken: null, windowFrom: null, windowTo: null, fetchedAt: null }) } : c,
  );
  set({ calendars, events: visible ? state.events : state.events.filter((e) => e.calendarId !== calendarId) });
  await save({ calendars, clearEvents: visible ? [] : [calendarId] }).catch(() => {});
  // Only the calendar that has just been shown needs reading.
  if (visible) await sync(calendarId);
}

/**
 * Called when the address says the visitor is back from giving Google's permission. The address
 * is only a hint: it is the server answering with their calendars that makes it so. Until then
 * nothing is remembered, and if the server says otherwise this device is left as it was.
 */
export async function connected() {
  await ready;
  unconfirmed = state.status === 'off';
  set({ status: 'connected', note: null });
  await sync();
}

/** Leaves for 6Away's sign-in, and comes back to carry on. Google is not involved. */
export const signIn = () => location.assign(`/api/auth/signin?returnTo=${encodeURIComponent('/?calendars=resume')}`);

/**
 * Called when the visitor comes back from signing in to 6Away. Their connection was never
 * gone, so reading simply carries on. If it turns out Google has refused it in the meantime,
 * or someone else signed in, the reading says so.
 */
export async function resume() {
  await ready;
  if (state.status === 'off') return;
  flag.set('connected');
  set({ status: 'connected', note: null });
  await sync();
}

/**
 * Ends the connection. The server withdraws the permission at Google and deletes its token;
 * this device deletes its copy of the events. Koyomi's own events are not involved.
 */
export async function disconnect(): Promise<void> {
  set({ syncing: true, note: null });
  const done = await call<{ ok: true }>('/api/google/disconnect', {});
  if (done.ok || done.error === 'not_connected') return forget();
  if (done.error === 'signed_out') {
    // The server no longer knows this device, so it cannot be told. Sign in, then finish.
    intent.leave('disconnect');
    location.assign(`/api/auth/signin?returnTo=${encodeURIComponent('/?calendars=disconnect')}`);
    return;
  }
  set({ syncing: false, note: 'Couldn’t disconnect just now. Try again in a moment.' });
}

/** Back from signing in, having asked to disconnect: now it can be done. A bare link does nothing. */
export async function finishDisconnect() {
  await ready;
  if (intent.take() === 'disconnect' && state.status !== 'off') await disconnect();
}

export const say = (note: string | null) => set({ note });

/** Call once, in the browser. Does nothing more than note availability unless a calendar is connected. */
export function initExternal(available: boolean) {
  if (started) return;
  started = true;
  set({ available });
  if (!available) return;

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('koyomi-external');
    channel.onmessage = () => void load().catch(() => {});
  }
  // Only a working connection is read on its own. One that needs the person waits for them.
  const refresh = () => {
    if (document.visibilityState === 'visible' && state.status === 'connected' && stale()) void sync();
  };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', refresh);
  setInterval(refresh, EVERY_MS);

  ready = load().catch(() => {});
  void ready.then(refresh);
}
