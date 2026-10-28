import { randomUUID } from 'node:crypto';
import type { Provider } from '../calendars/types';
import { fingerprint } from './seal';

// Where a person's permission to read a calendar is kept: one row for each account they have
// connected at a provider, holding that account's refresh token sealed (see seal.ts). A person
// may connect several accounts, at one provider or more. Nothing else about them is stored.
// A row is made by connecting and removed by disconnecting, and by nothing else: a Koyomi
// session ending leaves it exactly as it is.

export interface Connection {
  /** Koyomi's own name for the connection: random, and all a browser is ever told of it. */
  id: string;
  subject: string;
  provider: Provider;
  /**
   * Which account it is, as a word that only this server can make from the account's own
   * identifier (see `accountKey` below). Never the identifier itself.
   */
  accountKey: string;
  /** The refresh token as seal() made it. */
  sealedToken: string;
  scope: string;
  status: 'active' | 'reconnect';
}

/**
 * Which account a connection is for, as the table holds it. The provider's own identifier for
 * the account (for Google, the id of its primary calendar, which is its address; for Microsoft,
 * its tenant and the subject Microsoft gives Koyomi for it) is not kept: what is kept is a word
 * made from it with the server's key, together with whose connection it is. The same person
 * connecting the same account again comes to the same word, so their row is found and replaced,
 * not doubled. Nobody without the key can turn the word back into an identifier, and two people
 * who connect the same account get two different words.
 *
 * @param tokenKey The key provider tokens are sealed with (seal.ts).
 */
export const accountKey = (tokenKey: string, subject: string, provider: Provider, providerAccountId: string) =>
  // An address is the same address in any case, and so is Yahoo's principal, which is made from
  // one. Microsoft's subject is not: its case is part of it.
  fingerprint(provider === 'microsoft' ? providerAccountId.trim() : providerAccountId.trim().toLowerCase(), tokenKey, `account\n${subject}\n${provider}`);

/** What a token's seal is tied to: it only opens on the row it was made for. */
export const sealContext = (connection: Pick<Connection, 'subject' | 'provider' | 'accountKey'>) => `${connection.subject}:${connection.provider}:${connection.accountKey}`;

/** How much may be asked of a provider about one account: so many units in each window of so many seconds. */
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

// Every lookup below is by the person as well as the connection. A connection's id comes from
// the browser, the person from the session and from nowhere else, so an id that belongs to
// someone else finds nothing.
export interface ConnectionStore {
  /** Every account a person has connected, the earliest first. */
  list(subject: string): Promise<Connection[]>;
  get(subject: string, id: string): Promise<Connection | null>;
  /**
   * Loads a connection in order to read from its provider, and counts `cost` against that
   * account's allowance in the same step. Null when it is not one of this person's.
   */
  spend(subject: string, id: string, cost: number, allowance: Allowance): Promise<Spent | null>;
  /**
   * Connects an account, or replaces the token of one this person had already connected.
   * Always leaves it active, and touches no other row. Returns the connection's id.
   */
  save(subject: string, provider: Provider, accountKey: string, sealedToken: string, scope: string): Promise<string>;
  /**
   * Puts the refresh token a provider has just handed out in place of the one it was traded
   * for (Microsoft issues a new one with every use). Only if the row still holds that one: a
   * token from a reconnection made meanwhile is never overwritten by an older grant's.
   */
  renewToken(subject: string, id: string, was: string, sealedToken: string): Promise<void>;
  setStatus(subject: string, id: string, status: Connection['status']): Promise<void>;
  remove(subject: string, id: string): Promise<void>;
}

/** A tagged-template query function, the shape `neon()` returns. */
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

/** A count that keeps counting would overflow long before anyone looked; this is far past any allowance. */
const CEILING = 1_000_000;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Whether a value has the shape of a connection's id. Anything else is not asked of the database at all. */
export const isConnectionId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

const connection = (subject: string, row: Record<string, unknown>): Connection => ({
  id: String(row.connection_id),
  subject,
  provider: row.provider as Provider,
  accountKey: String(row.provider_account_id),
  sealedToken: String(row.refresh_token_sealed),
  scope: String(row.scope),
  status: row.status === 'reconnect' ? 'reconnect' : 'active',
});

