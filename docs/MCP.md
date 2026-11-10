# Koyomi for AI assistants (remote MCP, read-only)

Koyomi already reads every calendar a person connects — several Google accounts, Microsoft,
Yahoo, calendar links — and turns them into one kind of event. This is the same thing offered to
an AI assistant: one connection to Koyomi instead of one per provider.

> For people: all your calendars, one quiet place. For AI: all your calendars, one connection.

One standards-based remote MCP server, used unchanged by ChatGPT, Claude and Grok. Read-only,
behind OAuth, switched off unless `KOYOMI_MCP=on`. This document is the audit of `main` it was
designed from (`10db829`, 2026-11-07), then the design, then its acceptance: automated (Part 3)
and in ChatGPT, Claude and Grok on Production (Part 4). Public release:
[MCP_PUBLIC_READINESS.md](MCP_PUBLIC_READINESS.md).

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
  same-origin only. Since Phase 8A the page also says:
  - who asked, and the host the answer goes to;
  - which 6Away account is signed in, with **"Not you? Sign out"**. That is a third answer
    beside Allow and Cancel, with a form of its own so that Enter never submits it. It ends the
    request (the cookie is cleared, nothing is granted, and the assistant is sent nothing), then
    signs out of Koyomi and of 6Away (RP-initiated logout, back to the app). The person then
    connects again from the assistant. 6Away cannot send someone back to the consent page after
    logout: its post-logout addresses are fixed per client.
  - that an assistant may ask whenever it chooses while access lasts, not only when the person
    asks it something;
  - exactly which calendars are chosen, by name, as they are ticked;
  - when a Google calendar is ticked, a note on Google data: Koyomi sends it only to answer the
    person, as Limited Use allows, and never trains on it; the assistant's company's own terms
    and settings govern what happens next. It is a notice, never a box to tick.
  
  A person with nothing connected gets a link that opens Calendars in a new tab
  (`/?calendars=open`), and can reload the same request within its ten minutes.
- **Codes**: 256-bit random, stored as an HMAC hash, single use, 5 minutes, bound to client,
  redirect URI, PKCE challenge, resource and grant. A second use revokes the grant.
- **Access tokens**: `ka1.<payload>.<HMAC>` — grant id, client id, audience (the MCP URL),
  expiry (15 minutes). Every request also loads the grant: revoked, missing, wrong client or
  wrong audience → 401. Revocation is immediate.
- **Refresh tokens**: stored hashed, 30 days, rotated on every use. A grant's first is 256-bit
  random; each later one is **the one successor** of the token it replaces (`successorOf`: an HMAC
  of that token under a key of its own, 256 bits, indistinguishable from a random one). A
  just-replaced token gets a **grace of 30 seconds and at most 3 more uses**
  (`REFRESH_GRACE_SECONDS`, `REFRESH_GRACE_REUSES`): each is answered with a new access token and
  **the same successor**. That covers an answer lost on the way (the client retries with the same
  token) and a client's servers refreshing at once, and a grant still has one line of refresh
  tokens, never two: a copy replayed within the grace joins the owner's line instead of starting
  its own, and as soon as the two holders part (one uses a token the other already used, after
  its grace) the grant ends. After the grace, or beyond the count, the token is spent for good
  and coming back revokes the grant and every token of it. The database decides which use is
  first (one `update … where used_at is null`), so of any number of uses at once exactly one is
  first; the successor is saved once (`on conflict do nothing`, never made unused again); if a
  copy coming back ends the grant while another refresh is being answered, that one gets
  `invalid_grant`, never a token of an ended grant. (Until 2026-11-08 each grace answer had a new
  random successor, which let a copy replayed within the grace keep a line of its own: Vercel
  Security Review finding 01M6VGQ6J, fixed.) What a replay within the grace still gets is one
  15-minute access token: the price of any grace window.
- **Keys**: derived from `TOKEN_ENCRYPTION_KEY` with their own labels (as `fingerprint()` does).
  No new secret.

### Grants and calendar permissions (migration 004)

