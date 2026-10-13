import { useSyncExternalStore } from 'react';
import { dayKey } from '../dates';
import { dropConnection, endExternal, loadExternal, renewExternal, rosterNow, saveConnection, saveListing, whenDeleted, type CalendarRef, type ConnectionChange, type ListingChange, type Roster } from './db';
import {
  calendarKey,
  eventKey,
  type ApiError,
  type CalendarResult,
  type CalendarsResponse,
  type ConnectionListing,
  type EventsRequest,
  type EventsResponse,
  type ExternalCalendar,
  type ExternalConnection,
  type ExternalEvent,
} from './types';
import { covers, spanOfWindow, syncWindow, within } from './window';

// Connected calendars on this device: the accounts a person has connected, and what is known
// of each, kept in memory and written through to their own database (db.ts). Nothing here runs,
// and no request is made, for someone who has not connected one.
//
// Each account is read, kept and ended by itself. What goes wrong for one (Google refusing it,
// Google being slow about it, its being disconnected) is that account's alone: the others go on
// being read and shown.

export interface External {
  /** Whether this server offers calendar connections at all. */
  available: boolean;
  /**
   * - `off`: no account is connected.
   * - `connected`: at least one is. Whether Google still honours each is said by the account
   *   itself (`ExternalConnection.status`).
   * - `signin`: the Koyomi sign-in on this device has ended. The connections are still there,
   *   on the server, under the same 6Away identity; signing in again picks them up.
   *
   * With a sign-in that has ended, or an account that needs reconnecting, what was read before
   * stays on screen.
   */
  status: 'off' | 'connected' | 'signin';
  /** The accounts, by their address. */
  connections: ExternalConnection[];
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

const EMPTY: External = { available: false, status: 'off', connections: [], calendars: [], events: [], syncing: false, note: null };
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
      // "reconnect" was written by releases that knew one account: it meant connected, and looking is what says more.
      return value === 'signin' ? 'signin' : value === 'connected' || value === 'reconnect' ? 'connected' : 'off';
    } catch {
      return 'off';
    }
  },
  set: (status: External['status']) => {
    try {
      if (status === 'off') localStorage.removeItem(FLAG);
      else localStorage.setItem(FLAG, status);
    } catch {
      // Storage is blocked: the connections are found again the next time an account is added.
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
/** The address says an account was just connected, and the server has not yet confirmed it. */
let unconfirmed = false;
/**
 * What the copy said of itself when this tab last looked (db.ts): which accounts it holds, and
 * each one's epoch. The copy is what decides, in the transaction that writes to it. This is
 * only what the tab last knew, used to stop early and to say what a reading was for.
 */
let roster: string | null = null;
let epochs: Record<string, string> = {};
/** Goes up each time the copy is ended or taken over under this tab, so that a reading begun before can tell. */
let era = 0;
/** This tab has written to the copy, and now knows what it says of itself. Nothing was taken from under it. */
function know(next: Roster) {
  roster = next.roster;
  epochs = next.epochs;
}
/** The copy has ended, or is not what this tab was reading for. Whatever was being read stands down. */
function turn(next: Roster) {
  know(next);
  era++;
  again = false;
}
const NOTHING: Roster = { roster: null, epochs: {} };
const STATUSES: unknown[] = ['off', 'connected', 'signin'];
/** Whether nothing is connected here at this moment. Asked afresh after waiting: `state` moves on meanwhile. */
const off = () => state.status === 'off';
/**
 * Lets other tabs know something has changed here, and what this tab now takes the status to
 * be. A prompt to look and nothing more: what a tab does next is decided by the copy itself.
 */
const tell = () => channel?.postMessage(state.status);

/**
 * Remembers, for this tab only, that the person asked to disconnect an account and had to sign
 * in first. The address they come back to says "disconnect", but an address can be a link from
 * anywhere, so it is acted on only if this is here too. Nothing outside this site can put it here.
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

/** Accounts by their address, then each account's own calendar first and the rest by name. */
const orderConnections = (connections: ExternalConnection[]) => [...connections].sort((a, b) => (a.account ?? '').localeCompare(b.account ?? '') || a.id.localeCompare(b.id));
const order = (calendars: ExternalCalendar[]) => [...calendars].sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
const eventsOf = (calendar: CalendarRef) => (event: ExternalEvent) => event.connectionId === calendar.connectionId && event.calendarId === calendar.calendarId;

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
    const had = roster !== null;
    if (had) turn(NOTHING);
    set({ status: 'off', connections: [], calendars: [], events: [], ...(had ? { syncing: false } : {}) });
  };
  if (status === 'off') return none();
  const copy = await loadExternal();
  // Said to be connected, and the copy holds no account. It was ended while this tab was not
  // looking; or it was a copy from a release that knew one account, which is dropped when it
  // is opened (db.ts). Either way nothing is connected here, and no empty database is left.
  if (!copy.connections.length) {
    flag.set('off');
    await endExternal();
    return none();
  }
  const taken = copy.roster !== roster;
  if (taken) turn(copy);
  else know(copy);
  // There is a copy, so a connection is no longer only the address's word for it.
  unconfirmed = false;
  set({ status, connections: orderConnections(copy.connections), calendars: order(copy.calendars), events: copy.events, ...(taken ? { syncing: false } : {}) });
}

