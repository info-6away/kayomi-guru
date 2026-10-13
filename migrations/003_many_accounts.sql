-- A person may connect several accounts, so a row is no longer "this person's connection" but
-- "this person's connection to this account".
--
--   connection_id        Koyomi's own name for the row: random, and what a browser is told.
--   provider_account_id  Which account it is: a keyed hash of the account's identifier at the
--                        provider (lib/server/connections.ts). Not the identifier, and not an address.
--
-- The rule that was "one row per person per provider" becomes "one row per person per provider
-- account": connecting the same account again replaces its token, and connecting another adds a row.
--
-- Rows made before this have no account to their name, and nothing here can ask the provider
-- which it was. They are removed: whoever connected before connects again, once. (When this was
-- written there were only test connections.)
--
-- One statement, so it is applied whole or not at all, and running it again changes nothing.
do $$
begin
  alter table calendar_connections
    add column if not exists connection_id uuid not null default gen_random_uuid(),
    add column if not exists provider_account_id text;

  delete from calendar_connections where provider_account_id is null;

  alter table calendar_connections
    alter column provider_account_id set not null,
    drop constraint if exists calendar_connections_pkey,
    add primary key (connection_id);

  create unique index if not exists calendar_connections_one_per_account
    on calendar_connections (auth_subject, provider, provider_account_id);
end
$$;
