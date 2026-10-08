import type { Provider } from '../calendars/types';

// Where a person's permission to read a calendar is kept: one row per person per provider,
// holding the provider's refresh token sealed (see seal.ts). Nothing else about them is stored.
// A row is made by connecting and removed by disconnecting, and by nothing else: a Koyomi
// session ending leaves it exactly as it is.

export interface Connection {
  subject: string;
  provider: Provider;
  /** The refresh token as seal() made it. */
  sealedToken: string;
  scope: string;
  status: 'active' | 'reconnect';
}

/** How much one person may ask of a provider: so many units in each window of so many seconds. */
export interface Allowance {
  units: number;
  seconds: number;
}

export interface Spent {
  connection: Connection;
  /** False once this window's allowance is used up. */
  allowed: boolean;
  /** Seconds until the window ends and the allowance is whole again. */
  retryAfter: number;
}

export interface ConnectionStore {
  get(subject: string, provider: Provider): Promise<Connection | null>;
  /**
   * Loads a connection in order to read from its provider, and counts `cost` against the
   * person's allowance in the same step. Null when there is no connection.
   */
  spend(subject: string, provider: Provider, cost: number, allowance: Allowance): Promise<Spent | null>;
  /** Connects, or replaces an earlier connection. Always leaves it active. */
  save(subject: string, provider: Provider, sealedToken: string, scope: string): Promise<void>;
  setStatus(subject: string, provider: Provider, status: Connection['status']): Promise<void>;
  remove(subject: string, provider: Provider): Promise<void>;
}

/** A tagged-template query function, the shape `neon()` returns. */
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

/** A count that keeps counting would overflow long before anyone looked; this is far past any allowance. */
const CEILING = 1_000_000;

const connection = (subject: string, provider: Provider, row: Record<string, unknown>): Connection => ({
  subject,
  provider,
  sealedToken: String(row.refresh_token_sealed),
  scope: String(row.scope),
  status: row.status === 'reconnect' ? 'reconnect' : 'active',
});

/** The store in Postgres. The table is created by the files in migrations/. */
export function sqlStore(sql: Sql): ConnectionStore {
  return {
    async get(subject, provider) {
      const [row] = await sql`
        select refresh_token_sealed, scope, status from calendar_connections
        where auth_subject = ${subject} and provider = ${provider}`;
      return row ? connection(subject, provider, row) : null;
    },
    // One statement, so two requests arriving together on two servers cannot both read the
    // old count: the database counts them one after the other.
    async spend(subject, provider, cost, allowance) {
      const [row] = await sql`
        update calendar_connections set
          window_started_at = case
            when window_started_at is null or window_started_at <= now() - make_interval(secs => ${allowance.seconds}::int) then now()
            else window_started_at end,
          window_spent = case
            when window_started_at is null or window_started_at <= now() - make_interval(secs => ${allowance.seconds}::int) then ${cost}::int
            else least(window_spent + ${cost}::int, ${CEILING}::int) end
        where auth_subject = ${subject} and provider = ${provider}
        returning refresh_token_sealed, scope, status, window_spent,
          ceil(extract(epoch from (window_started_at + make_interval(secs => ${allowance.seconds}::int) - now()))) as retry_after`;
      if (!row) return null;
      return { connection: connection(subject, provider, row), allowed: Number(row.window_spent) <= allowance.units, retryAfter: Math.max(1, Number(row.retry_after) || 1) };
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
  const rows = new Map<string, Connection & { windowStart: number; spent: number }>();
  const key = (subject: string, provider: Provider) => `${provider}\n${subject}`;
  const plain = ({ subject, provider, sealedToken, scope, status }: Connection): Connection => ({ subject, provider, sealedToken, scope, status });
  return {
    async get(subject, provider) {
      const row = rows.get(key(subject, provider));
      return row ? plain(row) : null;
    },
    async spend(subject, provider, cost, allowance) {
      const row = rows.get(key(subject, provider));
      if (!row) return null;
      const now = Date.now();
      if (!row.windowStart || row.windowStart <= now - allowance.seconds * 1000) {
        row.windowStart = now;
        row.spent = cost;
      } else {
        row.spent = Math.min(row.spent + cost, CEILING);
      }
      return { connection: plain(row), allowed: row.spent <= allowance.units, retryAfter: Math.max(1, Math.ceil((row.windowStart + allowance.seconds * 1000 - now) / 1000)) };
    },
    async save(subject, provider, sealedToken, scope) {
      const before = rows.get(key(subject, provider));
      rows.set(key(subject, provider), { subject, provider, sealedToken, scope, status: 'active', windowStart: before?.windowStart ?? 0, spent: before?.spent ?? 0 });
    },
    async setStatus(subject, provider, status) {
      const row = rows.get(key(subject, provider));
      if (row) row.status = status;
    },
    async remove(subject, provider) {
      rows.delete(key(subject, provider));
    },
  };
}
