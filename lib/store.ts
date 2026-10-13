import { useSyncExternalStore } from 'react';
import { addDays, spanOf, toInstant } from './dates';
import { commit, loadAll, type Change } from './db';
import { occurrenceDays } from './recurrence';
import type { CalendarEvent, Category } from './types';

// Every event lives in memory and is written through to IndexedDB on each change.

export interface Data {
  ready: boolean;
  events: CalendarEvent[];
  /** The last change could not be written to this device. */
  saveFailed: boolean;
}

const EMPTY: Data = { ready: false, events: [], saveFailed: false };
let data = EMPTY;
const listeners = new Set<() => void>();

function set(next: Partial<Data>) {
  data = { ...data, ...next };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useData = () => useSyncExternalStore(subscribe, () => data, () => EMPTY);

let channel: BroadcastChannel | null = null;
let started = false;
let askedToPersist = false;

async function load() {
  set({ ready: true, events: await loadAll() });
}

/** Reads the saved calendar. Call once, in the browser. */
export function init() {
  if (started) return;
  started = true;
  load().catch(() => set({ ready: true, saveFailed: true }));
  // Another tab or the installed app changed something: show it here too.
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('kayomi');
    channel.onmessage = () => void load().catch(() => {});
  }
}

async function save(change: Change) {
  try {
    await commit(change);
    channel?.postMessage('changed');
    // Once there is something worth keeping, ask the browser not to evict it when the disk runs low.
    // Asked here rather than on first open because some browsers show a prompt for it.
    if (!askedToPersist) {
      askedToPersist = true;
      void navigator.storage?.persist?.().catch(() => {});
    }
    if (data.saveFailed) set({ saveFailed: false });
  } catch {
    // Show what is really saved rather than a change that would vanish on reload.
    set({ saveFailed: true });
    await load().catch(() => {});
  }
}

const stamp = () => new Date().toISOString();

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID needs a secure context, which plain http on a LAN address is not.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const eventById = (id: string) => data.events.find((e) => e.id === id);

export function addEvent(input: { title: string; date: string; start: number; end: number; category?: Category }): CalendarEvent {
  const now = stamp();
  const event: CalendarEvent = {
    id: newId(),
    title: input.title,
    start: toInstant(input.date, input.start),
    end: toInstant(input.date, input.end),
    allDay: false,
    category: input.category ?? 'misc',
    recurrence: null,
    createdAt: now,
    updatedAt: now,
  };
  set({ events: [...data.events, event] });
  void save({ put: [event] });
  return event;
}

export function updateEvent(id: string, patch: Partial<Pick<CalendarEvent, 'title' | 'start' | 'end' | 'allDay' | 'category' | 'recurrence'>>) {
  const current = eventById(id);
  if (!current) return;
  const event = { ...current, ...patch, updatedAt: stamp() };
  set({ events: data.events.map((e) => (e.id === id ? event : e)) });
  void save({ put: [event] });
}

/** Deletes an event for good. */
export function deleteEvent(id: string) {
  if (!eventById(id)) return;
  set({ events: data.events.filter((e) => e.id !== id) });
  void save({ remove: [id] });
}

/** Removes one day from a series. */
export function skipOccurrence(id: string, day: string) {
  const current = eventById(id);
  if (!current?.recurrence) return;
  const recurrence = { ...current.recurrence, except: [...current.recurrence.except, day] };
  const first = spanOf(current).date;
  // Nothing left of a series that had an end: remove it rather than keep an event no day shows.
  if (recurrence.until && !occurrenceDays(first, recurrence, first, recurrence.until).length) deleteEvent(id);
  else updateEvent(id, { recurrence });
}

/** Ends a series the day before `day`, keeping its history. */
export function endSeriesBefore(id: string, day: string) {
  const current = eventById(id);
  if (!current?.recurrence) return;
  if (day <= spanOf(current).date) deleteEvent(id);
  else updateEvent(id, { recurrence: { ...current.recurrence, until: addDays(day, -1) } });
}
