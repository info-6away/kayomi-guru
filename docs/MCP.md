# Koyomi for AI assistants (remote MCP, read-only)

Koyomi already reads every calendar a person connects — several Google accounts, Microsoft,
Yahoo, calendar links — and turns them into one kind of event. This is the same thing offered to
an AI assistant: one connection to Koyomi instead of one per provider.

> For people: all your calendars, one quiet place. For AI: all your calendars, one connection.

One standards-based remote MCP server, used unchanged by ChatGPT, Claude and Grok. Read-only,
behind OAuth, switched off unless `KOYOMI_MCP=on`. This document is the audit of `main` it was
designed from (`10db829`, 2026-11-07), then the design.

---

## Part 1: audit of current `main`

### Identity and sign-in

1. **Who a person is.** The 6Away Auth subject (`sub`), from `auth.getCurrentUser()`
   (`lib/server/auth.ts`, `@6away/auth-connect` 1.0.6). Every row in `calendar_connections`
   belongs to an `auth_subject`; every query is scoped to the signed-in subject
   (`lib/server/api.ts`, `signedIn()`). Email is never used to identify anyone.
2. **6Away's part.** OIDC relying party: `/api/auth/signin` → 6Away → `/api/auth/callback/6away`,
   PKCE, state, nonce, ID token verified with `jose` against 6Away's JWKS. Asked for only when
   someone connects a calendar. Its settings exist in Production only.
3. **Session.** Cookie `koyomi_session`: base64url JSON (`sub`, email, name, the ID token, `exp`)
   plus an HMAC-SHA256 tag with `SESSION_SECRET`; HttpOnly, Secure, SameSite=Lax, path `/`,
   30 days. Host-only: it belongs to `app.koyomi.guru` and is never sent to `koyomi.guru`.
4. **OAuth-server capability.** None. Koyomi is only ever an OAuth *client* (of 6Away, Google,
   Microsoft). Reusable pieces: `seal()`/`open()` (AES-256-GCM with context) and `fingerprint()`
   (HMAC-SHA256) in `lib/server/seal.ts`, the sealed one-time round-trip cookie in
   `lib/server/flow.ts`, PKCE helpers, and the hardened public-internet fetcher in
   `lib/server/fetchlink.ts`.
5. **Can the 6Away subject sit behind MCP authorization?** Yes. It is the key every connection is
   already stored under, it is verified on every request, and it is never chosen by the browser.
   An MCP grant is "this 6Away subject allowed this OAuth client to read these calendars".

### Calendar backend

6. **`calendar_connections`** (migrations 001–003): `connection_id uuid` (primary key),
   `auth_subject`, `provider` (`google | microsoft | yahoo | link`), `provider_account_id` (a keyed
   hash of the account, never the account itself), `refresh_token_sealed`, `scope`, `status`
   (`active | reconnect`), `window_started_at`/`window_spent` (the read allowance),
   `created_at`/`updated_at`. Unique on `(auth_subject, provider, provider_account_id)`.
7. **Credentials.** AES-256-GCM with `TOKEN_ENCRYPTION_KEY`, additional data
   `subject:provider:accountKey`, so a sealed value moved to another row cannot be opened.
   Google/Microsoft: refresh tokens. Yahoo: email + app password sealed together. Calendar link:
   the link and its name sealed together. Opened only in memory, never sent to a browser or logged.
8. **Google**: Calendar API v3, `calendarList` + `events` with `singleEvents=true` (Google expands
   recurrences), a fixed field mask (`EVENT_FIELDS`), sync tokens for the app's incremental reads.
9. **Microsoft**: Graph v1.0 `/me/calendars` (own calendars only) + `calendarView` (Graph expands
   recurrences), `$select` = `MICROSOFT_EVENT_FIELDS`, whole re-reads, refresh-token rotation.
10. **Yahoo**: CalDAV (`caldav.calendar.yahoo.com`), PROPFIND + REPORT only, recurrences expanded on
    the server with `ical.js`, changed occurrences sharing their series' address handled
    (`onlyChanged`/`cancelledBy`, accepted on real Yahoo 2026-11-06).
11. **Calendar link**: the server fetches the .ics through `fetchlink.ts` (public internet only,
    DNS-rebinding safe, size and time limits), parses and expands with `lib/calendars/ical.ts`.