/**
 * What this tab was doing was for a copy the device no longer holds: an account has left it, or
 * someone has been to sign in and back. It takes up what the device does hold, looking whatever
 * the note in storage says, because the note may not have caught up with another tab. Whatever
 * is still connected is then read afresh, since what this tab was reading for it was let go.
 */
async function adopt() {
  again = false;
  unconfirmed = false;
  await load(flag.get() === 'off' ? 'connected' : undefined).catch(() => {});
  set({ syncing: false });
  if (state.status === 'connected') void sync();
}

/** Whether the copy still holds the accounts a reading began from: by the copy itself, and by what this tab has heard since. */
const holds = (mine: string | null) => rosterNow().then((now) => now.roster === mine && roster === mine, () => roster === mine);
/** Whether an account's part of the copy is still the one a reading was for. */
const holdsAccount = (id: string, mine: string | undefined) => rosterNow().then((now) => now.epochs[id] === mine && epochs[id] === mine, () => epochs[id] === mine);

function become(status: 'connected' | 'signin') {
  flag.set(status);
  set({ status, syncing: false });
  tell();
}

/** Nothing is connected on this device any more. Koyomi's own calendar is not involved. */
function ended(note: string | null = null) {
  turn(NOTHING);
  flag.set('off');
  set({ status: 'off', connections: [], calendars: [], events: [], syncing: false, note });
  tell();
}

/**
 * Ends one account on this device. Its part of the copy goes first, whole and at once (db.ts);
 * then, if it was the last, the note in storage; and only then are other tabs told. The other
 * accounts, and Koyomi's own calendar, are not involved.
 *
 * @param only End it only if its part of the copy is still the one meant. A reading that learns
 *   its account is gone must not end a part that has begun again meanwhile.
 * @returns `others` if other accounts are still connected here and whatever was under way can
 *   go on. Otherwise it is wound up: `ended` when that was the last account, `taken` when the
 *   account's part was not this tab's to end and the tab has taken up what the device holds.
 */
async function forget(id: string, only?: string): Promise<'others' | 'ended' | 'taken'> {
  const left = await dropConnection(id, only).catch(() => undefined);
  if (left === false) {
    await adopt();
    return 'taken';
  }
  if (left) know(left);
  const connections = state.connections.filter((connection) => connection.id !== id);
  if (!connections.length) {
    ended();
    return 'ended';
  }
  set({ connections, calendars: state.calendars.filter((calendar) => calendar.connectionId !== id), events: state.events.filter((event) => event.connectionId !== id) });
  tell();
  return 'others';
}

/**
 * The person has just been to 6Away or to Google and back. Who is signed in, or what is
 * connected, may not be what it was. So every account in the copy is given a new epoch, and the
 * copy a new roster: whatever was asked for before they went, in any tab, for any account, was
 * for the old ones, and will not be kept when it arrives.
 */
