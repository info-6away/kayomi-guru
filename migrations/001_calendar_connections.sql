-- One row per person per provider: the permission they gave Koyomi to read a calendar.
-- This is the only thing Koyomi's server keeps. No events, no calendar names, no email address.
create table if not exists calendar_connections (
  -- The 6Away Auth subject: a stable, opaque id for the signed-in person.
  auth_subject         text        not null,
  provider             text        not null,
  -- The provider's refresh token, sealed with AES-256-GCM (lib/server/seal.ts). Never the token itself.
  refresh_token_sealed text        not null,
  -- The permissions the person granted, as the provider reported them.
  scope                text        not null,
  -- 'reconnect' once the provider has refused the token: nothing more is fetched until they connect again.
  status               text        not null default 'active' check (status in ('active', 'reconnect')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (auth_subject, provider)
);