/** The store in Postgres. The table is created by the files in migrations/. */
export function sqlStore(sql: Sql): ConnectionStore {
  return {
    async list(subject) {
      const rows = await sql`
        select connection_id, provider, provider_account_id, refresh_token_sealed, scope, status from calendar_connections
        where auth_subject = ${subject}
        order by created_at, connection_id`;
      return rows.map((row) => connection(subject, row));
    },
    async get(subject, id) {
      if (!isConnectionId(id)) return null;
      const [row] = await sql`
        select connection_id, provider, provider_account_id, refresh_token_sealed, scope, status from calendar_connections
        where auth_subject = ${subject} and connection_id = ${id}`;
      return row ? connection(subject, row) : null;
    },
    // One statement, so two requests arriving together on two servers cannot both read the
    // old count: the database counts them one after the other.
    async spend(subject, id, cost, allowance) {
      if (!isConnectionId(id)) return null;
      const [row] = await sql`
        update calendar_connections set
          window_started_at = case
            when window_started_at is null or window_started_at <= now() - make_interval(secs => ${allowance.seconds}::int) then now()
            else window_started_at end,
          window_spent = case
            when window_started_at is null or window_started_at <= now() - make_interval(secs => ${allowance.seconds}::int) then ${cost}::int
            else least(window_spent + ${cost}::int, ${CEILING}::int) end
        where auth_subject = ${subject} and connection_id = ${id}
        returning connection_id, provider, provider_account_id, refresh_token_sealed, scope, status, window_spent,
          ceil(extract(epoch from (window_started_at + make_interval(secs => ${allowance.seconds}::int) - now()))) as retry_after`;
      if (!row) return null;
      return { connection: connection(subject, row), allowed: Number(row.window_spent) <= allowance.units, retryAfter: Math.max(1, Number(row.retry_after) || 1) };
    },
    // The same account again is the same row: its token is replaced and nothing is doubled.
    // Another account is another row, and no row but the one named here is touched.
    async save(subject, provider, accountKey, sealedToken, scope) {
      const [row] = await sql`
        insert into calendar_connections (auth_subject, provider, provider_account_id, refresh_token_sealed, scope)
        values (${subject}, ${provider}, ${accountKey}, ${sealedToken}, ${scope})
        on conflict (auth_subject, provider, provider_account_id) do update
          set refresh_token_sealed = excluded.refresh_token_sealed, scope = excluded.scope, status = 'active', updated_at = now()
        returning connection_id`;
      return String(row.connection_id);
    },
    async renewToken(subject, id, was, sealedToken) {
      if (!isConnectionId(id)) return;
      await sql`
        update calendar_connections set refresh_token_sealed = ${sealedToken}, updated_at = now()
        where auth_subject = ${subject} and connection_id = ${id} and refresh_token_sealed = ${was}`;
    },
    async setStatus(subject, id, status) {
      if (!isConnectionId(id)) return;
      await sql`
        update calendar_connections set status = ${status}, updated_at = now()
        where auth_subject = ${subject} and connection_id = ${id}`;
    },
    async remove(subject, id) {
      if (!isConnectionId(id)) return;
      await sql`delete from calendar_connections where auth_subject = ${subject} and connection_id = ${id}`;
    },
  };
}

/**
 * The same store held in memory, for the browser tests only: it forgets everything when the
 * server stops, and each server instance would have its own. Never used on a deployment.
 */
export function memoryStore(): ConnectionStore {
  const rows = new Map<string, Connection & { windowStart: number; spent: number }>();
  const plain = ({ id, subject, provider, accountKey, sealedToken, scope, status }: Connection): Connection => ({ id, subject, provider, accountKey, sealedToken, scope, status });
  const mine = (subject: string, id: string) => {
    const row = rows.get(id);
    return row?.subject === subject ? row : undefined;
  };
  return {
    async list(subject) {
      // A Map keeps the order things were put in, which is the order they were connected.
      return [...rows.values()].filter((row) => row.subject === subject).map(plain);
    },
    async get(subject, id) {
      const row = mine(subject, id);
      return row ? plain(row) : null;
    },
    async spend(subject, id, cost, allowance) {
      const row = mine(subject, id);
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
    async save(subject, provider, accountKey, sealedToken, scope) {
      const before = [...rows.values()].find((row) => row.subject === subject && row.provider === provider && row.accountKey === accountKey);
      const id = before?.id ?? randomUUID();
      rows.set(id, { id, subject, provider, accountKey, sealedToken, scope, status: 'active', windowStart: before?.windowStart ?? 0, spent: before?.spent ?? 0 });
      return id;
    },
    async renewToken(subject, id, was, sealedToken) {
      const row = mine(subject, id);
      if (row?.sealedToken === was) row.sealedToken = sealedToken;
    },
    async setStatus(subject, id, status) {
      const row = mine(subject, id);
      if (row) row.status = status;
    },
    async remove(subject, id) {
      if (mine(subject, id)) rows.delete(id);
    },
  };
}