async function renew() {
  if (roster === null) return;
  const next = await renewExternal(roster).catch(() => undefined);
  if (next === false) return adopt();
  if (!next) return;
  turn(next);
  set({ syncing: false });
  tell();
}

/**
 * What to do when the server could not say which accounts are connected. Each reason is kept
 * apart: a sign-in that has ended is not a connection that is lost, and neither is Google
 * being slow.
 *
 * @param mine The roster the question was asked under.
 */
async function failed(error: ApiError | 'offline', mine: string | null) {
  again = false;
  // Only the address claimed there was a connection, and the server does not bear it out.
  // Nothing was connected before, so nothing is now: no state to mend, nothing to show.
  if (unconfirmed) {
    unconfirmed = false;
    // If it is only that Google or the network was slow, say what to do; otherwise say nothing.
    const passing = error === 'busy' || error === 'offline' || error === 'slow_down';
    return set({ status: 'off', syncing: false, note: passing ? 'Your calendars couldn’t be read just now. Try adding the account again in a moment.' : null });
  }
  if (error === 'signed_out') {
    // Said of a copy this device no longer has, changed in another tab: it is not news about
    // the one that is here now.
    if (!(await holds(mine))) return adopt();
    // This device is no longer signed in to Koyomi. The connections are untouched on the server.
    return become('signin');
  }
  // Offline, or the server busy: what was read before is still good. Try again later.
  set({ syncing: false });
}

/**
 * One account's calendars as the provider lists them, laid over what this device remembers of
 * each. The name and the like are the provider's. Whether a calendar is shown, and how far it
 * has been read, are this device's and are kept. One new to this device starts as it is ticked
 * in Google's own app.
 */
const listedOver = (remembered: ExternalCalendar[], listed: ConnectionListing): ExternalCalendar[] => {
  const known = new Map(remembered.map((calendar) => [calendar.calendarId, calendar]));
  return listed.calendars.map((info) => ({
    id: calendarKey(listed.connectionId, info.calendarId),
    connectionId: listed.connectionId,
    provider: listed.provider,
    visible: info.selected,
    syncToken: null,
    windowFrom: null,
    windowTo: null,
    fetchedAt: null,
    ...known.get(info.calendarId),
    ...info,
  }));
};

/**
 * The server's list of accounts, laid over what this device holds at this moment. An account
 * the server no longer lists has left, with everything of its own. One that could not be read
 * just now, or that Google refuses, keeps what was read of it before.
 */
function laid(listed: ConnectionListing[]) {
  const staying = new Set(listed.map((entry) => entry.connectionId));
  const connections = listed.map((entry): ExternalConnection => {
    const known = state.connections.find((connection) => connection.id === entry.connectionId);
    return {
      id: entry.connectionId,
      provider: entry.provider,
      account: entry.account ?? known?.account ?? null,
      status: entry.state === 'ok' ? 'connected' : entry.state === 'reconnect' ? 'reconnect' : (known?.status ?? 'connected'),
    };
  });

  let calendars = state.calendars.filter((calendar) => staying.has(calendar.connectionId));
  const change: ListingChange = { connections, calendars: [], dropCalendars: [] };
  for (const entry of listed) {
    if (entry.state !== 'ok') continue;
    const remembered = calendars.filter((calendar) => calendar.connectionId === entry.connectionId);
    const now = listedOver(remembered, entry);
    change.calendars.push(...now);
    change.dropCalendars.push(...remembered.filter((calendar) => !now.some((listedNow) => listedNow.id === calendar.id)));
    calendars = [...calendars.filter((calendar) => calendar.connectionId !== entry.connectionId), ...now];
  }
  const kept = new Set(calendars.map((calendar) => calendar.id));
  const events = state.events.filter((event) => kept.has(calendarKey(event.connectionId, event.calendarId)));
  return { change, connections, calendars, events };
}

const lastRead = () => state.calendars.reduce<string | null>((latest, c) => (c.fetchedAt && (!latest || c.fetchedAt > latest) ? c.fetchedAt : latest), null);
const stale = () => {
  const read = lastRead();
  return !read || Date.now() - Date.parse(read) > STALE_MS;
};

