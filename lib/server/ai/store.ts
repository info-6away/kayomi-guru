import { randomUUID } from 'node:crypto';
import type { Allowance, Sql } from '../connections';
import { isConnectionId } from '../connections';
import { REFRESH_GRACE_REUSES, REFRESH_GRACE_SECONDS } from './tokens';

// Where AI access is kept (migrations/004_ai_access.sql): clients that registered themselves,
// grants (a person allowing one client to read some calendars), each grant's calendars, and the
// OAuth codes and refresh tokens issued for grants, as keyed hashes only.

export interface AiClient {
  clientId: string;
  redirectUris: string[];
  /** What the client called itself. Display only, and never trusted. */
  clientName: string | null;
}

/** One calendar a grant may read: a connection, and a keyed hash of the calendar's id at the provider. */
export interface GrantCalendar {
  connectionId: string;
  fingerprint: string;
}

export interface Grant {
  id: string;
  subject: string;
  clientId: string;
  clientLabel: string;
  redirectHost: string;
  timeZone: string;
  createdAt: string;
  lastUsedAt: string | null;
  calendars: GrantCalendar[];
}

export interface CodeRecord {
  grantId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  expiresAt: number;
}

/** What taking a code found: the record, and whether it had been taken before. */
export type Taken<T> = { record: T; replay: boolean } | null;

/**
 * What taking a refresh token found: its first use (`fresh`), a use again within the grace after
 * that (`grace`), or a use after the grace or beyond its count (`replay`), which ends the grant.
 */
export type TakenRefresh = { kind: 'fresh' | 'grace' | 'replay'; record: { grantId: string; expiresAt: number } } | null;

/**
 * How long a self-registered client's record is kept with nothing of it in use (docs/MCP.md):
 * one that never started an authorization is removed a week after it registered, and one that did
 * is removed ninety days after it last did. Never while a grant or a code names it, so no
 * person's access ever ends because its client's record was tidied away. Clients known by a
 * metadata document have no record to remove.
 */
export const CLIENT_RETENTION = { unusedDays: 7, idleDays: 90 };
/** How often a client's last use is written down: at most once an hour. */
const TOUCH_MS = 60 * 60 * 1000;
/** How many records one tidying removes at most. */
const PRUNE_BATCH = 200;

export interface AiStore {
  saveClient(client: AiClient, now?: number): Promise<void>;
  getClient(clientId: string): Promise<AiClient | null>;
  /** Notes that a self-registered client has started an authorization (at most once an hour). */
  touchClient(clientId: string, now?: number): Promise<void>;
  /** Removes self-registered clients past CLIENT_RETENTION that no grant or code names. Returns how many. */
  pruneClients(now?: number): Promise<number>;
  /**
   * Records that `subject` allowed `clientId` to read `calendars`, ending any grant the same person
   * gave the same client before. Only the person's own connections can be named: any other is
   * left out by the store itself.
   */
  createGrant(grant: Omit<Grant, 'id' | 'createdAt' | 'lastUsedAt'>): Promise<string>;
  /** A grant in force, with its calendars whose connections still exist. */
  getGrant(grantId: string): Promise<Grant | null>;
  /** This person's grants, oldest first. */
  listGrants(subject: string): Promise<Grant[]>;
  /** Ends a grant, deleting it and everything under it. With `subject`, only that person's. True if there was one. */
  revokeGrant(grantId: string, subject?: string): Promise<boolean>;
  /**
   * Takes one of this person's connections out of every grant of theirs: it is now for another
   * account (a calendar link given a new address). What was allowed was the old account's
   * calendar; nothing of the new one is, until the person allows it. (The grant's fingerprints
   * no longer match it anyway; this keeps Calendars from counting it as still allowed.)
   */
  forgetConnection(subject: string, connectionId: string): Promise<void>;
  /** Counts one tool call against the grant's allowance, and notes when it was last used. */
  spendGrant(grantId: string, cost: number, allowance: Allowance): Promise<{ allowed: boolean; retryAfter: number } | null>;
  saveCode(hash: string, code: CodeRecord): Promise<void>;
  /** Marks a code used. `replay` is true when it had been used before. */
  takeCode(hash: string): Promise<Taken<CodeRecord>>;
  /**
   * Keeps a refresh token. Keeping one that is already kept (the same successor, asked for again
   * within the grace) changes nothing and is true. False when its grant has ended meanwhile
   * (revoked by a request at the same moment).
   */
  saveRefresh(hash: string, grantId: string, expiresAt: number): Promise<boolean>;
  /**
   * Uses a refresh token: the first use marks it used at `now`; a use within REFRESH_GRACE_SECONDS
   * after that, up to REFRESH_GRACE_REUSES times, is `grace`; anything later is `replay`. Atomic:
   * of any number of uses at once, exactly one is `fresh`.
   */
  takeRefresh(hash: string, now?: number): Promise<TakenRefresh>;
  /** The grant a refresh token belongs to, used or not, without using it. */
  refreshGrant(hash: string): Promise<string | null>;
}

