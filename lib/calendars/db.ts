import { calendarKey, type ExternalCalendar, type ExternalConnection, type ExternalEvent } from './types';

// This device's copy of connected calendars, so they are still there with no connection.
//
// It is a database of its own, not a store inside Koyomi's. Two things follow. Koyomi's own
// database is opened, changed and upgraded by nothing in this file, so a calendar saved before
// connections existed is exactly as it was. And this copy can be deleted whole, at any time,
// without going near a single Koyomi event: it is only ever a copy of what the provider has.
//
// No credential is ever written here. The browser is never given one.
//
// The copy is in parts, one for each connected account, and no part can be written into from
// another: every calendar and every event is filed under its connection, so two accounts that
// hold a calendar or an event with the very same id at the provider hold two different records
// here.
//
// Several tabs share the copy and none of them can know what another has just done, so the copy
// itself is what decides, by two kinds of made-up word that name nobody and nothing outside
// this device:
//
// - Each connection has an **epoch**, written when its part begins and gone when it ends. What
//   was read for an account is written only in a transaction that first finds that account
//   still here, with the epoch the reading began from. A reading that comes back after its
//   account was disconnected, or after someone else signed in, writes nothing. A reading for
//   another account is not affected by any of that.
// - The copy has a **roster** word for which accounts it holds. It changes whenever an account
//   leaves. A list of accounts from the server is taken up only if the roster is still the one
//   it was asked under, so a list that is late cannot bring back an account that has gone.

const NAME = 'koyomi-external';
const VERSION = 3;
const ALL = ['meta', 'connections', 'calendars', 'events'];
/** The one record in `meta`: `{ roster }`. */
const COPY = 'copy';

/** There is no copy on this device, and this was not the moment to make one. */
class NoCopy extends Error {}

/** A connection as the copy holds it: what the app knows of it, and its epoch. */
type Stored = ExternalConnection & { epoch: string };
const plain = ({ epoch: _, ...connection }: Stored): ExternalConnection => connection;

let opening: Promise<IDBDatabase> | null = null;
let deleted: (() => void) | null = null;

/** Calls back when another tab deletes the copy while this one has it open. The database itself says so. */
export const whenDeleted = (listener: () => void) => {
  deleted = listener;
};

/**
 * @param create Whether to make the copy if there is none. Only the first reading of a first
 *   account does. Everything else leaves a device with no copy exactly as it is.
 */
