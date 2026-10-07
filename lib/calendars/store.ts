import { useSyncExternalStore } from 'react';
import { dayKey } from '../dates';
import { deleteExternal, loadExternal, saveExternal, type ExternalChange } from './db';
import type { ApiError, CalendarInfo, EventsRequest, EventsResponse, ExternalCalendar, ExternalEvent } from './types';
import { covers, spanOfWindow, syncWindow, within } from './window';

// Connected calendars on this device: what is known about them, kept in memory and written
// through to their own database (db.ts). Nothing here runs, and no request is made, for
// someone who has not connected one.

export interface External {
  /** Whether this server offers calendar connections at all. */
  available: boolean;
  /**
   * `off`: nothing connected. `connected`: reading normally. `reconnect`: the person has to
   * sign in or give permission again; what was read before stays on screen.
   */
  status: 'off' | 'connected' | 'reconnect';
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
      return value === 'connected' || value === 'reconnect' ? value : 'off';
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

/** Forgets the connection on this device: the flag, and the whole copy of its events. */
async function forget(note: string | null = null) {
  flag.set('off');
  set({ status: 'off', calendars: [], events: [], syncing: false, note });
  await deleteExternal();
  channel?.postMessage('changed');
}

/** What to do when the server could not answer. Most reasons are not the person's problem. */
async function failed(error: ApiError | 'offline') {
  if (error === 'signed_out' || error === 'reconnect') {
    flag.set('reconnect');
    set({ status: 'reconnect', syncing: false });
    channel?.postMessage('changed');
  } else if (error === 'not_connected') {
    // Disconnected somewhere else. This device follows.
    await forget();
  } else {
    // Offline, or Google is busy: what was read before is still good. Try again later.
    set({ syncing: false });
  }
}

const lastRead = () => state.calendars.reduce<string | null>((latest, c) => (c.fetchedAt && (!latest || c.fetchedAt > latest) ? c.fetchedAt : latest), null);
const stale = () => {
  const read = lastRead();
  return !read || Date.now() - Date.parse(read) > STALE_MS;
};

/**
 * Reads the connected calendars again: which exist, then the events of the ones being shown.
 * A calendar read recently is asked only for what changed since.
 */
export async function sync(): Promise<void> {
  await ready;
  if (state.status === 'off' || state.syncing) return;
  set({ syncing: true, note: null });

  const listed = await call<{ calendars: CalendarInfo[] }>('/api/google/calendars');
  if (!listed.ok) return failed(listed.error);

  const known = new Map(state.calendars.map((c) => [c.calendarId, c]));
  let calendars: ExternalCalendar[] = listed.data.calendars.map((info) => ({
    id: `google:${info.calendarId}`,
    provider: 'google',
    // New to this device: shown if it is ticked in Google's own app.
    visible: info.selected,
    syncToken: null,
    windowFrom: null,
    windowTo: null,
    fetchedAt: null,
    ...known.get(info.calendarId),
    ...info,
  }));
  const dropCalendars = [...known.keys()].filter((id) => !calendars.some((c) => c.calendarId === id));

  const today = dayKey(new Date());
  const window = syncWindow(today);
  const shown = calendars.filter((c) => c.visible);
  const change: ExternalChange = { dropCalendars, clearEvents: [], putEvents: [], removeEvents: [] };

  if (shown.length) {
    const request: EventsRequest = {
      ...spanOfWindow(window),
      calendars: shown.map((c) => ({ calendarId: c.calendarId, syncToken: covers(c, today) ? c.syncToken : null })),
    };
    const read = await call<EventsResponse>('/api/google/events', request);
    if (!read.ok) return failed(read.error);

    const fetchedAt = new Date().toISOString();
    for (const result of read.data.calendars) {
      if ('gone' in result) {
        dropCalendars.push(result.calendarId);
        calendars = calendars.filter((c) => c.calendarId !== result.calendarId);
        continue;
      }
      if (result.full) change.clearEvents!.push(result.calendarId);
      change.putEvents!.push(...result.events.filter((event) => within(event, window)));
      change.removeEvents!.push(...result.removed.map((id) => `google:${result.calendarId}:${id}`));
      calendars = calendars.map((c) =>
        c.calendarId === result.calendarId
          ? { ...c, syncToken: result.syncToken, fetchedAt, ...(result.full ? { windowFrom: window.from, windowTo: window.to } : {}) }
          : c,
      );
    }
  }

  change.calendars = calendars;
  const gone = new Set([...dropCalendars, ...change.clearEvents!]);
  const removed = new Set(change.removeEvents);
  const put = new Map(change.putEvents!.map((event) => [event.id, event]));
  const events = [...state.events.filter((e) => !gone.has(e.calendarId) && !removed.has(e.id) && !put.has(e.id)), ...put.values()];

  flag.set('connected');
  set({ status: 'connected', calendars: order(calendars), events, syncing: false });
  await save(change).catch(() => {});
}

/** Shows or hides one calendar. A hidden calendar is not read, and its events are not kept. */
export async function showCalendar(calendarId: string, visible: boolean) {
  const calendars = state.calendars.map((c) =>
    c.calendarId === calendarId ? { ...c, visible, ...(visible ? {} : { syncToken: null, windowFrom: null, windowTo: null, fetchedAt: null }) } : c,
  );
  set({ calendars, events: visible ? state.events : state.events.filter((e) => e.calendarId !== calendarId) });
  await save({ calendars, clearEvents: visible ? [] : [calendarId] }).catch(() => {});
  if (visible) await sync();
}

/** Called when the visitor comes back from giving permission. */
export async function connected() {
  await ready;
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
    location.assign(`/api/auth/signin?returnTo=${encodeURIComponent('/?calendars=disconnect')}`);
    return;
  }
  set({ syncing: false, note: 'Couldn’t disconnect just now. Try again in a moment.' });
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
  const refresh = () => {
    if (document.visibilityState === 'visible' && state.status === 'connected' && stale()) void sync();
  };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', refresh);
  setInterval(refresh, EVERY_MS);

  ready = load().catch(() => {});
  void ready.then(refresh);
}