const CEILING = 1_000_000;
const UUID = isConnectionId;

const iso = (value: unknown) => (value == null ? null : new Date(value as string).toISOString());
const grantOf = (row: Record<string, unknown>, calendars: GrantCalendar[]): Grant => ({
  id: String(row.grant_id),
  subject: String(row.auth_subject),
  clientId: String(row.client_id),
  clientLabel: String(row.client_label),
  redirectHost: String(row.redirect_host),
  timeZone: String(row.time_zone),
  createdAt: iso(row.created_at)!,
  lastUsedAt: iso(row.last_used_at),
  calendars,
});

export function sqlAiStore(sql: Sql): AiStore {
  const calendarsOf = async (grantIds: string[]) => {
    if (!grantIds.length) return new Map<string, GrantCalendar[]>();
    // Only calendars whose connection still belongs to the grant's person (a cascade removes the
    // rest, and this says so again).
    const rows = await sql`
      select gc.grant_id, gc.connection_id, gc.calendar_fingerprint from ai_grant_calendars gc
      join ai_grants g on g.grant_id = gc.grant_id
      join calendar_connections c on c.connection_id = gc.connection_id and c.auth_subject = g.auth_subject
      where gc.grant_id = any(${grantIds}::uuid[])
      order by gc.created_at, gc.connection_id, gc.calendar_fingerprint`;
    const out = new Map<string, GrantCalendar[]>();
    for (const row of rows) {
      const list = out.get(String(row.grant_id)) ?? [];
      list.push({ connectionId: String(row.connection_id), fingerprint: String(row.calendar_fingerprint) });
      out.set(String(row.grant_id), list);
    }
    return out;
  };

  return {
    async saveClient(client, now = Date.now()) {
      await sql`
        insert into ai_clients (client_id, redirect_uris, client_name, created_at)
        values (${client.clientId}, ${client.redirectUris}::text[], ${client.clientName}, ${new Date(now).toISOString()})`;
    },
    async getClient(clientId) {
      const [row] = await sql`select client_id, redirect_uris, client_name from ai_clients where client_id = ${clientId}`;
      return row ? { clientId: String(row.client_id), redirectUris: (row.redirect_uris as string[]).map(String), clientName: row.client_name == null ? null : String(row.client_name) } : null;
    },
    async touchClient(clientId, now = Date.now()) {
      await sql`
        update ai_clients set last_used_at = ${new Date(now).toISOString()}
        where client_id = ${clientId} and (last_used_at is null or last_used_at < ${new Date(now - TOUCH_MS).toISOString()})`;
    },
    async pruneClients(now = Date.now()) {
      const unused = new Date(now - CLIENT_RETENTION.unusedDays * 864e5).toISOString();
      const idle = new Date(now - CLIENT_RETENTION.idleDays * 864e5).toISOString();
      // One statement: a client is removed only if, at that moment, no grant and no code names it.
      const rows = await sql`
        delete from ai_clients where client_id in (
          select c.client_id from ai_clients c
          where ((c.last_used_at is null and c.created_at < ${unused}) or c.last_used_at < ${idle})
            and not exists (select 1 from ai_grants g where g.client_id = c.client_id)
            and not exists (select 1 from ai_codes k where k.client_id = c.client_id)
          limit ${PRUNE_BATCH})
        returning client_id`;
      return rows.length;
    },
    async createGrant(grant) {
      await sql`delete from ai_grants where auth_subject = ${grant.subject} and client_id = ${grant.clientId}`;
      // Calendars of connections that have since been disconnected: no grant reads them, and they go.
      await sql`delete from ai_grant_calendars gc where not exists (select 1 from calendar_connections c where c.connection_id = gc.connection_id)`;
      const [row] = await sql`
        insert into ai_grants (auth_subject, client_id, client_label, redirect_host, time_zone)
        values (${grant.subject}, ${grant.clientId}, ${grant.clientLabel}, ${grant.redirectHost}, ${grant.timeZone})
        returning grant_id`;
      const id = String(row.grant_id);
      const connections = grant.calendars.map((c) => c.connectionId).filter(UUID);
      const prints = grant.calendars.filter((c) => UUID(c.connectionId)).map((c) => c.fingerprint);
      if (connections.length) {
        // The join keeps out any connection that is not this person's.
        await sql`
          insert into ai_grant_calendars (grant_id, connection_id, calendar_fingerprint)
          select ${id}::uuid, c.connection_id, c.fingerprint
          from unnest(${connections}::uuid[], ${prints}::text[]) as c(connection_id, fingerprint)
          join calendar_connections cc on cc.connection_id = c.connection_id and cc.auth_subject = ${grant.subject}
          on conflict do nothing`;
      }
      return id;
    },
    async getGrant(grantId) {
      if (!UUID(grantId)) return null;
      const [row] = await sql`
        select grant_id, auth_subject, client_id, client_label, redirect_host, time_zone, created_at, last_used_at from ai_grants
        where grant_id = ${grantId}`;
      if (!row) return null;
      return grantOf(row, (await calendarsOf([grantId])).get(grantId) ?? []);
    },
    async listGrants(subject) {
      const rows = await sql`
        select grant_id, auth_subject, client_id, client_label, redirect_host, time_zone, created_at, last_used_at from ai_grants
        where auth_subject = ${subject}
        order by created_at, grant_id`;
      const calendars = await calendarsOf(rows.map((row) => String(row.grant_id)));
      return rows.map((row) => grantOf(row, calendars.get(String(row.grant_id)) ?? []));
    },
    async revokeGrant(grantId, subject) {
      if (!UUID(grantId)) return false;
      // Deleted, and with it its calendars, codes and refresh tokens (on delete cascade).
      const rows = subject === undefined
        ? await sql`delete from ai_grants where grant_id = ${grantId} returning grant_id`
        : await sql`delete from ai_grants where grant_id = ${grantId} and auth_subject = ${subject} returning grant_id`;
      return rows.length > 0;
    },
    async forgetConnection(subject, connectionId) {
      if (!UUID(connectionId)) return;
      await sql`
        delete from ai_grant_calendars gc using ai_grants g
        where gc.grant_id = g.grant_id and g.auth_subject = ${subject} and gc.connection_id = ${connectionId}::uuid`;
    },
    async spendGrant(grantId, cost, allowance) {
      if (!UUID(grantId)) return null;
      const [row] = await sql`
        update ai_grants set
          last_used_at = now(),
          window_started_at = case
            when window_started_at is null or window_started_at <= now() - make_interval(secs => ${allowance.seconds}::int) then now()
            else window_started_at end,
          window_spent = case
            when window_started_at is null or window_started_at <= now() - make_interval(secs => ${allowance.seconds}::int) then ${cost}::int
            else least(window_spent + ${cost}::int, ${CEILING}::int) end
        where grant_id = ${grantId}
        returning window_spent, ceil(extract(epoch from (window_started_at + make_interval(secs => ${allowance.seconds}::int) - now()))) as retry_after`;
      if (!row) return null;
      return { allowed: Number(row.window_spent) <= allowance.units, retryAfter: Math.max(1, Number(row.retry_after) || 1) };
    },
    async saveCode(hash, code) {
      // Codes live for minutes; whatever is days old is cleared on the way.
      await sql`delete from ai_codes where expires_at < now() - interval '1 day'`;
      await sql`
        insert into ai_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, expires_at)
        values (${hash}, ${code.grantId}, ${code.clientId}, ${code.redirectUri}, ${code.codeChallenge}, ${code.resource}, ${new Date(code.expiresAt).toISOString()})`;
    },
    async takeCode(hash) {
      const [fresh] = await sql`
        update ai_codes set used_at = now() where code_hash = ${hash} and used_at is null
        returning grant_id, client_id, redirect_uri, code_challenge, resource, expires_at`;
      const row = fresh ?? (await sql`select grant_id, client_id, redirect_uri, code_challenge, resource, expires_at from ai_codes where code_hash = ${hash}`)[0];
      if (!row) return null;
      return {
        replay: !fresh,
        record: {
          grantId: String(row.grant_id),
          clientId: String(row.client_id),
          redirectUri: String(row.redirect_uri),
          codeChallenge: String(row.code_challenge),
          resource: String(row.resource),
          expiresAt: new Date(row.expires_at as string).getTime(),
        },
      };
    },
    async saveRefresh(hash, grantId, expiresAt) {
      await sql`delete from ai_refresh_tokens where expires_at < now() - interval '1 day'`;
      try {
        // A successor saved again (a retry within the grace) is kept as it is: never a second row,
        // and never made unused again.
        const rows = await sql`
          insert into ai_refresh_tokens (token_hash, grant_id, expires_at)
          select ${hash}, ${grantId}::uuid, ${new Date(expiresAt).toISOString()}
          where exists (select 1 from ai_grants where grant_id = ${grantId}::uuid)
          on conflict (token_hash) do nothing
          returning token_hash`;
        if (rows.length > 0) return true;
        const [kept] = await sql`
          select 1 as kept from ai_refresh_tokens t join ai_grants g on g.grant_id = t.grant_id
          where t.token_hash = ${hash} and t.grant_id = ${grantId}::uuid`;
        return Boolean(kept);
      } catch (error) {
        // The grant was deleted between that check and this row: a foreign key violation.
        if ((error as { code?: unknown })?.code === '23503') return false;
        throw error;
      }
    },
    async takeRefresh(hash, now = Date.now()) {
      const record = (row: Record<string, unknown>) => ({ grantId: String(row.grant_id), expiresAt: new Date(row.expires_at as string).getTime() });
      // Each step is one statement that changes the row it reads, so two uses at once are told
      // apart by the database: one finds it unused, the next finds it used.
      const [fresh] = await sql`
        update ai_refresh_tokens set used_at = ${new Date(now).toISOString()}
        where token_hash = ${hash} and used_at is null
        returning grant_id, expires_at`;
      if (fresh) return { kind: 'fresh', record: record(fresh) };
      const [grace] = await sql`
        update ai_refresh_tokens set reuse_count = reuse_count + 1
        where token_hash = ${hash} and used_at is not null
          and used_at > ${new Date(now - REFRESH_GRACE_SECONDS * 1000).toISOString()}
          and reuse_count < ${REFRESH_GRACE_REUSES}
        returning grant_id, expires_at`;
      if (grace) return { kind: 'grace', record: record(grace) };
      const [spent] = await sql`select grant_id, expires_at from ai_refresh_tokens where token_hash = ${hash}`;
      return spent ? { kind: 'replay', record: record(spent) } : null;
    },
    async refreshGrant(hash) {
      const [row] = await sql`select grant_id from ai_refresh_tokens where token_hash = ${hash}`;
      return row ? String(row.grant_id) : null;
    },
  };
}

