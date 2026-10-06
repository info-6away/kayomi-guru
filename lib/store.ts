import { useSyncExternalStore } from 'react';
import { addDays, spanOf, toInstant } from './dates';
import { commit, loadAll, type Change } from './db';
import { occurrenceDays } from './recurrence';
import type { CalendarEvent, Category, PlanItem } from './types';

// Every record lives in memory and is written through to IndexedDB on each change.

export interface Data {
  ready: boolean;
  events: CalendarEvent[];
  plan: PlanItem[];
  /** The last change could not be written to this device. */
  saveFailed: boolean;
}

const EMPTY: Data = { ready: false, events: [], plan: [], saveFailed: false };
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
  const { events, planItems } = await loadAll();
  set({ ready: true, events, plan: planItems });
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
const itemById = (id: string) => data.plan.find((p) => p.id === id);

export function addEvent(input: {
  title: string;
  date: string;
  start: number;
  end: number;
  category?: Category;
  planItemId?: string;
}): CalendarEvent {
  const now = stamp();
  const event: CalendarEvent = {
    id: newId(),
    title: input.title,
    start: toInstant(input.date, input.start),
    end: toInstant(input.date, input.end),
    allDay: false,
    category: input.category ?? 'misc',
    planItemId: input.planItemId ?? null,
    recurrence: null,
    createdAt: now,
    updatedAt: now,
  };
  set({ events: [...data.events, event] });
  void save({ put: { events: [event] } });
  return event;
}

export function updateEvent(
  id: string,
  patch: Partial<Pick<CalendarEvent, 'title' | 'start' | 'end' | 'category' | 'recurrence'>>,
) {
  const current = eventById(id);
  if (!current) return;
  const now = stamp();
  const event = { ...current, ...patch, updatedAt: now };
  const change: Change = { put: { events: [event] } };
  let plan = data.plan;
  // An event scheduled from Plan and its item are one thing with one title.
  const item = current.planItemId ? itemById(current.planItemId) : undefined;
  if (item && patch.title !== undefined && patch.title !== item.title) {
    const renamed = { ...item, title: patch.title, updatedAt: now };
    plan = plan.map((p) => (p.id === item.id ? renamed : p));
    change.put!.planItems = [renamed];
  }
  set({ events: data.events.map((e) => (e.id === id ? event : e)), plan });
  void save(change);
}

/** Deletes an event for good. If it came from Plan, its Plan item goes with it. */
export function deleteEvent(id: string) {
  const current = eventById(id);
  if (!current) return;
  const itemId = current.planItemId;
  set({
    events: data.events.filter((e) => e.id !== id),
    plan: itemId ? data.plan.filter((p) => p.id !== itemId) : data.plan,
  });
  void save({ remove: { events: [id], planItems: itemId ? [itemId] : [] } });
}

/** Takes an event scheduled from Plan off the calendar; its item waits in Plan again. */
export function backToPlan(eventId: string) {
  const current = eventById(eventId);
  if (!current?.planItemId) return;
  const now = stamp();
  const existing = itemById(current.planItemId);
  const item: PlanItem = existing
    ? { ...existing, status: 'open', updatedAt: now }
    : { id: current.planItemId, title: current.title, status: 'open', createdAt: now, updatedAt: now };
  set({
    events: data.events.filter((e) => e.id !== eventId),
    plan: existing ? data.plan.map((p) => (p.id === item.id ? item : p)) : [...data.plan, item],
  });
  void save({ remove: { events: [eventId] }, put: { planItems: [item] } });
}

export function addPlanItem(title: string): PlanItem {
  const now = stamp();
  const item: PlanItem = { id: newId(), title, status: 'open', createdAt: now, updatedAt: now };
  set({ plan: [...data.plan, item] });
  void save({ put: { planItems: [item] } });
  return item;
}

export function setPlanStatus(id: string, status: PlanItem['status']) {
  const current = itemById(id);
  if (!current || current.status === status) return;
  const item = { ...current, status, updatedAt: stamp() };
  set({ plan: data.plan.map((p) => (p.id === id ? item : p)) });
  void save({ put: { planItems: [item] } });
}

/** Gives a Plan item an hour on the calendar. */
export function schedulePlanItem(id: string, date: string, start: number): CalendarEvent | undefined {
  const item = itemById(id);
  if (!item || data.events.some((e) => e.planItemId === id)) return;
  return addEvent({ title: item.title, date, start, end: start + 60, planItemId: id });
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