12. **Live on Production** (Vercel Production settings, checked 2026-11-06/07): Google, Microsoft
    (client settings present), Yahoo (`YAHOO_CALENDAR=on`, accepted 2026-11-06), calendar links
    (`CALENDAR_LINKS=on`). The owner's account currently has 4 Google accounts and 1 calendar
    link, and no Microsoft or Yahoo connection.

### Normalization

13. **One event shape** (`ExternalEvent`, `lib/calendars/types.ts`): `id` =
    `connectionId:calendarId:providerEventId`, `title`, `start`/`end`, `allDay`, `timeZone`,
    `status` (`confirmed | tentative`), `link`, `updatedAt`. Cancelled events, events the person
    declined, Google's working-location markers and Microsoft's series masters are dropped.
14. **Read window**: 35 days back, 189 days ahead (`lib/calendars/window.ts`); the server refuses
    any request over 232 days.
15. **Recurrence**: every provider returns *occurrences*, expanded at the provider (Google,
    Microsoft) or on the server (Yahoo, links). Changed and cancelled occurrences are handled
    per provider, with tests.
16. **All-day**: `start`/`end` are calendar days (`YYYY-MM-DD`, end inclusive) and are never put
    through a time zone.
17. **Time zones**: timed events are UTC instants; the zone they were written in is kept
    (`timeZone`). The app shows them in the device's zone. The server has no idea of the person's
    zone.
18. **Failures**: `ProviderError` kinds (`reconnect`, `gone`, `not_found`, `blocked`, `expired`,
    `slow_down`, `busy`). One connection failing never touches another; a refused token marks
    only that connection `reconnect`. Errors are fixed words, never provider text.
19. **Rate limits**: 120 units a minute per connection, counted in the database row (one count
    for every server), plus a provider's own `Retry-After` pause, a 25-second job deadline, and
    `once()` so identical concurrent requests are asked once.
20. **Several connections**: every read is by connection id *within the signed-in subject's
    rows*; an id belonging to someone else finds nothing (`spend()`), with e2e tests.

### Visibility

21. **Shown/hidden is device-only.** `ExternalCalendar.visible` lives in the browser's IndexedDB
    (`lib/calendars/db.ts`, `showCalendar()` in `lib/calendars/store.ts`); the server never sees
    it. It must not and will not be used as AI authorization. AI access gets its own server-side
    permission, per calendar.

### Infrastructure

22. **Hosting a Streamable HTTP endpoint on the current deployment.** Yes. Vercel Functions on
    Node (Fluid Compute) take ordinary request/response handlers, and the MCP TypeScript SDK v2
    (`@modelcontextprotocol/server`, the stable line, implementing spec 2026-07-28) provides a
    stateless web-standard handler that also answers 2025-era clients per request. No sessions,
    no long-lived streams, nothing to keep between requests.
23. **`mcp.koyomi.guru`: not needed, and worse.** The person must be signed in to approve access,
    and the session cookie is host-only on `app.koyomi.guru`. Putting the authorization server
    and the MCP endpoint on `app.koyomi.guru` reuses that session, needs no DNS or Vercel domain
    change, and keeps one origin for everything that touches calendars. Endpoint:
    **`https://app.koyomi.guru/mcp`**.
24. **CSP / CORS / routing.** No middleware; host routing is all in `next.config.ts` (`/` is the
    site on `koyomi.guru`, the calendar elsewhere; Previews show the site at `/`). Global headers:
    `nosniff`, `X-Frame-Options: DENY` (keeps the consent page from being framed),
    `Referrer-Policy: strict-origin-when-cross-origin`. API routes are same-origin only (POST needs
    `Origin` = the app). The MCP endpoint is the exception: it is called server-to-server, carries
    a bearer token and never a cookie, so it does not use the cookie session or the same-origin
    rule. The service worker ignores `/api/`; the OAuth endpoints live under `/api/oauth/`. It did
    answer every other page, including `/ai/consent`, and after 4 seconds without a response it
    serves the saved calendar: the consent page could have turned into the calendar on a slow
    connection. It now ignores `/ai/` as well.
    `/.well-known/...` paths are rewritten to route handlers.
