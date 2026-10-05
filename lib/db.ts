import type { CalendarEvent, PlanItem } from './types';

const NAME = 'kayomi';
const VERSION = 1;
const STORES = ['events', 'planItems'] as const;

/** Records to write and ids to delete, applied in one transaction. */
export interface Change {
  put?: { events?: CalendarEvent[]; planItems?: PlanItem[] };
  remove?: { events?: string[]; planItems?: string[] };
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) {
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

export async function loadAll(): Promise<{ events: CalendarEvent[]; planItems: PlanItem[] }> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readonly');
    const events = tx.objectStore('events').getAll();
    const planItems = tx.objectStore('planItems').getAll();
    tx.oncomplete = () => resolve({ events: events.result, planItems: planItems.result });
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function commit(change: Change): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    // 'strict' waits for the data to reach disk, so a change survives the app closing right after.
    const tx = db.transaction(STORES, 'readwrite', { durability: 'strict' });
    for (const name of STORES) {
      const store = tx.objectStore(name);
      change.put?.[name]?.forEach((record) => store.put(record));
      change.remove?.[name]?.forEach((id) => store.delete(id));
    }
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Write failed'));
  });
}
