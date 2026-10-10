import { useSyncExternalStore } from 'react';
import { dayKey } from '../dates';
import { endExternal, epochNow, loadExternal, renewExternal, saveExternal, whenDeleted, type ExternalChange } from './db';
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
 * Which connection this tab is showing a copy of: the copy's epoch (db.ts), or null while there
 * is none. The copy itself is what decides, in the transaction that writes to it. This is only
 * what the tab last knew, used to stop early and to say what a reading was for.
 */
let epoch: string | null = null;
/** Goes up each time this tab's copy is ended or replaced, so that a reading begun before can tell. */
let era = 0;
/** This tab's copy has ended or been replaced. Whatever was being read for the old one stands down. */
function turn(next: string | null) {
  epoch = next;
  era++;
  again = false;
}
const STATUSES: unknown[] = ['off', 'connected', 'signin', 'reconnect'];
/** Whether nothing is connected here at this moment. Asked afresh after waiting: `state` moves on meanwhile. */
const off = () => state.status === 'off';
/**
 * Lets other tabs know something has changed here, and what this tab now takes the status to
 * be. A prompt to look and nothing more: what a tab does next is decided by the copy itself.
 */
const tell = () => channel?.postMessage(state.status);

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

/**
 * Takes up what this device holds. The note in storage, or another tab's word, says whether to
 * look at all, so that someone with nothing connected never has a copy opened for them. Both
 * can be out of date. What is found in the copy is what counts.
 *
 * @param hint What to take the status to be, where that is known better than the note in storage.
 */
async function load(hint?: External['status']): Promise<void> {
  const status = hint ?? flag.get();
  const none = () => {
    const had = epoch !== null;
    if (had) turn(null);
    set({ status: 'off', calendars: [], events: [], ...(had ? { syncing: false } : {}) });
  };
  if (status === 'off') return none();
  const copy = await loadExternal();
  // Said to be connected, and there is no copy: it was ended while this tab was not looking.
  if (copy.epoch === null && !copy.calendars.length) {
    flag.set('off');
    return none();
  }
  // A copy from before epochs has none. It is given one now, unless another tab has just done it.
  const now = copy.epoch ?? (await saveExternal({}, null).catch(() => null));
  if (now === false) return load(hint);
  const taken = now !== epoch;
  if (taken) turn(now);
  // There is a copy, so a connection is no longer only the address's word for it.
  unconfirmed = false;
  set({ status, calendars: order(copy.calendars), events: copy.events, ...(taken ? { syncing: false } : {}) });
}

const order = (calendars: ExternalCalendar[]) => [...calendars].sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));

/**
 * What this tab was doing was for a copy the device no longer holds: ended, or another
 * connection's now. It takes up what the device does hold, looking whatever the note in
 * storage says, because the note may not have caught up with another tab.
 */
async function adopt() {
  again = false;
  unconfirmed = false;
  await load(flag.get() === 'off' ? 'connected' : undefined).catch(() => {});
  set({ syncing: false });
}

/** Whether the copy on this device is still the one a reading was for: by the copy itself, and by what this tab has heard since. */
const holds = (mine: string | null) => epochNow().then((now) => now === mine && epoch === mine, () => epoch === mine);

function become(status: 'connected' | 'signin' | 'reconnect') {
  flag.set(status);
  set({ status, syncing: false });
  tell();
}

/**
 * Ends the connection on this device. The copy goes first, whole and at once (db.ts); then the
 * note in storage; and only then are other tabs told. Koyomi's own calendar is not involved.
 *
 * @param only End it only if the copy is still this connection's. A reading that learns its
 *   connection is gone must not end a newer one that has taken its place meanwhile.
 */
async function forget(note: string | null = null, only?: string | null) {
  const ended = await endExternal(only).catch(() => true);
  if (!ended) return adopt();
  turn(null);
  flag.set('off');
  set({ status: 'off', calendars: [], events: [], syncing: false, note });
  tell();
}

/**
 * The person has just been to 6Away or to Google and back. Who is signed in, or which account
 * is connected, may not be what it was. So the copy is given a new epoch: whatever was asked
 * for before they went, in any tab, was for the old one, and will not be kept when it arrives.
 */
async function renew() {
  if (epoch === null) return;
  const next = await renewExternal(epoch).catch(() => undefined);
  if (next === false) return adopt();
  if (!next) return;
  turn(next);
  set({ syncing: false });
  tell();
}

/**
 * What to do when the server could not answer. Each reason is kept apart: a sign-in that has
 * ended is not a connection that is lost, and neither is Google being slow.
 *
 * @param mine The copy the reading was for.
 */