/**
 * Reads the events of one account's calendars: the ones being shown, each asked only for what
 * changed since it was last read, where it was. What comes of it is this account's alone.
 *
 * @param only Read just this calendar.
 * @returns 'stop' when the whole reading ends here, and has been wound up: the copy was taken
 *   from under it, the sign-in has ended, or there is no connection to anything.
 */
async function read(id: string, began: number, only?: string): Promise<'stop' | void> {
  // The part of the copy this reading is for. If the account is disconnected, or its part is
  // begun again, while the reading is on its way, the reading has nothing to say to this device
  // any more. `era` catches that early, in this tab; the copy itself has the last word when the
  // reading is written, whatever this tab has or has not heard.
  const mine = epochs[id];
  const today = dayKey(new Date());
  const window = syncWindow(today);
  // What is asked for is what is shown at this moment. What comes back is kept apart until all
  // of it is in: while it is on its way, the person can still show or hide a calendar.
  const shown = state.calendars.filter((calendar) => calendar.connectionId === id && calendar.visible && (!only || calendar.calendarId === only));
  const readings: { result: CalendarResult; since: string | null; fetchedAt: string }[] = [];

  for (let i = 0; i < shown.length; i += BATCH) {
    const asked = shown.slice(i, i + BATCH).map((calendar) => ({ calendarId: calendar.calendarId, syncToken: covers(calendar, today) ? calendar.syncToken : null }));
    const request: EventsRequest = { connectionId: id, ...spanOfWindow(window), calendars: asked };
    const answer = await call<EventsResponse>('/api/google/events', request);
    if (era !== began) return 'stop';
    if (!answer.ok) return refused(id, answer.error, mine);

    const fetchedAt = new Date().toISOString();
    for (const result of answer.data.calendars) {
      readings.push({ result, since: asked.find((calendar) => calendar.calendarId === result.calendarId)?.syncToken ?? null, fetchedAt });
    }
  }
  if (!readings.length) return;

  // Everything is in. What was read is added to the calendars as they are at the moment of
  // asking, not as they were when the reading began. Which calendars are shown is the person's
  // choice, and is never put back to what it was.
  const settled = () => {
    let calendars = state.calendars;
    const change: Required<Omit<ConnectionChange, 'status'>> = { calendars: [], dropCalendars: [], clearEvents: [], putEvents: [], removeEvents: [] };

    for (const { result, since, fetchedAt } of readings) {
      const key = calendarKey(id, result.calendarId);
      if ('gone' in result) {
        change.dropCalendars.push(result.calendarId);
        calendars = calendars.filter((calendar) => calendar.id !== key);
        continue;
      }
      const now = calendars.find((calendar) => calendar.id === key);
      // Hidden since it was asked for: a hidden calendar's events are not kept.
      if (!now?.visible) continue;
      // Only what changed since a reading this device no longer holds (the calendar was hidden
      // and shown again, or read in another tab). There is nothing here to add it to, and its
      // cursor would say otherwise. The calendar keeps the cursor it has, and is read from there.
      if (!result.full && now.syncToken !== since) continue;

      if (result.full) change.clearEvents.push(result.calendarId);
      // Only what is this account's and this calendar's is kept, whatever the answer holds.
      change.putEvents.push(...result.events.filter((event) => event.id === eventKey(id, result.calendarId, event.providerEventId) && within(event, window)));
      change.removeEvents.push(...result.removed.map((removed) => eventKey(id, result.calendarId, removed)));
      const next = { ...now, syncToken: result.syncToken, fetchedAt, ...(result.full ? { windowFrom: window.from, windowTo: window.to } : {}) };
      change.calendars.push(next);
      calendars = calendars.map((calendar) => (calendar.id === key ? next : calendar));
    }

    const gone = (event: ExternalEvent) => event.connectionId === id && (change.dropCalendars.includes(event.calendarId) || change.clearEvents.includes(event.calendarId));
    const removed = new Set(change.removeEvents);
    const put = new Map(change.putEvents.map((event) => [event.id, event]));
    const events = [...state.events.filter((event) => !gone(event) && !removed.has(event.id) && !put.has(event.id)), ...put.values()];
    return { change, calendars, events };
  };

  // Written first, and shown only once it is written. The copy decides, in the one transaction
  // that writes to it: if the account's part is no longer the one this was read for (Disconnect,
  // someone else signing in, in any tab), nothing is written and nothing is shown. Where there
  // is no way to keep a copy at all, it is shown for this visit as before.
  const kept = await saveConnection(id, mine, settled().change).catch(() => undefined);
  if (kept === false) {
    await adopt();
    return 'stop';
  }
  if (era !== began) return 'stop';

  // Asked again, from now: a calendar shown or hidden while that was being written stays so.
  const { calendars, events } = settled();
  set({ calendars: order(calendars), events });
}

