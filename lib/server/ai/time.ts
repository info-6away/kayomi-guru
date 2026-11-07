// Time in a named zone, for the AI tools (docs/MCP.md). Every answer is given in one IANA zone,
// stated in the answer; nothing here depends on where the server runs.

/** Whether a value is an IANA time zone this runtime knows. */
export function isZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(zone, f);
  }
  return f;
}

/** The wall-clock reading of an instant in a zone. */
export function wall(ms: number, zone: string) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), mi: Number(parts.minute), s: Number(parts.second) };
}

/** Minutes the zone is ahead of UTC at that instant. */
export function offsetMinutes(ms: number, zone: string): number {
  const w = wall(ms, zone);
  return Math.round((Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * The instant a wall-clock time names in a zone. A time skipped by a clock change (02:30 when
 * clocks jump from 02:00 to 03:00) comes out as the instant the clock read it would have: later.
 */
export function instantOf(y: number, m: number, d: number, h: number, mi: number, zone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = offsetMinutes(guess, zone);
  let at = guess - first * 60000;
  const second = offsetMinutes(at, zone);
  if (second !== first) at = guess - second * 60000;
  return at;
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

/** A calendar day, 'YYYY-MM-DD', in a zone. */
export function localDay(ms: number, zone: string): string {
  const w = wall(ms, zone);
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
}

/** An instant written in a zone, with its offset: '2026-11-10T09:00:00+04:00'. */
export function localIso(ms: number, zone: string): string {
  const w = wall(ms, zone);
  const off = offsetMinutes(ms, zone);
  const sign = off < 0 ? '-' : '+';
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** The day after (or before) a calendar day. */
export const addDays = (day: string, n: number) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n)).toISOString().slice(0, 10);

/** The instant a calendar day begins in a zone. */
export const dayStart = (day: string, zone: string) => instantOf(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), 0, 0, zone);

/** 0 for Sunday … 6 for Saturday. */
export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

/** Whether y-m-d is a real date. */
const realDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** Whether a value is a calendar day, 'YYYY-MM-DD', that exists. */
export const isDay = (value: unknown): value is string => {
  const m = typeof value === 'string' ? DAY.exec(value) : null;
  return !!m && realDay(Number(m[1]), Number(m[2]), Number(m[3]));
};

/**
 * An instant from what a person or an assistant writes, read in `zone` unless it carries its own
 * offset. A day alone is the day's beginning; as the end of a range (`asEnd`) it is the day's end,
 * so "from Monday to Wednesday" includes Wednesday.
 */
export function parseMoment(value: unknown, zone: string, asEnd = false): number | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  if (isDay(value)) return dayStart(asEnd ? addDays(value, 1) : value, zone);
  const m = MOMENT.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0));
  if (!realDay(y, mo, d) || h > 23 || mi > 59 || s > 59) return null;
  if (m[7]) {
    const at = Date.parse(value);
    return Number.isNaN(at) ? null : at;
  }
  return instantOf(y, mo, d, h, mi, zone) + s * 1000;
}

/** Whether a value is a time of day, 'HH:MM', from 00:00 to 24:00. */
export const isClock = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value);
export const clockMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
