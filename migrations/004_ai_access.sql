-- AI access (docs/MCP.md): which AI assistants a person has allowed to read which of their
-- connected calendars, and the OAuth state that goes with it. Nothing about events is kept here:
-- no titles, no times, no calendar names, no provider calendar ids (only a keyed hash of each),
-- no account addresses. A grant has its own life, apart from the calendar connections: revoking
-- one touches no connection, and disconnecting a calendar removes it from every grant. A grant
-- that is revoked, or replaced by a new one for the same assistant, is deleted with everything
-- under it: nothing is kept of access that has ended.
--
-- One statement, as every file here is (scripts/migrate.mjs sends each file as one request).
do $$
begin
  -- Clients that registered themselves (RFC 7591). Clients known by a metadata document (an
  -- https client_id) are not stored: their document is fetched when needed.
  create table if not exists ai_clients (
    client_id     text        primary key,
    redirect_uris text[]      not null,
    -- What the client called itself. Shown to nobody as a fact and never used for a decision.
    client_name   text,
    created_at    timestamptz not null default now()
  );

  create table if not exists ai_grants (
    grant_id          uuid        primary key default gen_random_uuid(),
    auth_subject      text        not null,
    client_id         text        not null,
    -- How Koyomi names the client to the person: from the validated redirect address, not from
    -- anything the client says of itself.
    client_label      text        not null,
    redirect_host     text        not null,
    -- The zone of the browser in which the person approved access: the default for answers.
    time_zone         text        not null,
    created_at        timestamptz not null default now(),
    last_used_at      timestamptz,
    -- The grant's own allowance of tool calls (as calendar_connections has one for providers).
    window_started_at timestamptz,
    window_spent      integer     not null default 0
  );
  create index if not exists ai_grants_by_person on ai_grants (auth_subject);

  -- The calendars a grant may read: one connection's calendar, named by a keyed hash of its id.
  -- connection_id is not a foreign key on purpose: migration 003 rebuilds calendar_connections'
  -- primary key every time the migrations run, which a reference to it would block. A calendar
  -- counts only while its connection exists and is the grant's person's (lib/server/ai/store.ts
  -- joins on both), and rows of connections that have gone are cleared when grants are written.
  create table if not exists ai_grant_calendars (
    grant_id             uuid        not null references ai_grants (grant_id) on delete cascade,
    connection_id        uuid        not null,
    calendar_fingerprint text        not null,
    created_at           timestamptz not null default now(),
    primary key (grant_id, connection_id, calendar_fingerprint)
  );

  -- Authorization codes: kept as a keyed hash, used once, for minutes.
  create table if not exists ai_codes (
    code_hash      text        primary key,
    grant_id       uuid        not null references ai_grants (grant_id) on delete cascade,
    client_id      text        not null,
    redirect_uri   text        not null,
    code_challenge text        not null,
    resource       text        not null,
    expires_at     timestamptz not null,
    used_at        timestamptz
  );

  -- Refresh tokens: kept as a keyed hash, each replaced on use.
  create table if not exists ai_refresh_tokens (
    token_hash text        primary key,
    grant_id   uuid        not null references ai_grants (grant_id) on delete cascade,
    expires_at timestamptz not null,
    used_at    timestamptz,
    created_at timestamptz not null default now()
  );
  create index if not exists ai_refresh_tokens_by_grant on ai_refresh_tokens (grant_id);
end
$$;