/**
 * What to do when the server could not read one account. It is that account's trouble: unless
 * the answer says something about the device as a whole, the others are read all the same.
 *
 * @param mine The part of the copy the reading was for.
 */
async function refused(id: string, error: ApiError | 'offline', mine: string | undefined): Promise<'stop' | void> {
  if (error === 'signed_out') {
    again = false;
    // Said of an account this device no longer has in that form: it is not news about what is here now.
    if (!(await holdsAccount(id, mine))) await adopt();
    // This device is no longer signed in to Koyomi. No account can be read until it is.
    else become('signin');
    return 'stop';
  }
  if (error === 'offline') {
    // No way out to the server at all: the other accounts would be told the same.
    again = false;
    set({ syncing: false });
    return 'stop';
  }
  if (error === 'reconnect') {
    // Google has refused this account's permission. Only asking Google again mends it.
    const kept = await saveConnection(id, mine, { status: 'reconnect' }).catch(() => undefined);
    if (kept === false) {
      await adopt();
      return 'stop';
    }
    set({ connections: state.connections.map((connection) => (connection.id === id ? { ...connection, status: 'reconnect' } : connection)) });
    return;
  }
  // Signed in, and this account is not connected: it was ended somewhere else. This device follows.
  if (error === 'not_connected' && (await forget(id, mine)) !== 'others') return 'stop';
  // Google busy about this account, or it was asked too often: what was read before is still good.
}

/**
 * Reads the connected calendars again: which accounts and calendars exist, then the events of
 * the ones being shown, one account after another. A calendar read recently is asked only for
 * what changed since.
 *
 * Only one reading runs at a time. Asking again while one is under way does not start a second:
 * a single further reading follows the first, however many times it was asked for.
 *
 * @param only Read just this calendar's events, without listing accounts again.
 */
export async function sync(only?: CalendarRef): Promise<void> {
  await ready;
  if (off()) return;
  if (state.syncing) {
    again = true;
    return;
  }
  set({ syncing: true, note: null });
  const began = era;

  let round = only ? [only.connectionId] : [];
  if (!only) {
    // The accounts this list is asked under. If one leaves the copy while the list is on its
    // way, the list is late: it is not taken up, and so cannot bring that account back.
    const mine = roster;
    const answer = await call<CalendarsResponse>('/api/google/calendars');
    if (era !== began) return;
    if (!answer.ok) return failed(answer.error, mine);
    const listed = answer.data.connections;

    // Nothing here and nothing there: no copy is begun for it.
    if (listed.length || mine !== null) {
      const kept = await saveListing(laid(listed).change, mine).catch(() => undefined);
      if (kept === false) return adopt();
      if (era !== began) return;
      if (kept) know(kept);
    }
    // Signed in, and no account is connected: the last was ended somewhere else, or the
    // address only claimed there was one. This device follows.
    if (!listed.length) {
      unconfirmed = false;
      return ended();
    }
    // Asked again, from now: a calendar shown or hidden while that was being written stays so.
    const now = laid(listed);
    unconfirmed = false;
    flag.set('connected');
    set({ status: 'connected', connections: orderConnections(now.connections), calendars: order(now.calendars), events: now.events });
    round = listed.filter((entry) => entry.state === 'ok').map((entry) => entry.connectionId);
  }

  for (const id of round) if ((await read(id, began, only?.calendarId)) === 'stop') return;

  set({ syncing: false });
  tell();
  if (again) {
    again = false;
    await sync();
  }
}

