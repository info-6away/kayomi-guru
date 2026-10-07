import type { ExternalCalendar, ExternalEvent } from './types';

// This device's copy of connected calendars, so they are still there with no connection.
//
// It is a database of its own, not a store inside Koyomi's. Two things follow. Koyomi's own
// database is opened, changed and upgraded by nothing in this file, so a calendar saved before
// connections existed is exactly as it was. And this copy can be deleted whole, at any time,
// without going near a single Koyomi event: it is only ever a copy of what the provider has.
//
// No credential is ever written here. The browser is never given one.

const NAME = 'koyomi-external';
const VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('calendars', { keyPath: 'id' });
      req.result.createObjectStore('events', { keyPath: 'id' }).createIndex('calendar', 'calendarId');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is deleting the copy (Disconnect): let go so it can.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  }));
}

export async function loadExternal(): Promise<{ calendars: ExternalCalendar[]; events: ExternalEvent[] }> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['calendars', 'events'], 'readonly');
    const calendars = tx.objectStore('calendars').getAll();
    const events = tx.objectStore('events').getAll();
    tx.oncomplete = () => resolve({ calendars: calendars.result, events: events.result });
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
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

export async function saveExternal(change: ExternalChange): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['calendars', 'events'], 'readwrite');
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
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Write failed'));
  });
}

/** Deletes the whole copy. Koyomi's own calendar is a different database and is not touched. */
export async function deleteExternal(): Promise<void> {
  const db = await opening?.catch(() => null);
  db?.close();
  opening = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
