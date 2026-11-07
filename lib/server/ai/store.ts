import { randomUUID } from 'node:crypto';
import type { Allowance, Sql } from '../connections';
import { isConnectionId } from '../connections';

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

/** What taking a code or a refresh token found: the record, and whether it had been taken before. */
export type Taken<T> = { record: T; replay: boolean } | null;

export interface AiStore {
  saveClient(client: AiClient): Promise<void>;
  getClient(clientId: string): Promise<AiClient | null>;
  /**
   * Records that `subject` allowed `clientId` to read `calendars`, ending any grant the same person
   * gave the same client before. Only the person's own connections can be named: any other is
   * left out by the store itself.
   */
  createGrant(grant: Omit<Grant, 'id' | 'createdAt' | 'lastUsedAt'>): Promise<string>;
  /** A grant that has not been revoked, with its calendars whose connections still exist. */
  getGrant(grantId: string): Promise<Grant | null>;
  /** This person's grants that have not been revoked, oldest first. */
  listGrants(subject: string): Promise<Grant[]>;
  /** Ends a grant. With `subject`, only that person's. True if it was in force. */
  revokeGrant(grantId: string, subject?: string): Promise<boolean>;
  /** Counts one tool call against the grant's allowance, and notes when it was last used. */
  spendGrant(grantId: string, cost: number, allowance: Allowance): Promise<{ allowed: boolean; retryAfter: number } | null>;
  saveCode(hash: string, code: CodeRecord): Promise<void>;
  /** Marks a code used. `replay` is true when it had been used before. */
  takeCode(hash: string): Promise<Taken<CodeRecord>>;
  saveRefresh(hash: string, grantId: string, expiresAt: number): Promise<void>;
  /** Marks a refresh token used. `replay` is true when it had been used before. */
  takeRefresh(hash: string): Promise<Taken<{ grantId: string; expiresAt: number }>>;
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
    async saveClient(client) {
      await sql`insert into ai_clients (client_id, redirect_uris, client_name) values (${client.clientId}, ${client.redirectUris}::text[], ${client.clientName})`;
    },
    async getClient(clientId) {
      const [row] = await sql`select client_id, redirect_uris, client_name from ai_clients where client_id = ${clientId}`;
      return row ? { clientId: String(row.client_id), redirectUris: (row.redirect_uris as string[]).map(String), clientName: row.client_name == null ? null : String(row.client_name) } : null;
    },
    async createGrant(grant) {
      await sql`update ai_grants set revoked_at = now() where auth_subject = ${grant.subject} and client_id = ${grant.clientId} and revoked_at is null`;
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
        where grant_id = ${grantId} and revoked_at is null`;
      if (!row) return null;
      return grantOf(row, (await calendarsOf([grantId])).get(grantId) ?? []);
    },
    async listGrants(subject) {
      const rows = await sql`
        select grant_id, auth_subject, client_id, client_label, redirect_host, time_zone, created_at, last_used_at from ai_grants
        where auth_subject = ${subject} and revoked_at is null
        order by created_at, grant_id`;
      const calendars = await calendarsOf(rows.map((row) => String(row.grant_id)));
      return rows.map((row) => grantOf(row, calendars.get(String(row.grant_id)) ?? []));
    },
    async revokeGrant(grantId, subject) {
      if (!UUID(grantId)) return false;
      const rows = subject === undefined
        ? await sql`update ai_grants set revoked_at = now() where grant_id = ${grantId} and revoked_at is null returning grant_id`
        : await sql`update ai_grants set revoked_at = now() where grant_id = ${grantId} and auth_subject = ${subject} and revoked_at is null returning grant_id`;
      if (rows.length) await sql`delete from ai_refresh_tokens where grant_id = ${grantId}`;
      return rows.length > 0;
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
        where grant_id = ${grantId} and revoked_at is null
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
      await sql`insert into ai_refresh_tokens (token_hash, grant_id, expires_at) values (${hash}, ${grantId}, ${new Date(expiresAt).toISOString()})`;
    },
    async takeRefresh(hash) {
      const [fresh] = await sql`update ai_refresh_tokens set used_at = now() where token_hash = ${hash} and used_at is null returning grant_id, expires_at`;
      const row = fresh ?? (await sql`select grant_id, expires_at from ai_refresh_tokens where token_hash = ${hash}`)[0];
      if (!row) return null;
      return { replay: !fresh, record: { grantId: String(row.grant_id), expiresAt: new Date(row.expires_at as string).getTime() } };
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
  const clients = new Map<string, AiClient>();
  const grants = new Map<string, Grant & { revoked: boolean; windowStart: number; spent: number }>();
  const codes = new Map<string, CodeRecord & { used: boolean }>();
  const refresh = new Map<string, { grantId: string; expiresAt: number; used: boolean }>();
  const plain = ({ revoked: _r, windowStart: _w, spent: _s, ...grant }: Grant & { revoked: boolean; windowStart: number; spent: number }): Grant => ({ ...grant, calendars: [...grant.calendars] });
  return {
    async saveClient(client) {
      clients.set(client.clientId, { ...client, redirectUris: [...client.redirectUris] });
    },
    async getClient(clientId) {
      const client = clients.get(clientId);
      return client ? { ...client, redirectUris: [...client.redirectUris] } : null;
    },
    async createGrant(grant) {
      for (const other of grants.values()) if (other.subject === grant.subject && other.clientId === grant.clientId) other.revoked = true;
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
      if (!grant || grant.revoked || (subject !== undefined && grant.subject !== subject)) return false;
      grant.revoked = true;
      for (const [hash, token] of refresh) if (token.grantId === grantId) refresh.delete(hash);
      return true;
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
      refresh.set(hash, { grantId, expiresAt, used: false });
    },
    async takeRefresh(hash) {
      const token = refresh.get(hash);
      if (!token) return null;
      const replay = token.used;
      token.used = true;
      return { replay, record: { grantId: token.grantId, expiresAt: token.expiresAt } };
    },
    async refreshGrant(hash) {
      return refresh.get(hash)?.grantId ?? null;
    },
  };
}
