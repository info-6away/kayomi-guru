-- AI access limits (docs/MCP.md, "Limits"): counters that every server shares, so that a limit
-- holds however many Vercel instances answer at once. One row per thing counted: a person's tool
-- calls, one registered client's, or registrations from one source address. The key is a keyed
-- hash of what is counted (lib/server/ai/limits.ts), never the person, the client or the address
-- itself, and nothing about any calendar or event is here. A row holds its current window only;
-- rows whose window ended long ago are removed as new grants and registrations are written.
--
-- A grant's own allowance stays where it is, on ai_grants (migration 004).
--
-- One statement, as every file here is (scripts/migrate.mjs sends each file as one request).
do $$
begin
  create table if not exists ai_limits (
    limit_key         text        primary key,
    window_started_at timestamptz not null,
    spent             integer     not null default 0
  );
  create index if not exists ai_limits_by_window on ai_limits (window_started_at);
end
$$;