```
ai_clients         client_id, redirect_uris, client_name (display only), created_at,
                   last_used_at                                                          (DCR only)
ai_grants          grant_id, auth_subject, client_id, client_label, redirect_host, time_zone,
                   created_at, last_used_at, window_started_at, window_spent
ai_grant_calendars grant_id → ai_grants (on delete cascade), connection_id,
                   calendar_fingerprint                (an HMAC of the calendar id, keyed to the connection
                                                        and the account it is for; never the id)
ai_codes           code_hash, grant_id → ai_grants (cascade), client_id, redirect_uri, code_challenge, resource, expires_at, used_at
ai_refresh_tokens  token_hash, grant_id → ai_grants (cascade), expires_at, used_at, reuse_count
```

Indexes: `ai_grants (auth_subject)`, `ai_grants (client_id)` (for tidying registrations),
`ai_refresh_tokens (grant_id)`.

- No event, title, calendar name, account address or provider calendar id is stored.
- Revoking a grant, or allowing the same client again, **deletes** the grant and, by cascade,
  its calendars, codes and refresh tokens. Nothing of ended access is kept.
- A calendar is authorized by `(connection, fingerprint)`, and the fingerprint is made with the
  connection's account (`accountKey`) as well as its id: what the person allowed is that
  account's calendar. A connection pointed at another account while keeping its id ("Update
  link" on a calendar link, whose one calendar always has the same id) no longer matches: the
  assistant sees it as removed and reads nothing of the new feed until the person allows it
  again; every read also checks the connection is still for that account (`reading(…, account)`),
  and what is kept in memory for a minute is kept per account. So updating a link, even to a
  reset address of the same calendar, means allowing the assistant again. (Vercel Security Review
  finding 01M6V1S28, fixed 2026-11-08; `ai.spec.ts` "a calendar link given a new address".)
  Calendars that appear later are *not* authorized. A calendar that disappears at the provider is
  counted in `removed_calendars`.
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
Event fields: `title`, `start`, `end` (in the zone asked for, with offset; days for all-day),
`all_day`, `calendar` (handle), `calendar_name`, `provider`, `tentative`. Nothing else: no
description, location, attendees, links, account addresses or identifier. (Until Phase 8A each
event also carried `event_id`, an opaque per-grant handle. No tool takes an event as input, so it
served the person nothing, and OpenAI's plugin rules ask that answers carry no internal ids: it
was removed. Calendar handles stay, because the tools' `calendars` input takes them.)

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
   use of Google data, and Google requires the privacy policy and in-product disclosures to cover
   it before data is used that way. **AI access is not opened beyond the private beta until
   Koyomi's Limited Use disclosure position for this use is settled.** The private beta is not
   that confirmation.

   Update, 10 November 2026: the Google Cloud console shows Koyomi's branding and data access
   verified and the app in production. That verification covers the calendar as submitted,
   before AI access existed.

   What remains:
   - the mandatory Privacy and consent changes (the AI/ML affirmation, accurate consent wording,
     help documentation);
   - Google's answer on whether an assistant's own training, after Koyomi's transfer, falls on
     Koyomi. ChatGPT's consumer plans train on app data by default. Until Google answers, Google
     calendars stay out of AI access for anyone not on the allowlist.

   See [MCP_PUBLIC_READINESS.md](MCP_PUBLIC_READINESS.md), section 2.
2. Private tests in ChatGPT, Claude and Grok, and the cross-client comparison (done
   8–10 November 2026, passed: Part 4).
3. Migration 004 rehearsed on a disposable Neon branch with `--only` (done 2026-11-08, passed),
   then applied to Production with the same command (done 8 November 2026; below).
4. Privacy and Terms dates set at merge (8 November 2026).

### Migration 004 and the migration runner (evaluated 2026-11-07; `--only` added 2026-11-08; 004 applied to Production 8 November 2026)

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
means doing that on Production. So 004 was held until the runner was corrected.

**Decided by the owner (2026-11-08):** `--only <file>` is added; migration 003 is **not**
changed (it is a historical migration already applied, and is not rewritten as part of this
release); a broader cleanup of the runner (a ledger of applied files, a re-runnable 003) is
separate technical debt, not this release.

**`--only`** (`scripts/migrate.mjs`, logic in `scripts/migrate-core.mjs`, tests in
`tests/unit/migrate.test.ts`):

- takes exactly one file name that is in `migrations/`, compared exactly (no path, no
  `..`, no absolute path, no other case, nothing missing or added); `--only` given twice, with
  nothing after it, or as `--only=…` is refused;
- refuses any argument it does not know, so a typo cannot fall back to sending every file;
- refuses before reading `DATABASE_URL` or reaching a database, with exit code 2 and
  "Nothing was sent to any database.";
- says which database (host and database name, never the whole address), which file it sends,
  and which it does not run, then `applying …` / `applied …`;
- without `--only`, the command is what it was: every file in order with `--yes`, nothing
  without it.

**Production path for 004, and the only one for this release:**

```sh
DATABASE_URL="<Production>" npm run db:migrate -- --only 004_ai_access.sql          # check the host it names
DATABASE_URL="<Production>" npm run db:migrate -- --only 004_ai_access.sql --yes
```

Never the plain `--yes` against Production: that sends 001–003 again.

**Before Production:** the same command on a disposable Neon branch made from Production's
current state, run twice, with `calendar_connections`' row count, its primary key's identity,
a digest of its rows and a schema snapshot taken before, between and after; then the rollback
on the branch, then the branch deleted. Results under "Rehearsal" below. `neonctl` hangs on this
machine; the branch is made in the Neon console.
**Rollback:** `drop table ai_refresh_tokens, ai_codes, ai_grant_calendars, ai_grants, ai_clients;`
(one statement; nothing outside these five refers to any of them, and no other table changes).

**Rehearsal (2026-11-08), passed.** Disposable branch `rehearsal-004-2026-11-08` of Production's
`main`, made in the Neon console with its data as of that moment (auto-delete after a day as a
safety net), deleted after the run. The exact command, `npm run db:migrate -- --only
004_ai_access.sql --yes`, run against the branch's own endpoint with Production's role (a branch
is a whole copy, roles included; the address came from Vercel into that one process, was never
printed or written down, and the script refused Production's endpoint and never connected to
it). Results:

| Check | Result |
| --- | --- |
| Before | `calendar_connections`: 9 rows; table oid 16748; primary key `(connection_id)`, index oid 24585, constraint oid 24586; 25 schema lines; no duplicate index or constraint |
| First run | "Only 004_ai_access.sql. Not run: 001…, 002…, 003…", exit 0. Schema diff +76 −0, every line on the five `ai_*` tables (columns, 8 indexes, constraints), none on `calendar_connections`. `calendar_connections`: same table, key index and constraint oids, rows, row digest and row versions. AI tables empty |
| Second run | the same output, exit 0; diff +0 −0; everything identical to the first run; no duplicate index or constraint |
| Rollback | `drop table ai_refresh_tokens, ai_codes, ai_grant_calendars, ai_grants, ai_clients;` brought the schema back exactly (diff +0 −0, every check identical to "before") |
| Production | not connected to, not changed |

**Applied to Production on 8 November 2026** (10:38:37 UTC), once, with exactly
`npm run db:migrate -- --only 004_ai_access.sql --yes`, before PR #35 was merged and with
`KOYOMI_MCP` unset. Target confirmed first: Production's `DATABASE_URL` names compute
`ep-cold-river-b7hmnqw0`, which the Neon console lists under the `main` branch of
`koyomi-production`, and a dry run without `--yes` named the same host. Results:

| Check | Result |
| --- | --- |
| Runner output | "Only 004_ai_access.sql. Not run: 001…, 002…, 003…", `applying` / `applied 004_ai_access.sql`, exit 0 |
| `calendar_connections` | 9 rows before and after; table, primary key index, primary key constraint and unique index oids unchanged (16748, 24585, 24586, 24587); whole-row and row-version digests identical; no row written meanwhile |
| Schema | +76 −0, every line on the five `ai_*` tables, identical line for line to the rehearsal; no duplicate index or constraint; the five tables empty |
| The live site | the same deployment; 17 routes (site, app, policies, manifest, worker, calendar API, every AI route) answered the same status and body before and after |

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
  the refresh grace to the second with a given clock (a lost answer retried and given the same
  successor, three at once, five at once, a copy replayed within the grace joining the owner's
  line and the grant ending when they part, two grace answers unable to keep two lines, the
  boundary at 30 s, a day later, expiry), on both stores; tidying registrations
  (never used, used, touched within the hour, named by a grant, after revoking), on both stores;
  the 500 cap (over, exactly at, a crowded day, free time from every event, more than 500 free
  stretches) and `partly_read` told apart from `unavailable` and `truncated`.
- `tests/unit/migrate.test.ts`: the migration runner. `--only 004_ai_access.sql` sends 004 and
  nothing else; refusals (unknown names, other case, `../`, `migrations/…`, absolute Windows and
  POSIX paths, a missing name, two names, `--only=…`, typos) reach no database and exit 2; the
  plain command still sends every file in order. On Postgres (PGlite) from "Production today"
  (001–003 and rows): five tables added, `calendar_connections`' table, primary key index and
  constraint, rows and row versions unchanged, the second run identical, no duplicate index or
  constraint, the rollback back to the starting schema; and, for contrast, the plain command
  giving the primary key a new identity.
- `tests/unit/sw.test.ts`: the real `public/sw.js` in a stand-in worker scope with no network:
  `/ai/…` pages and their data requests are left to the network, `/` still opens from the cache.
- `tests/unit/server.test.ts`, `microsoft.test.ts`: a Google or Microsoft reading stopped at its
  page limit says `cut`.
- `tests/unit/mcp-log.test.ts`: the `[mcp]` log line is written once the answer has been sent,
  with the real SDK handler on the 2025 handshake (which hands back the response before a slow
  tool has finished), and exactly once for an empty body, a whole one, a client that goes away
  and a body that fails.
- `tests/e2e/ai.spec.ts`: the whole flow in a browser against the stand-ins with the official
  MCP client, on 2026-07-28 and on the 2025 handshake; refreshing over the real token endpoint
  (two at once, retries, the copy that ends access); someone outside the allowlist (no AI access
  in Calendars, 404s, refused back to the assistant signed in and signed out, no calendar ever
  listed); a calendar link given a new address (the assistant's token reads nothing of the new
  feed, over a range it never asked about, until the person allows it again; without the fix
  this test fails). `tests/e2e/pwa.spec.ts`: with the worker in charge, `/ai/consent` comes from
  the server, never the worker.

### MCP Inspector (2.14.0, CLI), against the production build with the stand-ins

Run again on 2026-11-08 on the corrected build, signed in as a stand-in person on the
allowlist: after the log fix, and once more after the two Security Review fixes, with the same
results. The first run was at `5badfb0`, before the corrections, with the same
results for the rows they share.

| Check | Result |
| --- | --- |
| Discovery and every schema (`tools/list --strict`) | 4 tools, all `readOnlyHint`, no portability problems |
| Authentication | bearer token from the real consent flow accepted; no token gives the 401 challenge, and the Inspector starts OAuth from it |
| `list_calendars` | the 2 chosen calendars only, `complete: true`, default zone Asia/Dubai |
| `get_schedule` in Asia/Dubai, Europe/London, America/New_York | the same 4 events, each in that zone's offset; all-day apart |
| `get_events`, one day | 5 events, `complete: true`, `truncated: false`, nothing `unavailable` or `partly_read` |
| `find_free_time` 60 min, 09:00–18:00 | 10:30–13:00, 14:00–15:00, 16:00–18:00; the all-day event listed |
| Invalid arguments (bad date, 3-minute duration) | refused by the schema |
| 80-day range, `Mars/Olympus`, unknown calendar handle | `range_too_long`, `invalid_timezone`, `unknown_calendar` |
| Provider failing | `complete: false`, the warning ("Not every calendar could be fully checked…"), free time only "in what was read" |
| Malicious title | returned as plain text in its place; nothing else changed |
| 600 events in 7 days (one calendar) | `get_events`: 500 listed (Slot 1 to Slot 500, in time order), `truncated: true`, `total_events: 600`, `complete: true`, the note; `get_schedule` for its first day: 96 events, not truncated |
| Free time over those 600 | `free: []` for 30 minutes across the 6 days the events fill. Worked out from the 500 listed alone, the last ~19 hours would have looked free |
| 40 calls in a row | 29 answered, 11 `rate_limited` (30 a minute for the grant) |
| Revoked by the client (RFC 7009) | the next request is 401 `invalid_token`; its refresh token `invalid_grant`; another grant's token still answers |
| Server log | 110 `[mcp]` lines; every tool call's outcome in its line (`get_events:ok:e500:t`, `find_free_time:incomplete:e1`, `get_events:refused:unknown_calendar`, `list_calendars:rate_limited`); no token, title, calendar name, calendar id or account in any line of the log |

**Found by this run, and fixed:** on the 2025 handshake (which the Inspector uses) the SDK
answers with an event stream that is still being written when it hands the response back,
whatever `responseMode` says; `/mcp` wrote its log line then, so every call that had to read
calendars first was logged with no outcome. The line is now written when the answer has been
sent (`lib/server/ai/sent.ts`; `tests/unit/mcp-log.test.ts` drives the real SDK handler). Answers
and access were never affected.

---

## Part 4: private acceptance on Production (8–10 November 2026)

The same server, unchanged per assistant, passed private acceptance in ChatGPT, Claude and Grok
on Production. Each assistant was added by the owner as a private, unpublished connector in
their own browser and authorized through Koyomi's ordinary consent page. Nothing was submitted
to any directory, and nothing in this part names a person, an account or a real event.

### Production during acceptance

On 8 November 2026 `KOYOMI_MCP=on` and `KOYOMI_MCP_ALLOWLIST` were set in Vercel Production only.
The allowlist holds exactly one 6Away subject, the owner's. It was taken from the database, never
printed, and is not recorded here. Preview and Development have neither setting.

| Assistant | Date | Production commit | Deployment |
| --- | --- | --- | --- |
| ChatGPT | 8 Nov 2026 | `9adffe9` (PR #35) | `dpl_EgVFUfGUjRdN2nLGGqTEui5yCVCc` |
| Claude | 8 Nov 2026 | `9adffe9`, then `e6feaef` (PR #36) | `dpl_EgVFUfGUjRdN2nLGGqTEui5yCVCc`, then `dpl_4TEYpaktJhbjuaxzHEDgKMJPxWnb` |
| Grok | 10 Nov 2026 | `e6feaef` | `dpl_4TEYpaktJhbjuaxzHEDgKMJPxWnb` |

`dpl_EgVF…` is `9adffe9` redeployed with the two settings. `dpl_4TEY…` is PR #36's merge, with
the settings carried over. It is still Production on 10 November 2026: that day, all four tools
were called again through the Claude connector on it, and their answers matched the test
calendar exactly.

Before any assistant connected, `dpl_EgVF…` was checked:

- Discovery (RFC 9728 in both forms, RFC 8414) answered.
- `/mcp` gave the 401 challenge for no token, a junk token, a forged token and a token in the
  query string.
- The owner's consent page listed their calendars with none ticked. Cancel returned
  `access_denied`.
- A second, real Koyomi user with connections of their own was refused at every step, in a clean
  browser:
  - authorize gave `access_denied`, and the consent page said "This request has ended";
  - decision and the grants API gave 404, the token endpoint `invalid_grant`, and `/mcp` 401;
  - none of the owner's connections could be read with their session.

### Test data

Every grant was given one synthetic Google calendar, "Koyomi Test", made for these tests. It
holds 32 events titled "Koyomi test …". They are timed and all-day events over two weeks. One
carries notes and a place, which must never be returned. One has a title written as an
instruction to the assistant.

One local Koyomi event was made on the owner's device, to show that device-only events never
reach an assistant. For ChatGPT's first run the owner chose to share all their calendars (13,
over Google and a calendar link). That grant was revoked, and ChatGPT reconnected with Koyomi Test
only.

The same five questions were put to each assistant, with answers checked against the calendar:

| Question | What a pass needs |
| --- | --- |
| Which calendars can you access through Koyomi? | Koyomi Test, nothing else |
| What do I have tomorrow? | that day's test events, each once, at the right local times |
| Find 90 minutes free tomorrow between 9 and 6 | the gaps between those events, exactly |
| What is my next meeting? | the earliest one, even though its title says "test" |
| A meeting that is only on a calendar not shared | not found through Koyomi |

### How each assistant connects

Every assistant used the same endpoint (`https://app.koyomi.guru/mcp`) and PKCE S256. Each was a
public client with no secret, and had `resource` and `iss` checked. Refresh tokens were rotated.
They differ in how they identify themselves:

| | ChatGPT | Claude | Grok (grok.com) | Grok Bot |
| --- | --- | --- | --- | --- |
| Client registration | metadata document (CIMD) `https://chatgpt.com/oauth/client.json` | metadata document (CIMD) `https://claude.ai/oauth/mcp-oauth-client-metadata` | dynamic registration (DCR) as "Grok": **a new client on every connection** | dynamic registration as "Cursor": **three clients per connection** |
| Redirect | `https://chatgpt.com/connector_platform_oauth_redirect` (one fixed address) | `https://claude.ai/api/mcp/auth_callback` | `https://grok.com/connectors-oauth-exchange-code/` (trailing slash) | `https://www.cursor.com/agents/mcp/oauth/callback`, and `http://localhost:8787/callback` |
| Named in Koyomi | ChatGPT | Claude | Grok | Other MCP client (www.cursor.com) |
| Where it is added | Plugins: add a custom MCP server, OAuth | Connectors: add a custom connector | Connect Apps: new custom connector | the bot's own connector settings |
| Disconnecting in the assistant | not checked | **does not revoke at Koyomi**: the grant stays until revoked in Koyomi | **does not revoke at Koyomi** (no RFC 7009 call) | not checked |
| After a Koyomi revoke | refresh refused; ChatGPT asks to reconnect | 401; Claude reconnects through consent | refresh refused; tools gone; "Reauthenticate" gives a new grant | (not connected by then) |

Grok Bot is a separate surface from grok.com, with its own connection and grant. The first Grok
answers came from it, not from grok.com. So for every run, the grant that made the calls was
read from the log before its answers were accepted. Grok's own built-in Google Calendar
connector can also answer calendar questions while it is switched on, so for Grok the answer's
source has to be checked too.

The 2026-07-28 client in Claude opens a `subscriptions/listen` stream for tool changes. Until
PR #36 the server advertised `listChanged: true` and held that stream open until Vercel ended
the function. That gave one 300-second timeout per Claude session, with no effect on any answer.
Since `e6feaef` the stream is answered and closed at once. A Claude session after the deploy had
no timeout.

### Results

All four tools (`list_calendars`, `get_schedule`, `get_events`, `find_free_time`) answered on
Production for each assistant. Each assistant chose which tool to call for which question.

| Check | ChatGPT | Claude | Grok |
| --- | --- | --- | --- |
| Calendars listed | only those granted (13, then 1) | Koyomi Test only | Koyomi Test only |
| Tomorrow's events, times in Dubai | correct | correct | correct |
| 90 minutes free | exactly the gaps | exactly the gaps | exactly the gaps |
| Next meeting | correct; it left out "test" events when asked to choose | the earliest, a test event, not skipped | correct |
| Calendar not shared | not obtained | not obtained | not obtained |
| Instruction-like title | reported as a title, not followed | reported as data | reported as data |
| Notes, places, guests | never returned | never returned | never returned |
| Calendar link address, credentials | never returned | never returned | never returned |
| Local Koyomi event | never seen | never seen | never seen |

Three things are the assistants' own, not Koyomi's:

- ChatGPT folded the same test event seen through two accounts.
- ChatGPT chose to pass over events titled "test" when picking the next meeting.
- Answers are in each assistant's words.

The data the tools returned was correct in every case. In the Claude case it was read raw: the
same connector also appeared in a Claude Code session and was called there. Calendars and events
come back as opaque handles (`cal_…`, `ev_…`) that differ per grant, with no provider id, link
or token.

### Isolation, independent grants and revocation

- **One grant per assistant.** Three grants by the end, one each for ChatGPT, Claude and Grok,
  each covering Koyomi Test only. Koyomi's AI access section lists them separately, by name.
  No assistant can use another's token: tokens are bound to their grant and client.
- **Per-grant calendars.** Each grant holds its own list, chosen on the consent page, and the
  handles each grant sees are its own. A grant cannot be edited in place: choosing other calendars
  means connecting again. That makes a new grant and leaves the others as they were.
- **Revocation.** Revoking in Koyomi ends that grant at its next request (401) and its refresh
  (`invalid_grant`). This was done for ChatGPT, Claude and Grok in turn. Each reconnected through
  the consent page and got a new grant with new handles. Revoking one never touched another:
  after Claude's revoke, ChatGPT's refresh and next call still worked; after Grok's, Claude's
  grant still answered.
- **Someone else.** A second real Koyomi user was refused everywhere (above). Nothing of theirs
  was visible to the owner's grants, and nothing of the owner's was visible to them.
- **What is stored.** The AI tables (migration 004) have no column that can hold event content.
  Their rows were read after each step: grants, calendar fingerprints, client registrations,
  hashed tokens and codes, and nothing else.
- **Logs.** Each `[mcp]` line names the tool and its outcome, never a title, calendar, account or
  token. A credential scan of the runtime log after each step found nothing. There was no 5xx
  after PR #36.

### Fixes that came from acceptance

| Found | Fix |
| --- | --- |
| Claude's tool-change subscription held each function for 300 s | PR #36, `e6feaef`: `listChanged: false` (above) |
| On the 2025 handshake the `/mcp` log line was written before the answer finished, so it had no outcome (MCP Inspector, before merge) | `615b4f3`: logged once the answer is sent |
| Vercel Security Review, before merge: refresh grace could mint independent token lines, and a calendar link given a new address kept its AI permission | `b14e58a`: one successor per token; calendar permission keyed to the connection's account |

### Known limitations

1. **Revoking in the assistant is not revoking in Koyomi.** Claude and Grok, at least, only stop
   using the connection. The grant ends when it is revoked in Koyomi, or when its refresh token
   expires after 30 days unused.
2. **Grok registers a new client on every connection, and Grok Bot registers three.** Unused
   registrations are removed after 7 days, idle ones after 90. Grok Bot is shown as "Other MCP
   client (www.cursor.com)", because its callback is Cursor's.
3. **The same calendar through two connected accounts is listed twice**, and its events come
   twice. Koyomi does not merge them.
4. **The AI access section appears only where Koyomi has the person's calendars on that
   device.** On a device that is only signed in, it is not shown, so there is nowhere there to
   revoke from.
5. **The consent page did not say which 6Away account is signed in.** During acceptance a
   browser signed in to a different 6Away account was refused, as the allowlist intends. Nothing
   on the page explained why. *Addressed in Phase 8A:* the page names the signed-in account and
   offers "Not you? Sign out". An account outside the allowlist is still refused before the
   page, with the same words for everyone.
6. **A person with no calendars reached a dead end** on the consent page. It told them to
   connect one first, but gave no link. *Addressed in Phase 8A:* a link opens Calendars in a
   new tab, and the same request can be reloaded within its ten minutes.
7. **Microsoft and Yahoo were not exercised through an assistant on Production:** the owner's
   account has no such connection. Google and calendar links were. All four providers are
   covered by the automated tests with stand-ins. A provider failing mid-answer (`complete:
   false`) is likewise tested with stand-ins and by the Inspector, not on Production.
8. **The per-client limit is per server instance and shared by everyone using that assistant**:
   300 calls a minute per client. ChatGPT and Claude each use one client id for all their users.
   Dynamic registration is limited to 60 a minute per instance, for everyone. Both are fine for a
   private beta and are reviewed for public use in
   [MCP_PUBLIC_READINESS.md](MCP_PUBLIC_READINESS.md).
9. **An assistant's calendars cannot be changed in place.** The AI access section offers Revoke.
   To share other calendars, a person connects the assistant again.

### Still to do

Public release is not started. The allowlist stays at one person, and no listing has been
submitted. What a public release needs is in
[MCP_PUBLIC_READINESS.md](MCP_PUBLIC_READINESS.md). It covers:

- the onboarding gaps above;
- the per-client limit;
- the Limited Use wording for this use of Google data (release gate 1; Koyomi's Google app itself
  is verified and in production);
- a reviewer account;
- each platform's submission.

---

## Part 5: public plugin preparation, Phase 8A (feature branch, not merged)

This prepares Koyomi for a directory submission. **It does not open AI access**: the allowlist,
OAuth, grants, tokens, limits and Google's settings are unchanged.

| Change | Where |
| --- | --- |
| **Privacy:** the assistant chosen per calendar *and per assistant*; that it may ask whenever it chooses while access lasts; no event identifier; Koyomi's part and the assistant's company's part; Google's sending bound by Limited Use; Google's AI/ML statement in its words; the Workspace Limited Use sentence; what Koyomi cannot promise for another company; Grok's new registration on every connection. The sentence leaving training to the assistant's company "not by Koyomi" is gone. Dated 10 November 2026 (to be set again at merge) | `app/privacy/page.tsx` |
| **Consent page:** see "Consent" in Part 2 | `components/AiConsent.tsx`, `app/ai/consent/page.tsx`, `app/api/oauth/decision/route.ts` |
| **Help page** `koyomi.guru/help`, a page of the site. `app.koyomi.guru/help` redirects there (308), and the site's footer links it: connecting calendars and assistants, choosing, revoking, removing in the assistant, removing calendars, data and deleting it, Microsoft work accounts, contact | `app/help/page.tsx`, `next.config.ts`, `components/SiteFooter.tsx` |
| **`/?calendars=open`** opens Calendars and nothing else (for the help page and the consent page) | `components/Kayomi.tsx` |
| **OpenAI domain verification:** `/.well-known/openai-apps-challenge` (rewritten to `/api/openai-apps-challenge`). It serves the value of the server setting `OPENAI_APPS_CHALLENGE`, as plain text, exactly. Unset, empty, or not a plain token: 404 with nothing in it. Any host (the MCP host `app.koyomi.guru` is the one OpenAI checks); `no-store`. **No token is set anywhere yet** | `lib/server/openai-challenge.ts`, `app/api/openai-apps-challenge/route.ts` |
| **Reviewer calendars:** "Koyomi Demo — Work" and "Koyomi Demo — Personal", synthetic weekly events from January 2026 with no end. They are published as calendar links at `https://koyomi.guru/demo/koyomi-demo-work.ics` and `…/koyomi-demo-personal.ics`. Koyomi refuses only its own app host for links, so the site's host is the one to use. They cover recurrence, a tentative event, overlaps within and across calendars, all-day events, and events written in London, New York and Tokyo (across both countries' clock changes). One event has notes and a place that are never sent | `public/demo/` |
| **MCP output:** `event_id` removed (Part 2, "Tools"); `eventIdFor` and its key gone | `lib/server/ai/tools.ts`, `mcp.ts`, `read.ts`, `config.ts` |

Tests:

- `tests/unit/openai-challenge.test.ts`
- `tests/unit/demo-calendars.test.ts` (the files read as Koyomi reads a link, and answered by the
  tools)
- `tests/unit/routing.test.ts`
- `tests/unit/ai.test.ts` (events carry no identifier)
- `tests/e2e/ai.spec.ts`: the consent page, "Not you? Sign out", the no-calendar path, and the demo
  calendars subscribed by link and read through MCP
- `tests/e2e/site.spec.ts`: Privacy, Help, hosts, the challenge address, the demo files
