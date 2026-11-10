import 'server-only';
import { createHmac } from 'node:crypto';
import type { CalendarInfo, CalendarResult, ExternalEvent, Provider } from '../../calendars/types';
import { inTurn, once, reading, type Ctx } from '../api';
import type { Connection } from '../connections';
import { fingerprint } from '../seal';
import { keyFor, type AiConfig } from './config';
import type { Grant } from './store';

// What an AI grant may read, read on demand through the production readers (google.ts,
// microsoft.ts, yahoo.ts, link.ts) by way of `reading()`, with every allowance and protection
// they already have. Nothing is written down: a listing or a reading is kept in this server's
// memory for a minute so that an assistant asking the same thing again does not ask the provider
// again, and is then forgotten.

export interface Source {
  /** Opaque, per grant: what the assistant names this calendar by. */
  handle: string;
  name: string;
  provider: Provider;
  primary: boolean;
  connectionId: string;
  /** The account (or link) the connection was for when access was checked: it is read only while it still is. */
  accountKey: string;
  calendarId: string;
}

/**
 * Why a calendar is in `unavailable` (not read at all), or, for `too_many_events`, in
 * `partly_read`: it was read, but stopped before the end of the span, so what is missing is not known.
 */
export type Reason = 'needs_reconnecting' | 'temporarily_unavailable' | 'rate_limited' | 'blocked' | 'too_many_events';

export interface Unavailable {
  calendar: string;
  name: string | null;
  provider: Provider;
  reason: Reason;
}

export interface Authorized {
  sources: Source[];
  unavailable: Unavailable[];
  /** Calendars authorized once that the provider no longer has. They have no events to miss. */
  removed: number;
}

/**
 * A calendar's keyed hash, as a grant stores it: tied to its connection AND to the account it is
 * for. A connection can be pointed at another account while keeping its id ("Update link" gives a
 * calendar link a new address; every link's one calendar has the same id), and what the person
 * allowed was that account's calendar, not whatever the connection holds later. So after such a
 * change the grant no longer matches it, and the assistant reads nothing of the new one until the
 * person allows it. (Vercel Security Review finding 01M6V1S28.)
 */
export const calendarFingerprint = (config: AiConfig, connection: Pick<Connection, 'id' | 'accountKey'>, calendarId: string) =>
  fingerprint(calendarId, config.connections.tokenKey, `ai-calendar:${connection.id}:${connection.accountKey}`);

/** What the assistant calls a calendar: the same in every call of one grant, different in another grant. */
export const handleFor = (config: AiConfig, grantId: string, connectionId: string, print: string) =>
  `cal_${createHmac('sha256', keyFor(config, 'handle')).update(`${grantId}\n${connectionId}\n${print}`).digest('base64url').slice(0, 16)}`;

const KEEP_MS = 60_000;
const shared = globalThis as typeof globalThis & { koyomiAiKept?: Map<string, { until: number; value: unknown }> };
const kept = () => (shared.koyomiAiKept ??= new Map());

/** `work` once for everyone asking the same at the same moment, and its answer for a minute after. Failures are not kept. */
async function remembered<T>(key: string, work: () => Promise<{ keep: boolean; value: T }>): Promise<T> {
  const cache = kept();
  const held = cache.get(key);
  if (held && held.until > Date.now()) return held.value as T;
  const got = await once(`ai:${key}`, work);
  if (got.keep) {
    if (cache.size > 300) for (const [k, v] of cache) if (v.until <= Date.now() || cache.size > 300) cache.delete(k);
    cache.set(key, { until: Date.now() + KEEP_MS, value: got.value });
  }
  return got.value;
}

const reasonOf = (error: string): Reason | 'gone' =>
  error === 'reconnect' ? 'needs_reconnecting' : error === 'blocked' ? 'blocked' : error === 'slow_down' ? 'rate_limited' : error === 'not_connected' ? 'gone' : 'temporarily_unavailable';

type Listed = { ok: true; calendars: CalendarInfo[] } | { ok: false; reason: Reason | 'gone' };

function listCalendars(ctx: Ctx, connection: Connection, deadline: AbortSignal): Promise<Listed> {
  return remembered(`${ctx.subject}:${connection.id}:${connection.accountKey}:list`, async () => {
    if (connection.status === 'reconnect') return { keep: false, value: { ok: false, reason: 'needs_reconnecting' } as Listed };
    const read = await reading(ctx, connection.id, 1, (token, provider) => provider.listCalendars(token, deadline), connection.accountKey);
    if ('error' in read) return { keep: false, value: { ok: false, reason: reasonOf(read.error) } as Listed };
    return { keep: true, value: { ok: true, calendars: read.data.calendars } as Listed };
  });
}

