import ICAL from 'ical.js';
import { addDays } from '../dates';
import { eventKey, type ExternalEvent } from './types';

// Turns iCalendar, as a CalDAV server returns it (Yahoo's), into Koyomi's record of each event in
// the window, and nothing more. A CalDAV server may send whole calendar objects whatever it is
// asked for, so this is where everything Koyomi does not show is left behind: descriptions,
// locations, organisers, attendees, alarms, attachments, conference details. Only the fields
// below are read, the text itself is not kept, and nothing of it is logged.
//
// Repeating events are expanded here, because Yahoo's server does not expand them: each
// occurrence in the window becomes an event of its own, with its exceptions applied (moved,
// renamed, cancelled, excluded), and the series itself is never shown as one more event.
//
// What is in a calendar is written by anyone who can send its owner an invitation, so working it
// out is bounded: a rule is stepped through no further than the span, a long-running daily or
// weekly one from just before the span rather than from its start, each rule only so many tries,
// and one calendar's reading only so long for all of its events together.

type Time = InstanceType<typeof ICAL.Time>;
type Component = InstanceType<typeof ICAL.Component>;
type Property = InstanceType<typeof ICAL.Property>;
type Recur = InstanceType<typeof ICAL.Recur>;
type Steps = InstanceType<typeof ICAL.RecurIterator>;

/** What one reading is for. */
export interface Reading {
  connectionId: string;
  calendarId: string;
  fetchedAt: string;
  /** The span asked for, as instants. Occurrences touching it are kept; the device trims to its own days. */
  timeMin: string;
  timeMax: string;
  /** Keep only repeating events: what a look further back is for. */
  repeatingOnly?: boolean;
  /** The time this calendar's reading has left, shared by all its objects. One of its own if none is given. */
  budget?: Budget;
}

/** However a series is written, no more of it than this is stepped through. */
export const MAX_STEPS = 20_000;
/**
 * ical.js finds a rule's next occurrence by trying one second, minute, hour or day after another
 * until the rule's parts allow it, and for some rules none ever does (every day that is a 30th of
 * February). No more than this many are tried for one rule.
 */
export const MAX_TRIES = 10_000;
/** How long working out one calendar's events may take, all of its objects together. */
export const READING_MS = 3_000;

/** The time one calendar's reading has left for working out its events, and whether it ran out. */
export interface Budget {
  left: number;
  ranOut: boolean;
}
export const budgetOf = (ms = READING_MS): Budget => ({ left: ms, ranOut: false });

const DAY_MS = 864e5;
/**
 * How far from the span a time can be, as its clock reads, and still touch it: a clock and the
 * instant it shows are less than a day apart in any zone, and all-day events have a day's slack.
 */
const NEAR_MS = 3 * DAY_MS;
const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (t: Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
/** What a time's clock reads, taken as if it were UTC: less than a day from its instant, whatever its zone. */
const wallOf = (t: Time) => Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);

/** One formatter for each zone name, made once: making one costs more than all the rest of reading a time. */
const formats = new Map<string, Intl.DateTimeFormat | null>();
/** A formatter for a zone this runtime knows by that name (the IANA names), or null. */
function formatIn(zone: string): Intl.DateTimeFormat | null {
  const made = formats.get(zone);
  if (made !== undefined) return made;
  let format: Intl.DateTimeFormat | null;
  try {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    format = null;
  }
  // The names come from calendars, so only so many are kept.
  if (formats.size >= 200) formats.clear();
  formats.set(zone, format);
  return format;
}

