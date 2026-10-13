import type { CalendarEvent } from './types';

// The product's first spelling, kept on purpose: under a new name the browser would open an
// empty database and everything already saved would seem to be gone.
const NAME = 'kayomi';
const VERSION = 1;
/**
 * Version 1 has had these two stores since the first release, and still has. Koyomi used to
 * keep a Plan list in the second; it no longer reads or writes it. The store, and whatever a
 * device already holds in it, is left exactly as it is: taking it away would mean changing a
 * database whose only job is to keep people's events safe.
 */
const SHAPE = ['events', 'planItems'] as const;

/** Events to write and ids to delete, applied in one transaction. */
export interface Change {
  put?: CalendarEvent[];
  remove?: string[];
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      for (const name of SHAPE) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer version of the app opened the database in another tab: let it upgrade.
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

export async function loadAll(): Promise<CalendarEvent[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readonly');
    const events = tx.objectStore('events').getAll();
    tx.oncomplete = () => resolve(events.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function commit(change: Change): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    // 'strict' waits for the data to reach disk, so a change survives the app closing right after.
    const tx = db.transaction('events', 'readwrite', { durability: 'strict' });
    const store = tx.objectStore('events');
    change.put?.forEach((record) => store.put(record));
    change.remove?.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Write failed'));
  });
}
