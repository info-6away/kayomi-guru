import type { ExternalCalendar, ExternalEvent } from './types';

// This device's copy of connected calendars, so they are still there with no connection.
//
// It is a database of its own, not a store inside Koyomi's. Two things follow. Koyomi's own
// database is opened, changed and upgraded by nothing in this file, so a calendar saved before
// connections existed is exactly as it was. And this copy can be deleted whole, at any time,
// without going near a single Koyomi event: it is only ever a copy of what the provider has.
//
// No credential is ever written here. The browser is never given one.
//
// The copy is for one connection, and says which: its epoch, a made-up word written when the
// copy begins and gone when it ends. It names nobody and nothing outside this device. Several
// tabs share the copy and none of them can know what another has just done, so the epoch is
// what decides. Every change is made in one transaction that first reads the epoch and goes
// ahead only if it is the one the change was meant for. A reading that comes back after
// Disconnect, or after a different connection has taken the copy's place, finds another epoch
// or none, and writes nothing.

const NAME = 'koyomi-external';
const VERSION = 2;
const ALL = ['meta', 'calendars', 'events'];
/** The one record in `meta`: `{ epoch }`. */
const CONNECTION = 'connection';

/** There is no copy on this device, and this was not the moment to make one. */
class NoCopy extends Error {}

let opening: Promise<IDBDatabase> | null = null;
let deleted: (() => void) | null = null;

/** Calls back when another tab deletes the copy while this one has it open. The database itself says so. */
export const whenDeleted = (listener: () => void) => {
  deleted = listener;
};

/**
 * @param create Whether to make the copy if there is none. Only the first reading of a new
 *   connection does. Everything else leaves a device with no copy exactly as it is.
 */
function open(create = false): Promise<IDBDatabase> {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = (event) => {
      // Nothing here yet, and not the moment to begin: back out, so that nothing is left behind.
      if (event.oldVersion === 0 && !create) return req.transaction!.abort();
      if (event.oldVersion < 1) {
        req.result.createObjectStore('calendars', { keyPath: 'id' });
        req.result.createObjectStore('events', { keyPath: 'id' }).createIndex('calendar', 'calendarId');
      }
      // A copy made before epochs has none. It is given one the first time it is opened (store.ts).
      if (event.oldVersion < 2) req.result.createObjectStore('meta');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is deleting the copy (Disconnect), or upgrading it: let go so it can.
      db.onversionchange = (event) => {
        db.close();
        opening = null;
        if (event.newVersion === null) deleted?.();
      };
      resolve(db);
    };
    req.onerror = (event) => {
      opening = null;
      // Backing out of making it is not an error to report.
      event.preventDefault();
      reject(req.error?.name === 'AbortError' ? new NoCopy() : req.error);
    };
  }));
}

/** Opens the copy, making it if asked to even when another caller has just found there is none. */
const opened = (create: boolean) => open(create).catch((error) => (create && error instanceof NoCopy ? open(true) : Promise.reject(error)));

/**
 * Begins a transaction over the whole copy and hands it to `use` at once, while it is still
 * open to requests. If this tab let go of the copy a moment ago (another tab was deleting it),
 * the copy is opened again, which then says whether there still is one.
 */
async function within<T>(mode: IDBTransactionMode, create: boolean, use: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const db = await opened(create);
    let tx: IDBTransaction;
    try {
      tx = db.transaction(ALL, mode);
    } catch (error) {
      if (attempt || (error as DOMException)?.name !== 'InvalidStateError') throw error;
      opening = null;
      continue;
    }
    return use(tx);
  }
}

/** Reads the epoch. Still inside the transaction when `then` is called: nothing another tab does can come in between. */
function epochIn(tx: IDBTransaction, then: (epoch: string | null) => void) {
  const held = tx.objectStore('meta').get(CONNECTION);
  held.onsuccess = () => then((held.result as { epoch?: string } | undefined)?.epoch ?? null);
}

const none = <T>(otherwise: T) => (error: unknown) => {
  if (error instanceof NoCopy) return otherwise;
  throw error;
};

export interface Copy {
  /** Which connection the copy is for, or null where there is no copy (or one from before epochs). */
  epoch: string | null;
  calendars: ExternalCalendar[];
  events: ExternalEvent[];
}

export function loadExternal(): Promise<Copy> {
  return within(
    'readonly',
    false,
    (tx) =>
      new Promise<Copy>((resolve, reject) => {
        let epoch: string | null = null;
        epochIn(tx, (now) => (epoch = now));
        const calendars = tx.objectStore('calendars').getAll();
        const events = tx.objectStore('events').getAll();
        tx.oncomplete = () => resolve({ epoch, calendars: calendars.result, events: events.result });
        tx.onerror = tx.onabort = () => reject(tx.error);
      }),
  ).catch(none<Copy>({ epoch: null, calendars: [], events: [] }));
}

