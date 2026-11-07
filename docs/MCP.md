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
    rule. The service worker ignores `/api/`; the OAuth endpoints live under `/api/oauth/`.
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
    `client_id` (random), `redirect_uris`, and a display name it never trusts.
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
- **Refresh tokens**: 256-bit random, stored hashed, 30 days, rotated on every use; reuse of a
  spent one revokes the grant.
- **Keys**: derived from `TOKEN_ENCRYPTION_KEY` with their own labels (as `fingerprint()` does).
  No new secret.

### Grants and calendar permissions (migration 004)

```
ai_clients         client_id, redirect_uris, client_name (display only), created_at       (DCR only)
ai_grants          grant_id, auth_subject, client_id, client_label, redirect_host, time_zone,
                   created_at, last_used_at, revoked_at, window_started_at, window_spent
ai_grant_calendars grant_id → ai_grants, connection_id → calendar_connections (on delete cascade),
                   calendar_fingerprint                (an HMAC of the calendar id; never the id)
ai_codes           code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, expires_at, used_at
ai_refresh_tokens  token_hash, grant_id, expires_at, used_at
```

- No event, title, calendar name, account address or provider calendar id is stored.
- A calendar is authorized by `(connection, fingerprint)`. Calendars that appear later are *not*
  authorized. A calendar that disappears at the provider is reported as missing. Disconnecting
  a provider deletes its grant rows by cascade; reconnecting the same account keeps its
  connection id and so its grants.
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
(the zone used), `complete`, and `unavailable` (calendar handle, name, provider, reason) when
something could not be read; `find_free_time` adds an explicit warning when incomplete.
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

In the Calendars pane, under the accounts: **AI access**. The endpoint to give an assistant, the
list of AI connections (client, read-only, how many calendars, when) with **Revoke**, and two
plain lines: "Koyomi never shares calendars with an AI unless you explicitly authorize it." and
"Local Koyomi events stay on this device and are not shared with AI connections." Revoking ends
that AI's access at once and touches no calendar connection.

### Feature flag

`KOYOMI_MCP=on` (runtime, Production only when it is turned on). Off: `/mcp`, the metadata and
OAuth endpoints answer 404 and the AI access section is not shown.

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