25. **Privacy and Terms.** Privacy names every provider, what is read and kept, and its tests pin
    the wording. A new section is needed for AI connections (what the AI receives, transient
    reads, logs, revocation, local events excluded). Terms: two sentences on third-party AI
    services. The Terms length guard is 475 words.

---

## Part 2: design

### Shape

```
ChatGPT / Claude / Grok  ── OAuth 2.1 (Koyomi is the authorization server) ──┐
          │                                                                    │
          └── POST https://app.koyomi.guru/mcp  (Bearer: Koyomi access token)  │
                    │                                                          │
              check token → grant (subject, client, calendars) ◀───────────────┘
                    │
              existing readers (google.ts, microsoft.ts, yahoo.ts, link.ts) via reading()
                    │
              normalize in memory → tool result → discarded
```

Nothing new is stored about events. Provider credentials never leave the server. The AI only
ever holds a Koyomi token that can do four read-only things.

### Protocol and transport

- `@modelcontextprotocol/server` v2, `createMcpHandler`, stateless; answers 2026-07-28 requests
  and 2025-06-18 / 2025-11-25 clients (`initialize`) on the same endpoint.
- Route `app/mcp/route.ts`: POST only (GET/DELETE → 405), `runtime = 'nodejs'`.
- `Origin`: absent is fine (server-to-server); present must be one of the AI clients' origins or
  a loopback origin (MCP Inspector); anything else → 403.

### OAuth

Koyomi becomes a small OAuth 2.1 authorization server, on `https://app.koyomi.guru`:

| Endpoint | Path |
| --- | --- |
| Protected resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource` |
| Authorization server metadata (RFC 8414) | `/.well-known/oauth-authorization-server` |
| Authorization | `/api/oauth/authorize` → consent page `/ai/consent` |
| Token | `/api/oauth/token` (form-encoded) |
| Registration (RFC 7591, deprecated but used) | `/api/oauth/register` |
| Revocation (RFC 7009) | `/api/oauth/revoke` |

- **Metadata**: `issuer` = `https://app.koyomi.guru`; `resource` = `https://app.koyomi.guru/mcp`;
  `response_types_supported: ["code"]`; `grant_types_supported: ["authorization_code",
  "refresh_token"]`; `code_challenge_methods_supported: ["S256"]`;
  `token_endpoint_auth_methods_supported: ["none"]` (public clients, PKCE);
  `client_id_metadata_document_supported: true`; `authorization_response_iss_parameter_supported:
  true`; `scopes_supported: ["calendars.read"]` (and `offline_access` in the AS metadata only).
- **401** from `/mcp`: `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="calendars.read"`.
- **Client registration**: both, because the three clients differ.
  - *Client ID Metadata Documents* (preferred by the spec, Claude and ChatGPT): the `client_id` is
    an https URL; Koyomi fetches it with the hardened public-internet fetcher (no private
    addresses, small size and time limits, no redirects), requires `client_id` to equal the URL
    and `token_endpoint_auth_method` to allow `none`, and caches it briefly in memory.
  - *Dynamic registration* (Grok documents nothing; DCR is the common denominator): stores
    `client_id` (random), `redirect_uris`, and a display name it never trusts. **Retention**
    (`CLIENT_RETENTION`): a registration that never started an authorization is removed 7 days
    after it was made; one that did, 90 days after it last did (written at most once an hour,
    when an authorization starts). Never while any grant or code names it, so no person's access
    ever ends because its client's record was tidied. Tidying happens when a new client
    registers (the only way records are added), at most 200 at a time, in one statement that
    checks for grants and codes as it deletes. No background job.
  - Redirect URIs: exact match; https, or loopback (`localhost`/`127.0.0.1`, port may differ, as
    for native apps). The consent page always shows where the person will be sent.
- **Authorization request**: `response_type=code`, `client_id`, `redirect_uri`, `state`,
  `code_challenge` (S256 only), `resource` (must be the MCP URL if sent), `scope`. Invalid
  `client_id`/`redirect_uri` → an error page, never a redirect. Everything else → redirect with
  `error`, `state` and `iss`. Not signed in → 6Away sign-in, then back.
