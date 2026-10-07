import type { Provider } from '../calendars/types';

// Where a person's permission to read a calendar is kept: one row per person per provider,
// holding the provider's refresh token sealed (see seal.ts). Nothing else about them is stored.

export interface Connection {
  subject: string;
  provider: Provider;
  /** The refresh token as seal() made it. */
  sealedToken: string;
  scope: string;
  status: 'active' | 'reconnect';
}

export interface ConnectionStore {
  get(subject: string, provider: Provider): Promise<Connection | null>;
  /** Connects, or replaces an earlier connection. Always leaves it active. */
  save(subject: string, provider: Provider, sealedToken: string, scope: string): Promise<void>;
  setStatus(subject: string, provider: Provider, status: Connection['status']): Promise<void>;
  remove(subject: string, provider: Provider): Promise<void>;
}

/** A tagged-template query function, the shape `neon()` returns. */
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

/** The store in Postgres. The table is created by migrations/001_calendar_connections.sql. */
export function sqlStore(sql: Sql): ConnectionStore {
  return {
    async get(subject, provider) {
      const [row] = await sql`
        select refresh_token_sealed, scope, status from calendar_connections
        where auth_subject = ${subject} and provider = ${provider}`;
      if (!row) return null;
      return { subject, provider, sealedToken: String(row.refresh_token_sealed), scope: String(row.scope), status: row.status === 'reconnect' ? 'reconnect' : 'active' };
    },
    async save(subject, provider, sealedToken, scope) {
      await sql`
        insert into calendar_connections (auth_subject, provider, refresh_token_sealed, scope)
        values (${subject}, ${provider}, ${sealedToken}, ${scope})
        on conflict (auth_subject, provider) do update
          set refresh_token_sealed = excluded.refresh_token_sealed, scope = excluded.scope, status = 'active', updated_at = now()`;
    },
    async setStatus(subject, provider, status) {
      await sql`
        update calendar_connections set status = ${status}, updated_at = now()
        where auth_subject = ${subject} and provider = ${provider}`;
    },
    async remove(subject, provider) {
      await sql`delete from calendar_connections where auth_subject = ${subject} and provider = ${provider}`;
    },
  };
}

/**
 * The same store held in memory, for the browser tests only: it forgets everything when the
 * server stops, and each server instance would have its own. Never used on a deployment.
 */
export function memoryStore(): ConnectionStore {
  const rows = new Map<string, Connection>();
  const key = (subject: string, provider: Provider) => `${provider}\n${subject}`;
  return {
    async get(subject, provider) {
      return rows.get(key(subject, provider)) ?? null;
    },
    async save(subject, provider, sealedToken, scope) {
      rows.set(key(subject, provider), { subject, provider, sealedToken, scope, status: 'active' });
    },
    async setStatus(subject, provider, status) {
      const row = rows.get(key(subject, provider));
      if (row) rows.set(key(subject, provider), { ...row, status });
    },
    async remove(subject, provider) {
      rows.delete(key(subject, provider));
    },
  };
}