async function failed(error: ApiError | 'offline', mine: string | null) {
  again = false;
  // Only the address claimed there was a connection, and the server does not bear it out.
  // Nothing was connected before, so nothing is now: no state to mend, nothing to show.
  if (unconfirmed) {
    unconfirmed = false;
    // If it is only that Google or the network was slow, say what to do; otherwise say nothing.
    const passing = error === 'busy' || error === 'offline' || error === 'slow_down';
    return set({ status: 'off', syncing: false, note: passing ? 'Your calendars couldn’t be read just now. Press Connect again in a moment.' : null });
  }
  if (error === 'signed_out' || error === 'reconnect') {
    // Said of a connection this device no longer has, ended or replaced in another tab: it is
    // not news about the copy that is here now.
    if (!(await holds(mine))) return adopt();
    // This device is no longer signed in to Koyomi (the connection is untouched on the server),
    // or Google has refused the stored permission.
    become(error === 'signed_out' ? 'signin' : 'reconnect');
  }
  // Signed in, and there is no connection: it was ended somewhere else. This device follows.
  else if (error === 'not_connected') await forget(null, mine);
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
  // The copy this reading is for. If that copy is ended or replaced while the reading is on its
  // way, the reading has nothing to say to this device any more: it stops where it is, asks for
  // nothing further, and leaves no trace. `era` catches it early, in this tab; the copy itself
  // has the last word when the reading is written, whatever this tab has or has not heard.
  const mine = epoch;
  const began = era;

  let listed: CalendarInfo[] | null = null;
  if (!only) {
    const answer = await call<{ calendars: CalendarInfo[] }>('/api/google/calendars');
    if (era !== began) return;
    if (!answer.ok) return failed(answer.error, mine);
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
    if (era !== began) return;
    if (!read.ok) return failed(read.error, mine);

    const fetchedAt = new Date().toISOString();
    for (const result of read.data.calendars) {
      readings.push({ result, since: asked.find((c) => c.calendarId === result.calendarId)?.syncToken ?? null, fetchedAt });
    }
  }

  // Everything is in. What was read is added to the calendars as they are at the moment of
  // asking, not as they were when the reading began. Which calendars are shown is the person's
  // choice, and is never put back to what it was.
  const settled = () => {
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
    return { change, calendars, events };
  };

  // Written first, and shown only once it is written. The copy decides, in the one transaction
  // that writes to it: if it is no longer the copy this was read for (Disconnect, someone else
  // signing in, a different account connected, in any tab), nothing is written and nothing is
  // shown. Where there is no way to keep a copy at all, it is shown for this visit as before.
  const kept = await saveExternal(settled().change, mine).catch(() => undefined);
  if (kept === false) return adopt();
  if (era !== began) return;
  if (kept) epoch = kept;

  // Asked again, from now: a calendar shown or hidden while that was being written stays so.
  const { calendars, events } = settled();
  unconfirmed = false;
  flag.set('connected');
  set({ status: 'connected', calendars: order(calendars), events, syncing: false });
  tell();

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
  const began = era;
  set({ calendars, events: visible ? state.events : state.events.filter((e) => e.calendarId !== calendarId) });
  // The choice is shown at once. It is kept only if the copy is still this connection's.
  const kept = await saveExternal({ calendars, clearEvents: visible ? [] : [calendarId] }, epoch).catch(() => undefined);
  if (kept === false) return adopt();
  if (era !== began) return;
  if (kept) epoch = kept;
  tell();
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
  await renew();
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
  if (off()) return;
  await renew();
  // The copy turned out to have been ended in another tab while they were away.
  if (off()) return;
  flag.set('connected');
  set({ status: 'connected', note: null });
  await sync();
}

/**
 * Ends the connection. The server withdraws the permission at Google and deletes its token;
 * this device deletes its copy of the events. Koyomi's own events are not involved.
 */
export async function disconnect(): Promise<void> {
  // Whatever is being read is no longer wanted, and must not be what this ends on.
  const mine = epoch;
  era++;
  again = false;
  set({ syncing: true, note: null });
  const done = await call<{ ok: true }>('/api/google/disconnect', {});
  // If another tab has connected again meanwhile, that newer copy is not this Disconnect's to end.
  if (done.ok || done.error === 'not_connected') return forget(null, mine);
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
    // Another tab's word is a prompt to look, and says what that tab takes the status to be.
    channel.onmessage = (event) => void load(STATUSES.includes(event.data) ? event.data : undefined).catch(() => {});
  }
  // The copy itself says when another tab has deleted it, sooner and more surely than any
  // message: the deletion cannot finish until this tab has let go of it.
  whenDeleted(() => {
    turn(null);
    set({ status: 'off', calendars: [], events: [], syncing: false });
  });
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