- **Consent** (`/ai/consent`): lists the person's connected calendars, read live, *all unticked*,
  and only explicit choices are granted. The request is held in a sealed, single-use, 10-minute
  cookie bound to the subject; the form posts back with an anti-forgery value derived from it,
  same-origin only.
- **Codes**: 256-bit random, stored as an HMAC hash, single use, 5 minutes, bound to client,
  redirect URI, PKCE challenge, resource and grant. A second use revokes the grant.
- **Access tokens**: `ka1.<payload>.<HMAC>` — grant id, client id, audience (the MCP URL),
  expiry (15 minutes). Every request also loads the grant: revoked, missing, wrong client or
  wrong audience → 401. Revocation is immediate.
- **Refresh tokens**: 256-bit random, stored hashed, 30 days, rotated on every use. A just-replaced
  token gets a **grace of 30 seconds and at most 3 more uses** (`REFRESH_GRACE_SECONDS`,
  `REFRESH_GRACE_REUSES`): each is answered with a new pair, and the pair given first stays good.
  That covers an answer lost on the way (the client retries with the same token) and a client's
  servers refreshing at once. After the grace, or beyond the count, the token is spent for good
  and coming back revokes the grant and every token of it. Rotation is never skipped: every use,
  grace or not, gets a new refresh token. The database decides which use is first (one
  `update … where used_at is null`), so of any number of uses at once exactly one is first; if a
  copy coming back ends the grant while another refresh is being answered, that one gets
  `invalid_grant`, never a token of an ended grant.
- **Keys**: derived from `TOKEN_ENCRYPTION_KEY` with their own labels (as `fingerprint()` does).
  No new secret.

### Grants and calendar permissions (migration 004)

```
ai_clients         client_id, redirect_uris, client_name (display only), created_at,
                   last_used_at                                                          (DCR only)
ai_grants          grant_id, auth_subject, client_id, client_label, redirect_host, time_zone,
                   created_at, last_used_at, window_started_at, window_spent
ai_grant_calendars grant_id → ai_grants (on delete cascade), connection_id,
                   calendar_fingerprint                (an HMAC of the calendar id; never the id)
ai_codes           code_hash, grant_id → ai_grants (cascade), client_id, redirect_uri, code_challenge, resource, expires_at, used_at
ai_refresh_tokens  token_hash, grant_id → ai_grants (cascade), expires_at, used_at, reuse_count
```

Indexes: `ai_grants (auth_subject)`, `ai_grants (client_id)` (for tidying registrations),
`ai_refresh_tokens (grant_id)`.

- No event, title, calendar name, account address or provider calendar id is stored.
- Revoking a grant, or allowing the same client again, **deletes** the grant and, by cascade,
  its calendars, codes and refresh tokens. Nothing of ended access is kept.
- A calendar is authorized by `(connection, fingerprint)`. Calendars that appear later are *not*
  authorized. A calendar that disappears at the provider is counted in `removed_calendars`.
- `connection_id` is deliberately not a foreign key: migration 003 rebuilds
  `calendar_connections`' primary key every time the migrations run, and a reference to it would
  make that fail. Instead every read joins on the connection *and* on its person, so a
  disconnected account's calendars stop counting at once; their rows are cleared the next time a
  grant is written. Reconnecting the same account keeps its connection id and so its grants.
- Display visibility (device) and AI access (server) are separate and never read each other.
- One active grant per (person, client): authorizing again replaces the earlier grant.
- **Client label** comes from the *validated redirect host*: `claude.ai` → Claude, `chatgpt.com`
  → ChatGPT, `grok.com`/`x.ai` → Grok, loopback → "An app on this computer", otherwise "Other
  MCP client (host)". A client's self-declared name is never used for a decision.

### Tools (all `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`)

| Tool | Input | Limit |
| --- | --- | --- |
| `list_calendars` | — | — |
| `get_events` | `start`, `end`, `timezone?`, `calendars?` | 31 days |
| `get_schedule` | `date`, `timezone?`, `calendars?` | one day |
| `find_free_time` | `start`, `end`, `duration_minutes`, `timezone?`, `calendars?`, `working_hours?` | 14 days |