/** How far ahead of UTC a named zone's clocks are at an instant, in milliseconds. */
function offsetIn(format: Intl.DateTimeFormat, ms: number): number {
  const parts = Object.fromEntries(format.formatToParts(ms).map((part) => [part.type, part.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(ms / 1000) * 1000;
}

const isUtc = (t: Time) => t.zone === ICAL.Timezone.utcTimezone || t.zone?.tzid === 'UTC';

/**
 * A wall-clock time as an instant. In UTC as written; in a zone this runtime knows by name, by
 * that zone's own rules, so a meeting at nine stays at nine across a change of clocks; in a zone
 * defined by the calendar object itself, by that definition. A time with no zone at all
 * ("floating") is read as UTC.
 */
function instantOf(t: Time, tzid?: string | null): number {
  const wall = wallOf(t);
  if (isUtc(t)) return wall;
  const name = tzid ?? (t as Time & { timezone?: string }).timezone;
  const format = name ? formatIn(name) : null;
  if (format) {
    const first = offsetIn(format, wall);
    return wall - offsetIn(format, wall - first);
  }
  if (t.zone && t.zone !== ICAL.Timezone.localTimezone) return t.toUnixTime() * 1000;
  return wall;
}

/** The value of a date or date-time property, with the zone it names. */
function timeOf(prop: Property | null): { time: Time; tzid: string | null } | null {
  const time = prop?.getFirstValue() as Time | undefined;
  if (!time || typeof time.year !== 'number') return null;
  return { time, tzid: (prop!.getParameter('tzid') as string | undefined) ?? null };
}

/** When an occurrence starts: its time as written, its zone, and its instant once known (never for an all-day one). */
interface Start {
  time: Time;
  tzid: string | null;
  at?: number;
}

/** One event as Koyomi keeps it, from the component that says what this occurrence is. */
interface Occurrence {
  id: string;
  title: string;
  status: 'confirmed' | 'tentative';
  updatedAt: string;
  timeZone: string | null;
  allDay: boolean;
  start: string;
  end: string;
}

/** What a component says of itself, apart from when. */
function about(component: Component, fetchedAt: string) {
  const title = String(component.getFirstPropertyValue('summary') ?? '').trim() || '(No title)';
  const status = String(component.getFirstPropertyValue('status') ?? '').toUpperCase();
  const modified = component.getFirstPropertyValue('last-modified') as Time | null;
  return {
    title,
    cancelled: status === 'CANCELLED',
    status: status === 'TENTATIVE' ? ('tentative' as const) : ('confirmed' as const),
    updatedAt: modified && typeof modified.year === 'number' ? new Date(instantOf(modified)).toISOString() : fetchedAt,
  };
}

/** How long an event lasts: in days for an all-day one, in milliseconds for a timed one. */
function lengthOf(component: Component, start: Start) {
  const end = timeOf(component.getFirstProperty('dtend'));
  const duration = component.getFirstPropertyValue('duration') as { toSeconds(): number } | null;
  if (start.time.isDate) {
    if (end?.time.isDate) return { days: Math.max(1, daysBetween(dayOf(start.time), dayOf(end.time))), ms: 0 };
    if (duration) return { days: Math.max(1, Math.ceil(duration.toSeconds() / 86400)), ms: 0 };
    return { days: 1, ms: 0 };
  }
  if (end && !end.time.isDate) return { days: 0, ms: Math.max(0, instantOf(end.time, end.tzid) - instantOf(start.time, start.tzid)) };
  if (duration) return { days: 0, ms: Math.max(0, duration.toSeconds() * 1000) };
  return { days: 0, ms: 0 };
}
type Length = ReturnType<typeof lengthOf>;
/** How long, as a clock reads it. */
const clockLength = (length: Length) => length.days * DAY_MS || length.ms;

/** The name an occurrence is matched by: its start as an instant, or as a day (`at` null) for an all-day series. */
const keyOf = (t: Time, at: number | null) => (at === null ? dayOf(t).replace(/-/g, '') : new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, ''));
const occurrenceKey = (t: Time, tzid: string | null, allDay: boolean) => keyOf(t, allDay || t.isDate ? null : instantOf(t, tzid));

/** Rules that repeat every second or minute are not calendar events: they are shown once, at their start. */
const STEPPED = new Set(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const LONGEST = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Whether a rule's months and days of the month can ever meet: never on the 30th of February. */
function possible(rule: Recur) {
  const parts = rule.parts as Record<string, number[] | undefined>;
  const days = parts.BYMONTHDAY ?? [];
  if (!days.length) return true;
  const months = parts.BYMONTH?.length ? parts.BYMONTH : LONGEST.map((_, i) => i + 1);
  return months.some((month) => days.some((day) => day !== 0 && Math.abs(day) <= (LONGEST[month - 1] ?? 0)));
}

/**
 * Where to step a rule from: its own start, or, for one that repeats every so many days or weeks
 * with nothing counted from its start, the last start of one of its periods before `earliest`. Its
 * occurrences from there are the same, and years of a daily series are not walked day by day. The
 * time stepped from is itself well before the span, so whether it is one of them does not matter.
 */
function fromNear(rule: Recur, start: Time, earliest: number): Time {
  if (rule.count || (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY')) return start;
  const parts = rule.parts as Record<string, unknown[] | undefined>;
  if (['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND'].some((part) => parts[part]?.length)) return start;
  const period = (rule.freq === 'WEEKLY' ? 7 : 1) * Math.max(1, rule.interval || 1);
  const behind = Math.floor((earliest - wallOf(start)) / (period * DAY_MS));
  if (behind <= 0) return start;
  const moved = start.clone();
  moved.adjust(behind * period, 0, 0, 0);
  return moved;
}

/** Stepping stopped: past the span, out of tries, or out of time. */
class Stop extends Error {}

/**
 * Counts a rule's tries (see MAX_TRIES), and stops it once a try is past the span or the reading
 * is out of time. False if this ical.js cannot be counted: the rule is then not stepped at all.
 */
function bounded(steps: Steps, pastWall: number, late: () => boolean): boolean {
  const check = steps.check_contracting_rules;
  if (typeof check !== 'function') return false;
  let tries = MAX_TRIES;
  steps.check_contracting_rules = function (this: Steps) {
    if (--tries < 0 || wallOf(this.last) > pastWall || late()) throw new Stop();
    return check.call(this);
  };
  return true;
}

/**
 * Every occurrence of the events in one calendar object that touches the span. Throws if the
 * text is not iCalendar; an object with nothing in the span gives nothing. Once the reading's
 * budget is spent, what is left of the object is not worked out, and the budget says so.
 */
export function occurrencesOf(text: string, reading: Reading): ExternalEvent[] {
  const began = performance.now();
  const budget = reading.budget ?? budgetOf();
  const late = () => budget.ranOut || (performance.now() - began > budget.left && (budget.ranOut = true));
  try {
    return occurrences(text, reading, late);
  } finally {
    budget.left -= performance.now() - began;
  }
}

function occurrences(text: string, reading: Reading, late: () => boolean): ExternalEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  const from = Date.parse(reading.timeMin);
  const to = Date.parse(reading.timeMax);
  // A day either side, for all-day events: which day it is depends on the device, which trims.
  const fromDay = isoDay(from - DAY_MS);
  const toDay = isoDay(to + DAY_MS);
  /** Whether something starting at this clock reading, lasting this long, may touch the span. */
  const near = (wall: number, length: number) => wall + length >= from - NEAR_MS && wall <= to + NEAR_MS;
  // ical.js is given an end of its own, past the span, so that a rule that never happens is not
  // looked for year after year; each rule's own UNTIL is compared here, as an instant.
  const pastSpan = ICAL.Time.fromData({ year: new Date(to).getUTCFullYear() + 2, month: 1, day: 1, hour: 0, minute: 0, second: 0, isDate: false });

  const masters = new Map<string, Component>();
  const overrides = new Map<string, Component[]>();
  for (const event of root.getAllSubcomponents('vevent')) {
    const uid = String(event.getFirstPropertyValue('uid') ?? '').trim();
    if (!uid) continue;
    if (event.getFirstProperty('recurrence-id')) overrides.set(uid, [...(overrides.get(uid) ?? []), event]);
    else if (!masters.has(uid)) masters.set(uid, event);
  }

  const out: Occurrence[] = [];
  const keep = (occurrence: Occurrence) => {
    if (occurrence.allDay ? occurrence.end >= fromDay && occurrence.start <= toDay : Date.parse(occurrence.end) > from && Date.parse(occurrence.start) < to) out.push(occurrence);
    // An event with no length at all still counts at its moment.
    else if (!occurrence.allDay && occurrence.start === occurrence.end && Date.parse(occurrence.start) >= from && Date.parse(occurrence.start) < to) out.push(occurrence);
  };
  /** One occurrence, as a component said of itself, starting at `start`. */
  const occurrence = (said: ReturnType<typeof about>, id: string, start: Start, length: Length): Occurrence | null => {
    if (said.cancelled) return null;
    const base = { id, title: said.title, status: said.status, updatedAt: said.updatedAt, timeZone: start.tzid };
    if (start.time.isDate) {
      const first = dayOf(start.time);
      return { ...base, allDay: true, start: first, end: addDays(first, Math.max(1, length.days) - 1) };
    }
    const at = start.at ?? instantOf(start.time, start.tzid);
    return { ...base, allDay: false, start: new Date(at).toISOString(), end: new Date(at + length.ms).toISOString() };
  };

  for (const [uid, master] of masters) {
    if (late()) break;
    const start = timeOf(master.getFirstProperty('dtstart'));
    if (!start) continue;
    const rules = master.getAllProperties('rrule').map((prop) => prop.getFirstValue() as Recur);
    const rdates = master.getAllProperties('rdate');
    const repeating = rules.length > 0 || rdates.length > 0;
    if (reading.repeatingOnly && !repeating) continue;
    const said = about(master, reading.fetchedAt);
    if (said.cancelled) continue;
    const length = lengthOf(master, start);
    const allDay = start.time.isDate;
    const lasts = clockLength(length);

    if (!repeating) {
      const one = occurrence(said, uid, start, length);
      if (one) keep(one);
      continue;
    }
    /** How long an exception lasts: as it says, or, if it does not say, as the series does. */
    const lengthFor = (exception: Component, its: Start) => (exception.getFirstProperty('dtend') || exception.getFirstProperty('duration') ? lengthOf(exception, its) : length);

    // Exceptions, by the occurrence they stand in for. One nowhere near the span, either where
    // its occurrence was or where it is now, cannot be shown.
    const moved = new Map<string, Component>();
    for (const exception of overrides.get(uid) ?? []) {
      if (late()) break;
      const id = timeOf(exception.getFirstProperty('recurrence-id'));
      if (!id) continue;
      const its = timeOf(exception.getFirstProperty('dtstart'));
      if (!near(wallOf(id.time), lasts) && !(its && near(wallOf(its.time), clockLength(lengthFor(exception, its))))) continue;
      moved.set(occurrenceKey(id.time, id.tzid ?? start.tzid, allDay), exception);
    }
    // Excluded occurrences near the span, as instants or as days, however each EXDATE is written.
    const excluded = new Set<string>();
    const excludedDays = new Set<string>();
    for (const prop of master.getAllProperties('exdate')) {
      const tzid = (prop.getParameter('tzid') as string | undefined) ?? start.tzid;
      for (const value of prop.getValues() as Time[]) {
        if (late()) break;
        if (typeof value?.year !== 'number' || !near(wallOf(value), lasts)) continue;
        if (value.isDate) excludedDays.add(dayOf(value));
        excluded.add(occurrenceKey(value, tzid, allDay));
      }
    }

    // The start of each occurrence that may touch the span: DTSTART itself, each rule's, and each
    // RDATE. Those long before it are passed over: an exception that was one of them and has been
    // moved into the span is found by the exception itself, below.
    const starts = new Map<string, Start>();
    // Each one is kept as a copy: the rule hands back the same time, changed, at every step.
    const add = (time: Time, tzid: string | null) => {
      if (!near(wallOf(time), lasts)) return;
      const at = allDay || time.isDate ? null : instantOf(time, tzid);
      const key = keyOf(time, at);
      if (!starts.has(key)) starts.set(key, { time: time.clone(), tzid, ...(at === null ? {} : { at }) });
    };
    add(start.time, start.tzid);
    for (const rule of rules) {
      if (late()) break;
      if (!STEPPED.has(rule.freq) || !possible(rule)) continue;
      // UNTIL is compared as an instant (or a day), whatever zone it and the start are written in.
      const until = rule.until as Time | null;
      const untilDay = until && (allDay || until.isDate) ? dayOf(until) : null;
      const untilAt = until && untilDay === null ? instantOf(until, isUtc(until) ? null : start.tzid) : null;
      if (until && wallOf(until) + lasts + NEAR_MS < from) continue;
      const ended = (next: Time) => {
        if (untilDay !== null) return dayOf(next) > untilDay;
        if (untilAt === null) return false;
        const wall = wallOf(next);
        return wall - DAY_MS > untilAt || (wall + DAY_MS > untilAt && instantOf(next, start.tzid) > untilAt);
      };
      const stepper = rule.clone();
      stepper.until = pastSpan;
      try {
        const steps = stepper.iterator(fromNear(rule, start.time, from - lasts - NEAR_MS - DAY_MS));
        if (!bounded(steps, to + NEAR_MS, late)) continue;
        for (let i = 0; i < MAX_STEPS; i++) {
          const next = steps.next() as Time | null;
          if (!next || wallOf(next) > to + NEAR_MS || ended(next)) break;
          add(next, start.tzid);
        }
      } catch {
        // Past the span, out of tries or time, or a rule ical.js cannot step through: the series
        // is what it came to so far.
      }
    }
    for (const prop of rdates) {
      const tzid = (prop.getParameter('tzid') as string | undefined) ?? start.tzid;
      for (const value of prop.getValues() as (Time | { start: Time })[]) {
        if (late()) break;
        const time = 'start' in value && value.start ? value.start : (value as Time);
        if (typeof time.year === 'number') add(time, tzid);
      }
    }

    for (const [key, at] of starts) {
      if (excluded.has(key) || (excludedDays.has(dayOf(at.time)) && !allDay)) continue;
      const id = `${uid}::${key}`;
      const exception = moved.get(key);
      moved.delete(key);
      if (exception) {
        const its = timeOf(exception.getFirstProperty('dtstart')) ?? at;
        const one = occurrence(about(exception, reading.fetchedAt), id, its, lengthFor(exception, its));
        if (one) keep(one);
        continue;
      }
      const one = occurrence(said, id, at, length);
      if (one) keep(one);
    }
    // Exceptions whose own occurrence was not stepped to (moved here from long before the span or
    // beyond it, or not on the rule at all): they are events all the same.
    for (const [key, exception] of moved) {
      const its = timeOf(exception.getFirstProperty('dtstart'));
      if (!its) continue;
      const one = occurrence(about(exception, reading.fetchedAt), `${uid}::${key}`, its, lengthFor(exception, its));
      if (one) keep(one);
    }
  }

  // An exception sent without its series (an invitation to one occurrence): an event by itself.
  if (!reading.repeatingOnly) {
    for (const [uid, exceptions] of overrides) {
      if (masters.has(uid)) continue;
      for (const exception of exceptions) {
        if (late()) break;
        const id = timeOf(exception.getFirstProperty('recurrence-id'));
        const its = timeOf(exception.getFirstProperty('dtstart'));
        if (!id || !its) continue;
        const length = lengthOf(exception, its);
        if (!near(wallOf(its.time), clockLength(length))) continue;
        const one = occurrence(about(exception, reading.fetchedAt), `${uid}::${occurrenceKey(id.time, id.tzid, its.time.isDate)}`, its, length);
        if (one) keep(one);
      }
    }
  }

  return out.map((o) => ({
    id: eventKey(reading.connectionId, reading.calendarId, o.id),
    connectionId: reading.connectionId,
    provider: 'yahoo' as const,
    providerEventId: o.id,
    calendarId: reading.calendarId,
    title: o.title,
    start: o.start,
    end: o.allDay ? (o.end < o.start ? o.start : o.end) : o.end,
    allDay: o.allDay,
    timeZone: o.timeZone,
    status: o.status,
    link: null,
    updatedAt: o.updatedAt,
    fetchedAt: reading.fetchedAt,
  }));
}