/**
 * The calendars this grant may read, as they are now: each authorized calendar the provider still
 * has, by name; each one that cannot be checked just now, and why; and how many the provider no
 * longer has. A calendar the person has not authorized is never listed, however it is shown in Koyomi.
 */
export async function authorizedCalendars(config: AiConfig, ctx: Ctx, grant: Grant, deadline: AbortSignal): Promise<Authorized> {
  const connections = new Map((await ctx.store.list(ctx.subject)).map((c) => [c.id, c]));
  const byConnection = new Map<string, Set<string>>();
  // A connection the person has since disconnected is simply not there: its calendars are not
  // this grant's any more (the database removes them; this says so again).
  for (const each of grant.calendars) {
    if (!connections.has(each.connectionId)) continue;
    const set = byConnection.get(each.connectionId) ?? new Set();
    set.add(each.fingerprint);
    byConnection.set(each.connectionId, set);
  }
  const out: Authorized = { sources: [], unavailable: [], removed: 0 };
  await inTurn([...byConnection], 5, async ([connectionId, prints]) => {
    const connection = connections.get(connectionId)!;
    const listed = await listCalendars(ctx, connection, deadline);
    if (!listed.ok) {
      if (listed.reason === 'gone') return;
      for (const print of prints) out.unavailable.push({ calendar: handleFor(config, grant.id, connectionId, print), name: null, provider: connection.provider, reason: listed.reason });
      return;
    }
    const found = new Set<string>();
    for (const calendar of listed.calendars) {
      const print = calendarFingerprint(config, connection, calendar.calendarId);
      if (!prints.has(print)) continue;
      found.add(print);
      out.sources.push({ handle: handleFor(config, grant.id, connectionId, print), name: calendar.name, provider: connection.provider, primary: calendar.primary, connectionId, accountKey: connection.accountKey, calendarId: calendar.calendarId });
    }
    out.removed += [...prints].filter((print) => !found.has(print)).length;
  });
  return out;
}

export interface SourceEvent {
  source: Source;
  event: ExternalEvent;
}

/**
 * Every event of these calendars within the span, read whole (not "what changed since"), the
 * calendars that could not be read just now, and those whose reading stopped before the end of
 * the span (`partly`). One calendar failing is said of that calendar alone.
 */
export async function readEvents(
  ctx: Ctx,
  sources: Source[],
  span: { timeMin: string; timeMax: string },
  deadline: AbortSignal,
): Promise<{ events: SourceEvent[]; unavailable: Unavailable[]; partly: Unavailable[]; removed: number }> {
  const events: SourceEvent[] = [];
  const unavailable: Unavailable[] = [];
  const partly: Unavailable[] = [];
  let removed = 0;
  await inTurn(sources, 4, async (source) => {
    type Got = { failed: Reason | 'gone' } | { events: ExternalEvent[]; cut: boolean };
    const result = await remembered<Got>(`${ctx.subject}:${source.connectionId}:${source.accountKey}:${source.calendarId}:${span.timeMin}:${span.timeMax}`, async () => {
      // Read only if the connection is still for the account access was checked against.
      const read = await reading(
        ctx,
        source.connectionId,
        1,
        (token, provider) => provider.readCalendar(token, { connectionId: source.connectionId, calendarId: source.calendarId, syncToken: null, span, fetchedAt: new Date().toISOString() }, deadline),
        source.accountKey,
      );
      if ('error' in read) return { keep: false, value: { failed: reasonOf(read.error) } };
      const calendar: CalendarResult = read.data;
      if ('gone' in calendar) return { keep: false, value: { failed: 'gone' as const } };
      if ('failed' in calendar) return { keep: false, value: { failed: 'temporarily_unavailable' as const } };
      return { keep: true, value: { events: calendar.events, cut: calendar.cut === true } };
    });
    if ('failed' in result) {
      if (result.failed === 'gone') removed++;
      else unavailable.push({ calendar: source.handle, name: source.name, provider: source.provider, reason: result.failed });
      return;
    }
    if (result.cut) partly.push({ calendar: source.handle, name: source.name, provider: source.provider, reason: 'too_many_events' });
    for (const event of result.events) events.push({ source, event });
  });
  return { events, unavailable, partly, removed };
}