All within the existing read window (35 days back, 189 ahead). Every result carries `timezone`
(the zone used), `complete`, `unavailable` (calendars not read at all: handle, name, provider,
reason) and `partly_read` (calendars whose reading stopped before the end of the range: more
events than a reader takes at once, Google 4 × 2,500 or Microsoft 20 × 500 per calendar, or more
than Yahoo and calendar links can work out in time; reason `too_many_events`). `complete` is true
only when both are empty. `find_free_time` adds an explicit warning when incomplete.

**Answer cap: 500** (`MAX_EVENTS_PER_ANSWER`). An answer lists at most 500 events (or free
stretches, or all-day events), the first in time order, with `truncated: true`, the total
(`total_events`, `total_free`, `total_all_day_events`) and a `truncation` note. Truncation is only
about the size of the answer and never changes `complete`, so an assistant can tell three things
apart: a provider failing (`unavailable`), a calendar read only in part (`partly_read`), and a
whole reading too long to list (`truncated`). `get_schedule` applies one cap to the day's whole
list (all-day events first), then splits it. `find_free_time` works out free time from every event
that was read, never from the 500 listed; when anything was not fully read it says so in so many
words. A provider reader that stops early now says so (`cut` on its reading), where before it
returned what it had as though that were all; the app's own reading is unchanged.
Event fields: `event_id` (opaque, per grant), `title`, `start`, `end` (in the zone asked for,
with offset; days for all-day), `all_day`, `calendar` (handle), `calendar_name`, `provider`,
`tentative`. Nothing else: no description, location, attendees, links or account addresses.

- **Free time**: timed events (confirmed and tentative) block; overlaps merge; gaps shorter than
  the duration are dropped; optional working hours per local day. All-day events: see "Decisions".
- **Time zone**: an IANA name, validated. Omitted → the grant's zone, taken from the browser in
  which the person approved access. Never from the AI platform's servers.
- **Recurrence**: the production readers, unchanged.
- **Untrusted text**: titles are cleaned of control characters, cut to 300 characters, returned
  only as JSON strings; tool descriptions say titles are data, not instructions. No HTML, no
  links.

### Limits, caching, logging

- Per grant: 30 tool calls a minute, counted in the grant's row (one count across servers); per
  client, in memory, as a second line. The existing 120 units/minute per connection stays the
  hard limit on what reaches a provider.
- The same reading (connection, calendar, span) within 60 seconds is answered from memory on that
  server, and concurrent identical ones are asked once. Nothing is written down.
- One log line per call: request id, tool, grant id (opaque), duration, how many calendars and
  events, status category. Never titles, names, times, addresses or tokens.

### Koyomi UI

Only for people in the private beta (below). In the Calendars pane, under the accounts: **AI access**. The endpoint to give an assistant, the
list of AI connections (client, read-only, how many calendars, when) with **Revoke**, and two
plain lines: "Koyomi never shares calendars with an AI unless you explicitly authorize it." and
"Local Koyomi events stay on this device and are not shared with AI connections." Revoking ends
that AI's access at once and touches no calendar connection.

### Feature flag

`KOYOMI_MCP=on` (runtime, Production only when it is turned on). Off: `/mcp`, the metadata and
OAuth endpoints, the consent page and the grants API answer 404 and the AI access section is not
shown, for everyone, whatever the allowlist says.

### Private beta allowlist

`KOYOMI_MCP=on` alone lets nobody in. `KOYOMI_MCP_ALLOWLIST` (Vercel, Production only; never in
this repository) lists the 6Away subjects who may use AI access, separated by commas or spaces:
stable ids, never addresses, exact matches only. Unset or empty means nobody. The first beta is
the owner's subject alone.

It is checked everywhere a person meets the feature:

| Where | Not on the list |
| --- | --- |
| Calendars → AI access | not shown: the page asks `/api/ai/grants`, which answers 404 exactly as when the flag is off |
| `/api/ai/grants`, `/api/ai/grants/revoke` | 404, empty body |
| `/api/oauth/authorize`, signed in | straight back to the client with `error=access_denied`, "Access was not granted" |
| `/api/oauth/authorize`, signed out | 6Away sign-in, then `/ai/consent`, which sends them back the same way: no calendar is listed |
| `/ai/consent` opened by address | nothing of theirs; with a pending request, the same refusal |
| `/api/oauth/decision` | 404 |
| Token endpoint (code or refresh) | `invalid_grant`, "Access has been revoked", the same words as a revoked grant; the grant is kept |
| `/mcp` | 401, as for a revoked token |