/** Shows or hides one calendar. A hidden calendar is not read, and its events are not kept. */
export async function showCalendar(id: string, visible: boolean) {
  const calendar = state.calendars.find((known) => known.id === id);
  if (!calendar) return;
  const next = { ...calendar, visible, ...(visible ? {} : { syncToken: null, windowFrom: null, windowTo: null, fetchedAt: null }) };
  const began = era;
  set({ calendars: state.calendars.map((known) => (known.id === id ? next : known)), events: visible ? state.events : state.events.filter((event) => !eventsOf(calendar)(event)) });
  // The choice is shown at once. It is kept only if the account's part of the copy is still the one it was made in.
  const kept = await saveConnection(calendar.connectionId, epochs[calendar.connectionId], { calendars: [next], clearEvents: visible ? [] : [calendar.calendarId] }).catch(() => undefined);
  if (kept === false) return adopt();
  if (era !== began) return;
  tell();
  // Only the calendar that has just been shown needs reading.
  if (visible) await sync({ connectionId: calendar.connectionId, calendarId: calendar.calendarId });
}

/**
 * Leaves the calendar for 6Away's sign-in (if needed) and then Google, which asks which account
 * and for its consent. A device that shows no account yet says so by leaving `add` out: if the
 * person turns out to have accounts connected already, it is sent back to read those instead.
 */
export const addAccount = () => location.assign(state.connections.length ? '/api/google/connect?add=1' : '/api/google/connect');

/**
 * Called when the address says the visitor is back from giving Google's permission. The address
 * is only a hint: it is the server answering with their accounts that makes it so. Until then
 * nothing is remembered, and if the server says otherwise this device is left as it was.
 */
export async function connected() {
  await ready;
  await renew();
  unconfirmed = off();
  set({ status: 'connected', note: null });
  await sync();
}

/** Leaves for 6Away's sign-in, and comes back to carry on. Google is not involved. */
export const signIn = () => location.assign(`/api/auth/signin?returnTo=${encodeURIComponent('/?calendars=resume')}`);

/**
 * Called when the visitor comes back from signing in to 6Away. Their connections were never
 * gone, so reading simply carries on. If it turns out Google has refused one in the meantime,
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
 * Ends one account's connection. The server withdraws that account's permission at Google and
 * deletes its token; this device deletes its copy of that account's calendars and events. The
 * other accounts, and Koyomi's own events, are not involved.
 */
export async function disconnect(id: string): Promise<void> {
  // Whatever is being read is let go, so that it is not what this ends on.
  const mine = epochs[id];
  era++;
  again = false;
  set({ syncing: true, note: null });
  const done = await call<{ ok: true }>('/api/google/disconnect', { connectionId: id });
  if (done.ok || done.error === 'not_connected') {
    // If another tab has begun this account's part again meanwhile, that is not this Disconnect's to end.
    if ((await forget(id, mine)) !== 'others') return;
    // The server has just answered, so this device is signed in. What is still connected is
    // read afresh: whatever was being read for it when this began was let go.
    become('connected');
    return sync();
  }
  if (done.error === 'signed_out') {
    // The server no longer knows this device, so it cannot be told. Sign in, then finish.
    intent.leave(`disconnect:${id}`);
    location.assign(`/api/auth/signin?returnTo=${encodeURIComponent('/?calendars=disconnect')}`);
    return;
  }
  set({ syncing: false, note: 'Couldn’t disconnect just now. Try again in a moment.' });
}

/** Back from signing in, having asked to disconnect an account: now it can be done. A bare link does nothing. */
export async function finishDisconnect() {
  await ready;
  const [what, id] = intent.take()?.split(':') ?? [];
  if (what === 'disconnect' && state.connections.some((connection) => connection.id === id)) await disconnect(id);
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
    turn(NOTHING);
    set({ status: 'off', connections: [], calendars: [], events: [], syncing: false });
  });
  // Only a working sign-in is read on its own. One that has ended waits for the person.
  const refresh = () => {
    if (document.visibilityState === 'visible' && state.status === 'connected' && stale()) void sync();
  };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', refresh);
  setInterval(refresh, EVERY_MS);

  ready = load().catch(() => {});
  void ready.then(refresh);
}
