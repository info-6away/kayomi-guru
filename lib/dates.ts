// Calendar days are 'YYYY-MM-DD' keys in the device's local time zone.
// Times of day are minutes from local midnight (0–1440).

export const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DAY_MIN = 1440;

export const pad = (n: number) => String(n).padStart(2, '0');
export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export const makeKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const dayKey = (d: Date) => makeKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
export const parts = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
};

// Day arithmetic runs in UTC so a daylight-saving change can never shift a date.
const utc = (key: string) => {
  const { y, m, d } = parts(key);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (key: string, n: number) => new Date(utc(key) + n * 864e5).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((utc(a) - utc(b)) / 864e5);
export const weekday = (key: string) => new Date(utc(key)).getUTCDay();
export const mondayOf = (key: string) => addDays(key, -((weekday(key) + 6) % 7));
/** `m` is 1-based. */
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The Monday-first grid that shows a day's month: its first cell and its number of week rows. */
export function monthGrid(key: string) {
  const { y, m } = parts(key);
  const first = makeKey(y, m, 1);
  const lead = (weekday(first) + 6) % 7;
  return { start: addDays(first, -lead), rows: Math.ceil((lead + daysInMonth(y, m)) / 7) };
}

/** The first day of the month `n` months away. */
export function addMonths(key: string, n: number) {
  const { y, m } = parts(key);
  const months = y * 12 + (m - 1) + n;
  return makeKey(Math.floor(months / 12), (months % 12) + 1, 1);
}

/** The instant of a local wall-clock minute on a day. */
export const toInstant = (key: string, min: number) => {
  const { y, m, d } = parts(key);
  return new Date(y, m - 1, d, 0, min).toISOString();
};

export interface Span {
  date: string;
  start: number;
  end: number;
}

/** Where a stored event sits on the local calendar. Events are kept within one day. */
export function spanOf(ev: { start: string; end: string; allDay?: boolean }): Span {
  // An all-day event is stored as its day, and covers all of it.
  if (ev.allDay) return { date: ev.start, start: 0, end: DAY_MIN };
  const s = new Date(ev.start);
  const start = s.getHours() * 60 + s.getMinutes();
  const minutes = Math.round((Date.parse(ev.end) - s.getTime()) / 60000);
  return { date: dayKey(s), start, end: Math.min(DAY_MIN, start + Math.max(15, minutes)) };
}

export const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Reads a typed time: "9", "930", "9:30", "09.30", "1430". */
export function parseTime(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2})(?:[:.\s]?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