/** The epoch of the copy on this device right now, or null if there is none. */
export function epochNow(): Promise<string | null> {
  return within(
    'readonly',
    false,
    (tx) =>
      new Promise<string | null>((resolve, reject) => {
        epochIn(tx, resolve);
        tx.onerror = tx.onabort = () => reject(tx.error);
      }),
  ).catch(none<string | null>(null));
}

/** Changes to the copy, applied together or not at all. */
export interface ExternalChange {
  /** Calendars to add or update. */
  calendars?: ExternalCalendar[];
  /** Calendar ids (as the provider names them) to forget, with every event of theirs. */
  dropCalendars?: string[];
  /** Calendars whose events are to be replaced outright by a fresh reading. */
  clearEvents?: string[];
  putEvents?: ExternalEvent[];
  removeEvents?: string[];
}

/**
 * Runs `work` in one transaction over the whole copy, but only if the copy is the one meant.
 *
 * @param expected The epoch the caller began from: null for the first reading of a connection,
 *   which is what begins the copy.
 * @returns What `work` returned, or false if the copy is another connection's now, or gone.
 */
function ifStill<T>(expected: string | null, work: (tx: IDBTransaction, epoch: string | null) => T): Promise<T | false> {
  return within(
    'readwrite',
    expected === null,
    (tx) =>
      new Promise<T | false>((resolve, reject) => {
        let done: T | false = false;
        epochIn(tx, (epoch) => {
          if (epoch === expected) done = work(tx, epoch);
        });
        tx.oncomplete = () => resolve(done);
        tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Write failed'));
      }),
  ).catch(none<T | false>(false));
}

const newEpoch = () => crypto.randomUUID();

/**
 * Writes a change to the copy, if the copy is still the one the change was read for.
 *
 * @returns The copy's epoch (a new one, if this began it), or false if nothing was written
 *   because the copy has ended or belongs to another connection.
 */
export function saveExternal(change: ExternalChange, expected: string | null): Promise<string | false> {
  return ifStill(expected, (tx, epoch) => {
    const calendars = tx.objectStore('calendars');
    const events = tx.objectStore('events');
    const clear = (calendarId: string) => {
      const cursor = events.index('calendar').openKeyCursor(IDBKeyRange.only(calendarId));
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        events.delete(cursor.result.primaryKey);
        cursor.result.continue();
      };
    };
    for (const calendarId of change.dropCalendars ?? []) {
      calendars.delete(`google:${calendarId}`);
      clear(calendarId);
    }
    for (const calendarId of change.clearEvents ?? []) clear(calendarId);
    for (const id of change.removeEvents ?? []) events.delete(id);
    // Requests in a transaction run in order, so what is put here survives the clearing above.
    for (const event of change.putEvents ?? []) events.put(event);
    for (const calendar of change.calendars ?? []) calendars.put(calendar);
    const now = epoch ?? newEpoch();
    if (!epoch) tx.objectStore('meta').put({ epoch: now }, CONNECTION);
    return now;
  });
}

/**
 * Gives the copy a new epoch and keeps what it holds: for when the person has just been to
 * 6Away or Google and back, so that anything asked for before they went is not kept.
 *
 * @returns The new epoch, or false if the copy has ended or is another connection's.
 */
export function renewExternal(expected: string): Promise<string | false> {
  return ifStill(expected, (tx) => {
    const epoch = newEpoch();
    tx.objectStore('meta').put({ epoch }, CONNECTION);
    return epoch;
  });
}

/**
 * Ends the copy: its epoch, its calendars and its events go in one transaction, and then the
 * emptied database is deleted. Koyomi's own calendar is a different database and is not touched.
 *
 * @param expected End it only if it is still this connection's. Left out, it is ended whatever it is.
 * @returns false if it was left alone because it is another connection's now.
 */
export async function endExternal(expected?: string | null): Promise<boolean> {
  const emptied = await within(
    'readwrite',
    false,
    (tx) =>
      new Promise<boolean>((resolve) => {
        let mine = false;
        epochIn(tx, (epoch) => {
          mine = expected === undefined || epoch === expected;
          if (mine) for (const name of ALL) tx.objectStore(name).clear();
        });
        tx.oncomplete = () => {
          // Let go of it, so that deleting it below waits for nobody here.
          if (mine) tx.db.close();
          resolve(mine);
        };
        // It could not be emptied. Deleting it below is still tried, unless it may not be this one's to end.
        tx.onerror = tx.onabort = () => resolve(expected === undefined);
      }),
    // No copy, or no way to open one: then there is nothing here to empty.
  ).catch(() => true);
  if (!emptied) return false;
  opening = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  return true;
}
