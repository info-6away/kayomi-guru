-- How much each person has asked of their provider in the current minute, so that one browser,
-- or one script holding its cookie, cannot make Koyomi hammer Google. Kept here, beside the
-- connection, because a counter in a server's memory would be a different counter on every
-- instance Vercel happens to start.
alter table calendar_connections
  add column if not exists window_started_at timestamptz,
  add column if not exists window_spent integer not null default 0;