So taking someone off the list ends their access at the next request, and putting them back
restores it. Nothing says who is on it: refusals use the same words for everyone, the value is a
server setting with no `NEXT_PUBLIC_` name, and the discovery documents are the same for all.
There is no admin screen. The browser tests let their own stand-in people in by a prefix
(`KOYOMI_TEST_AI_ALLOW_PREFIX`), which is ignored on any Vercel deployment.

### Release gates (wider than the private beta)

1. **Google verification and Limited Use.** Koyomi's Google scopes are sensitive scopes under
   Google's Limited Use rules, which forbid transfers to third parties except, among others, for
   user-facing features that are prominent in the app's interface and only with the user's
   consent. Sending a person's chosen Google calendars to the AI client they chose, at their
   request, is meant to be exactly that, and Privacy and the consent page say so. But it is a new
   use of Google data while Koyomi's verification is still being reviewed, and Google requires the
   privacy policy and in-product disclosures to cover it before data is used that way. **AI access
   is not opened beyond the private beta until Koyomi's Google verification and Limited Use
   disclosure position for this use is confirmed** (in the verification resubmission, or by asking
   Google's review team). The private beta is not that confirmation.
2. Private tests in ChatGPT, Claude and Grok, and the cross-client comparison.
3. The migration runner question below, then migration 004 rehearsed and applied.
4. Privacy and Terms dates set at merge.

### Migration 004 and the migration runner (evaluated 2026-11-07; not applied anywhere)

`scripts/migrate.mjs` sends **every** file in `migrations/` on every run, in name order, one
request (one transaction) per file. There is no record of what has been applied. Re-running
001–003 on Production does this:

| File | On a re-run |
| --- | --- |
| 001 | `create table if not exists`: nothing |
| 002 | `alter table … add column if not exists` (twice): nothing changes, but it takes the table's exclusive lock for a moment |
| 003 | in one block: `delete from calendar_connections where provider_account_id is null` (finds nothing today: the column is `not null`); then **`drop constraint calendar_connections_pkey, add primary key (connection_id)`: the live table's primary key is dropped and rebuilt, under an exclusive lock, every time** |
| 004 | `create table if not exists` / `create index if not exists` in one block: nothing on a second run |

Nothing is lost by it today: 003 runs as one transaction, so the key is never left missing, and
with a handful of rows it takes milliseconds. But it is destructive DDL on the live table that
004 does not need, run for no reason; and it is why no table may ever reference
`calendar_connections` (the drop would fail and stop every later file). Applying 004 through it
means doing that on Production. **So 004 is not rehearsed or applied until the runner is
corrected.** Proposed, smallest first:

1. **`--only <file>` in `scripts/migrate.mjs`** (a few lines): apply exactly the named file(s),
   refusing any name not in `migrations/`. Production path for 004:
   `npm run db:migrate -- --only 004_ai_access.sql --yes`. Nothing historical is re-run.
2. *Optional hardening:* make 003 a true no-op on a re-run, guarding its key swap with a check
   that the primary key is not already `(connection_id)`. Then the plain command is safe too, and
   a reference to `calendar_connections` becomes possible later.
3. *Not proposed now:* a ledger table of applied migrations. Sounder in the long run, but larger,
   and it needs a first write to Production to record 001–003.

Then, before Production: a disposable Neon branch of Production (made in the Neon console or
with an API key; `neonctl` hangs on this machine), the exact command run on it twice, with
`calendar_connections`' row count and a schema snapshot taken before, between and after.
**Rollback:** `drop table ai_refresh_tokens, ai_codes, ai_grant_calendars, ai_grants, ai_clients;`
(one statement; nothing outside these five refers to any of them, and no other table changes).

### What stays local

Koyomi's own events stay in the browser. They are not readable through MCP, not synced, not
stored on the server.

### Decisions (confirmed by the owner, 2026-11-07)

1. **All-day events in free time.** Google and Microsoft both treat most all-day events as
   "free" (birthdays, holidays), and Koyomi does not read their busy/free flag. They do not block
   time, but every all-day event in the range is returned beside the free intervals so the
   assistant can mention it; a `treat_all_day_as_busy` input lets it choose otherwise.
2. **Default time zone.** The zone of the browser in which the person approved access, stored
   with the grant, and named in every answer.

---

## Part 3: acceptance so far

### Automated

- `tests/unit/ai.test.ts`: tokens (audience, expiry, forgery, key), PKCE (RFC 7636 vector),
  redirect manipulation (trailing slash, query, look-alike hosts, ports, fragments), client
  naming by redirect host, metadata documents (self-naming, public client), registration,
  the authorization request (page vs redirect, `iss`, `state`, `resource`), codes (once,
  client, redirect, verifier, expiry, replay ending the grant), refresh rotation and reuse,
  revocation (own client only, the person's own only), the grant allowance, both stores
  (Postgres via PGlite on the real migrations, and memory), migration 004 storing nothing about
  events, time zones (Dubai, London and New York across DST, 25-hour days), free time, partial
  failure, bounds, hostile titles (instruction, markup, control and bidi characters, 5,000
  characters, Unicode, empty), duplicate ids across accounts, all-day spans, recurrence, and
  that the tool code can only read. Since the corrections: the allowlist (exact subjects,
  nobody when empty, the test prefix dead on Vercel, codes and refreshes refused outside it);
  the refresh grace to the second with a given clock (a lost answer retried, three at once, five
  at once, the boundary at 30 s, a day later, expiry), on both stores; tidying registrations
  (never used, used, touched within the hour, named by a grant, after revoking), on both stores;
  the 500 cap (over, exactly at, a crowded day, free time from every event, more than 500 free
  stretches) and `partly_read` told apart from `unavailable` and `truncated`.
- `tests/unit/sw.test.ts`: the real `public/sw.js` in a stand-in worker scope with no network:
  `/ai/…` pages and their data requests are left to the network, `/` still opens from the cache.
- `tests/unit/server.test.ts`, `microsoft.test.ts`: a Google or Microsoft reading stopped at its
  page limit says `cut`.
- `tests/e2e/ai.spec.ts`: the whole flow in a browser against the stand-ins with the official
  MCP client, on 2026-07-28 and on the 2025 handshake; refreshing over the real token endpoint
  (two at once, retries, the copy that ends access); someone outside the allowlist (no AI access
  in Calendars, 404s, refused back to the assistant signed in and signed out, no calendar ever
  listed). `tests/e2e/pwa.spec.ts`: with the worker in charge, `/ai/consent` comes from the
  server, never the worker.

### MCP Inspector (2.14.0, CLI), against the production build with the stand-ins

(Run at `5badfb0`, before the corrections; to be run again on the corrected build.)

| Check | Result |
| --- | --- |
| Discovery and every schema (`tools/list --strict`) | 4 tools, all `readOnlyHint`, no portability problems |
| Authentication | bearer token from the real consent flow accepted; no token gives the 401 challenge, and the Inspector starts OAuth from it |
| `list_calendars` | the 2 chosen calendars only, `complete: true`, default zone Asia/Dubai |
| `get_schedule` in Asia/Dubai, Europe/London, America/New_York | the same 4 events, each in that zone's offset; all-day apart |
| `find_free_time` 60 min, 09:00–18:00 | 10:30–13:00, 14:00–15:00, 16:00–18:00; the all-day event listed |
| Invalid arguments (bad date, 3-minute duration) | refused by the schema |
| 80-day range, `Mars/Olympus`, unknown calendar handle | `range_too_long`, `invalid_timezone`, `unknown_calendar` |
| Provider failing | `complete: false`, the warning, the calendars named |
| Malicious title | returned as plain text in its place; nothing else changed |
| 40 calls in a row | 29 answered, 11 `rate_limited` (30 a minute for the grant) |
| Revoked by the client (RFC 7009) | the next request is 401 |
| Server log | 113 `[mcp]` lines: no title, address or token in any |

### Still to do (needs a public deployment; see the PR)

The runner correction and migration 004 (above); the MCP Inspector again on the corrected build;
ChatGPT, Claude and Grok private connectors (Grok stays a target: its documentation describes
custom MCP connectors with required authentication; only if real testing shows it needs a
manually pasted long-lived token is it dropped); the cross-client comparison; the real
multi-provider acceptance with the owner's accounts; the release gates above.