function open(create = false): Promise<IDBDatabase> {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = (event) => {
      // Nothing here yet, and not the moment to begin: back out, so that nothing is left behind.
      if (event.oldVersion === 0 && !create) return req.transaction!.abort();
      const db = req.result;
      // A copy made before accounts were told apart was filed by calendar alone, and cannot say
      // which account anything in it came from. It is only a copy, so it is not carried over:
      // it goes here, and what is connected is read again from the provider.
      for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
      db.createObjectStore('meta');
      db.createObjectStore('connections', { keyPath: 'id' });
      db.createObjectStore('calendars', { keyPath: 'id' }).createIndex('connection', 'connectionId');
      const events = db.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('connection', 'connectionId');
      events.createIndex('calendar', ['connectionId', 'calendarId']);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is deleting the copy (the last account was disconnected), or upgrading it: let go so it can.
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

const none = <T>(otherwise: T) => (error: unknown) => {
  if (error instanceof NoCopy) return otherwise;
  throw error;
};

/** What the copy says of itself: its roster word, and each account's epoch by the connection's id. */
export interface Roster {
  /** Null where there is no copy. */
  roster: string | null;
  epochs: Record<string, string>;
}
const NOTHING: Roster = { roster: null, epochs: {} };

interface Held {
  roster: string | null;
  stored: Stored[];
}
const rosterOf = ({ roster, stored }: Held): Roster => ({ roster, epochs: Object.fromEntries(stored.map((connection) => [connection.id, connection.epoch])) });

/** Reads what the copy says of itself. Still inside the transaction when `then` is called: nothing another tab does can come in between. */
function heldIn(tx: IDBTransaction, then: (held: Held) => void) {
  const meta = tx.objectStore('meta').get(COPY);
  const connections = tx.objectStore('connections').getAll();
  // Requests are answered in the order they were made, so by the second answer both are in.
  connections.onsuccess = () => then({ roster: (meta.result as { roster?: string } | undefined)?.roster ?? null, stored: connections.result as Stored[] });
}

export interface Copy extends Roster {
  connections: ExternalConnection[];
  calendars: ExternalCalendar[];
  events: ExternalEvent[];
}

export function loadExternal(): Promise<Copy> {
  return within(
    'readonly',
    false,
    (tx) =>
      new Promise<Copy>((resolve, reject) => {
        let held: Held = { roster: null, stored: [] };
        heldIn(tx, (now) => (held = now));
        const calendars = tx.objectStore('calendars').getAll();
        const events = tx.objectStore('events').getAll();
        tx.oncomplete = () => resolve({ ...rosterOf(held), connections: held.stored.map(plain), calendars: calendars.result, events: events.result });
        tx.onerror = tx.onabort = () => reject(tx.error);
      }),
  ).catch(none<Copy>({ ...NOTHING, connections: [], calendars: [], events: [] }));
}

/** What the copy on this device says of itself right now. */
export function rosterNow(): Promise<Roster> {
  return within(
    'readonly',
    false,
    (tx) =>
      new Promise<Roster>((resolve, reject) => {
        heldIn(tx, (held) => resolve(rosterOf(held)));
        tx.onerror = tx.onabort = () => reject(tx.error);
      }),
  ).catch(none<Roster>(NOTHING));
}

const newWord = () => crypto.randomUUID();

/**
 * Runs `work` in one transaction over the whole copy, once the copy has said what it holds.
 * `work` decides from that whether to go ahead, and returns false if it does not.
 *
 * @param end Called by `work` when what it has done leaves no account here: everything is
 *   cleared in the same transaction, and the emptied database is deleted afterwards, so that a
 *   device with nothing connected has no such database at all.
 * @returns What `work` returned, or false where there is no copy.
 */
function write<T>(create: boolean, work: (tx: IDBTransaction, held: Held, end: () => void) => T | false): Promise<T | false> {
  return within(
    'readwrite',
    create,
    (tx) =>
      new Promise<T | false>((resolve, reject) => {
        let done: T | false = false;
        let ended = false;
        const end = () => {
          ended = true;
          for (const name of ALL) tx.objectStore(name).clear();
        };
        heldIn(tx, (held) => {
          done = work(tx, held, end);
        });
        tx.oncomplete = () => {
          if (!ended) return resolve(done);
          // Let go of it, so that deleting it waits for nobody here.
          tx.db.close();
          opening = null;
          const req = indexedDB.deleteDatabase(NAME);
          req.onsuccess = req.onerror = req.onblocked = () => resolve(done);
        };
        tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Write failed'));
      }),
  ).catch(none<T | false>(false));
}

/** Deletes whatever an index finds under one key, when the answer arrives. */
function deleteUnder(store: IDBObjectStore, index: string, key: IDBValidKey, then?: () => void) {
  const found = store.index(index).getAllKeys(IDBKeyRange.only(key));
  found.onsuccess = () => {
    for (const each of found.result) store.delete(each);
    then?.();
  };
}

/** Takes one account out of the copy: the connection, its calendars and its events. */
function forgetIn(tx: IDBTransaction, connectionId: string) {
  tx.objectStore('connections').delete(connectionId);
  deleteUnder(tx.objectStore('calendars'), 'connection', connectionId);
  deleteUnder(tx.objectStore('events'), 'connection', connectionId);
}

/** A calendar, by the account it belongs to and its id at the provider. */
export interface CalendarRef {
  connectionId: string;
  calendarId: string;
}

/** What the server's list of accounts comes to on this device, applied together or not at all. */
export interface ListingChange {
  /** Every account the person has, as it is to be remembered. One that is new to the copy begins here; one the copy holds that is not among these is forgotten whole. */
  connections: ExternalConnection[];
  /** Calendars to add or update. */
  calendars: ExternalCalendar[];
  /** Calendars to forget, with every event of theirs. */
  dropCalendars: CalendarRef[];
}

/**
 * Takes up the server's list of accounts, if the copy still holds the accounts it held when the
 * list was asked for.
 *
 * @param expected The roster the list was asked under: null where there was no copy, which is
 *   what begins one.
 * @returns What the copy says of itself afterwards, or false if nothing was written because
 *   the copy is not the one this was asked for.
 */
export function saveListing(change: ListingChange, expected: string | null): Promise<Roster | false> {
  return write(expected === null, (tx, held, end) => {
    if (held.roster !== expected) return false;
    const listed = new Set(change.connections.map((connection) => connection.id));
    const leaving = held.stored.filter((connection) => !listed.has(connection.id));
    if (!change.connections.length) {
      end();
      return NOTHING;
    }
    for (const connection of leaving) forgetIn(tx, connection.id);

    const connections = tx.objectStore('connections');
    const stored = change.connections.map((connection): Stored => ({ ...connection, epoch: held.stored.find((known) => known.id === connection.id)?.epoch ?? newWord() }));
    for (const connection of stored) connections.put(connection);

    // Only for accounts that are staying: nothing is filed under one that has just left.
    const calendars = tx.objectStore('calendars');
    for (const { connectionId, calendarId } of change.dropCalendars) {
      calendars.delete(calendarKey(connectionId, calendarId));
      deleteUnder(tx.objectStore('events'), 'calendar', [connectionId, calendarId]);
    }
    for (const calendar of change.calendars) if (listed.has(calendar.connectionId)) calendars.put(calendar);

    // An account leaving is what a late list must not undo, so that is when the roster moves on.
    const roster = held.roster === null || leaving.length ? newWord() : held.roster;
    if (roster !== held.roster) tx.objectStore('meta').put({ roster }, COPY);
    return rosterOf({ roster, stored });
  });
}

/** Changes to one account's part of the copy, applied together or not at all. */
export interface ConnectionChange {
  status?: ExternalConnection['status'];
  /** Calendars to add or update. */
  calendars?: ExternalCalendar[];
  /** Calendar ids (as the provider names them) to forget, with every event of theirs. */
  dropCalendars?: string[];
  /** Calendars whose events are to be replaced outright by a fresh reading. */
  clearEvents?: string[];
  putEvents?: ExternalEvent[];
  /** Ids of events to remove, as they are filed here. */
  removeEvents?: string[];
}

/**
 * Writes a change to one account's part of the copy, if that account is still here and still
 * the one the change was read for. Nothing filed under another account is written or removed,
 * whatever the change holds.
 *
 * @param expected The epoch the caller began from.
 * @returns false if nothing was written because the account has left the copy, or its part
 *   has begun again since.
 */
export function saveConnection(connectionId: string, expected: string | undefined, change: ConnectionChange): Promise<boolean> {
  return write(false, (tx, held) => {
    const connection = held.stored.find((known) => known.id === connectionId);
    if (!connection || connection.epoch !== expected) return false;
    const calendars = tx.objectStore('calendars');
    const events = tx.objectStore('events');
    const own = <T extends { connectionId: string }>(records: T[] = []) => records.filter((record) => record.connectionId === connectionId);
    const filedHere = `${connectionId}:`;

    // First what is cleared, then what is put, and never the other way round: a fresh reading
    // of a calendar replaces its events, and most of the new ones have the ids of the old.
    // Finding a calendar's old events is a request whose answer arrives later, after anything
    // asked for in the meantime. So what must come after the clearing is asked for from inside
    // that answer, once every calendar being cleared has been.
    const cleared = [...(change.dropCalendars ?? []), ...(change.clearEvents ?? [])];
    let finding = cleared.length;
    const afterClearing = () => {
      for (const id of change.removeEvents ?? []) if (id.startsWith(filedHere)) events.delete(id);
      for (const event of own(change.putEvents)) events.put(event);
    };
    for (const calendarId of cleared) deleteUnder(events, 'calendar', [connectionId, calendarId], () => --finding === 0 && afterClearing());
    if (!cleared.length) afterClearing();
    for (const calendarId of change.dropCalendars ?? []) calendars.delete(calendarKey(connectionId, calendarId));
    for (const calendar of own(change.calendars)) calendars.put(calendar);
    if (change.status && change.status !== connection.status) tx.objectStore('connections').put({ ...connection, status: change.status });
    return true;
  }).then((written) => written === true);
}

/**
 * Takes one account out of the copy: its connection, calendars and events go in one
 * transaction, and the roster moves on so that nothing asked before can bring it back. The
 * other accounts are not touched. If it was the last, the copy itself ends. Koyomi's own
 * calendar is a different database and is not involved.
 *
 * @param expected Take it out only if its part is still the one meant. Left out, it goes whatever it is.
 * @returns What the copy says of itself afterwards, or false if the account was left alone
 *   because its part has begun again since.
 */
export function dropConnection(connectionId: string, expected?: string): Promise<Roster | false> {
  return write<Roster>(false, (tx, held, end) => {
    const connection = held.stored.find((known) => known.id === connectionId);
    // Already gone: there is nothing to take out, and nothing to say of what is left.
    if (!connection) return rosterOf(held);
    if (expected !== undefined && connection.epoch !== expected) return false;
    const stored = held.stored.filter((known) => known.id !== connectionId);
    if (!stored.length) {
      end();
      return NOTHING;
    }
    forgetIn(tx, connectionId);
    const roster = newWord();
    tx.objectStore('meta').put({ roster }, COPY);
    return rosterOf({ roster, stored });
  }).then((left) => (left === false ? rosterNow().then((now) => (connectionId in now.epochs ? false : now)) : left));
}

/**
 * Gives the roster and every account a new word and keeps what the copy holds: for when the
 * person has just been to 6Away or Google and back, so that anything asked for before they
 * went, for any account, is not kept.
 *
 * @returns What the copy says of itself afterwards, or false if it is not the copy this was meant for.
 */
export function renewExternal(expected: string): Promise<Roster | false> {
  return write(false, (tx, held) => {
    if (held.roster !== expected) return false;
    const stored = held.stored.map((connection): Stored => ({ ...connection, epoch: newWord() }));
    for (const connection of stored) tx.objectStore('connections').put(connection);
    const roster = newWord();
    tx.objectStore('meta').put({ roster }, COPY);
    return rosterOf({ roster, stored });
  });
}

/** Ends the copy whatever it holds, and deletes the emptied database. Koyomi's own calendar is not touched. */
export async function endExternal(): Promise<void> {
  await write(false, (_tx, _held, end) => {
    end();
    return true;
  }).catch(() => {});
}