/**
 * The same store in memory, for the browser tests only. It cannot see calendar connections, so
 * a grant's calendars are checked against the person's connections where they are read.
 */
export function memoryAiStore(): AiStore {
  const clients = new Map<string, AiClient & { createdAt: number; lastUsedAt: number | null }>();
  const grants = new Map<string, Grant & { revoked: boolean; windowStart: number; spent: number }>();
  const codes = new Map<string, CodeRecord & { used: boolean }>();
  const refresh = new Map<string, { grantId: string; expiresAt: number; usedAt: number | null; reuses: number }>();
  const plain = ({ revoked: _r, windowStart: _w, spent: _s, ...grant }: Grant & { revoked: boolean; windowStart: number; spent: number }): Grant => ({ ...grant, calendars: [...grant.calendars] });
  return {
    async saveClient(client, now = Date.now()) {
      clients.set(client.clientId, { ...client, redirectUris: [...client.redirectUris], createdAt: now, lastUsedAt: null });
    },
    async getClient(clientId) {
      const client = clients.get(clientId);
      return client ? { clientId: client.clientId, redirectUris: [...client.redirectUris], clientName: client.clientName } : null;
    },
    async touchClient(clientId, now = Date.now()) {
      const client = clients.get(clientId);
      if (client && (client.lastUsedAt === null || client.lastUsedAt < now - TOUCH_MS)) client.lastUsedAt = now;
    },
    async pruneClients(now = Date.now()) {
      const named = new Set([...[...grants.values()].map((g) => g.clientId), ...[...codes.values()].map((c) => c.clientId)]);
      let removed = 0;
      for (const [id, client] of clients) {
        if (removed >= PRUNE_BATCH) break;
        const old = client.lastUsedAt === null ? client.createdAt < now - CLIENT_RETENTION.unusedDays * 864e5 : client.lastUsedAt < now - CLIENT_RETENTION.idleDays * 864e5;
        if (old && !named.has(id)) {
          clients.delete(id);
          removed++;
        }
      }
      return removed;
    },
    async createGrant(grant) {
      for (const [id, other] of grants) if (other.subject === grant.subject && other.clientId === grant.clientId) grants.delete(id);
      const id = randomUUID();
      grants.set(id, { ...grant, calendars: grant.calendars.filter((c) => UUID(c.connectionId)), id, createdAt: new Date().toISOString(), lastUsedAt: null, revoked: false, windowStart: 0, spent: 0 });
      return id;
    },
    async getGrant(grantId) {
      const grant = grants.get(grantId);
      return grant && !grant.revoked ? plain(grant) : null;
    },
    async listGrants(subject) {
      return [...grants.values()].filter((grant) => grant.subject === subject && !grant.revoked).map(plain);
    },
    async revokeGrant(grantId, subject) {
      const grant = grants.get(grantId);
      if (!grant || (subject !== undefined && grant.subject !== subject)) return false;
      grants.delete(grantId);
      for (const [hash, token] of refresh) if (token.grantId === grantId) refresh.delete(hash);
      for (const [hash, code] of codes) if (code.grantId === grantId) codes.delete(hash);
      return true;
    },
    async forgetConnection(subject, connectionId) {
      for (const grant of grants.values()) if (grant.subject === subject) grant.calendars = grant.calendars.filter((c) => c.connectionId !== connectionId);
    },
    async spendGrant(grantId, cost, allowance) {
      const grant = grants.get(grantId);
      if (!grant || grant.revoked) return null;
      const now = Date.now();
      grant.lastUsedAt = new Date(now).toISOString();
      if (!grant.windowStart || grant.windowStart <= now - allowance.seconds * 1000) {
        grant.windowStart = now;
        grant.spent = cost;
      } else grant.spent = Math.min(grant.spent + cost, CEILING);
      return { allowed: grant.spent <= allowance.units, retryAfter: Math.max(1, Math.ceil((grant.windowStart + allowance.seconds * 1000 - now) / 1000)) };
    },
    async saveCode(hash, code) {
      codes.set(hash, { ...code, used: false });
    },
    async takeCode(hash) {
      const code = codes.get(hash);
      if (!code) return null;
      const replay = code.used;
      code.used = true;
      const { used: _u, ...record } = code;
      return { replay, record };
    },
    async saveRefresh(hash, grantId, expiresAt) {
      if (!grants.has(grantId)) return false;
      const kept = refresh.get(hash);
      if (kept) return kept.grantId === grantId;
      refresh.set(hash, { grantId, expiresAt, usedAt: null, reuses: 0 });
      return true;
    },
    async takeRefresh(hash, now = Date.now()) {
      // No await before the token is marked: in one process this is as atomic as the database's.
      const token = refresh.get(hash);
      if (!token) return null;
      const record = { grantId: token.grantId, expiresAt: token.expiresAt };
      if (token.usedAt === null) {
        token.usedAt = now;
        return { kind: 'fresh', record };
      }
      if (token.usedAt > now - REFRESH_GRACE_SECONDS * 1000 && token.reuses < REFRESH_GRACE_REUSES) {
        token.reuses++;
        return { kind: 'grace', record };
      }
      return { kind: 'replay', record };
    },
    async refreshGrant(hash) {
      return refresh.get(hash)?.grantId ?? null;
    },
  };
}
