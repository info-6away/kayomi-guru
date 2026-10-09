# Calendar connections

Koyomi can show calendars from elsewhere beside its own. The first is Google Calendar, and it is
read-only.

- External calendars are **context**: meetings that already occupy the time.
- Koyomi is **intentional planning**: what you decide to do with the rest.

Koyomi never creates, changes or deletes anything in a connected calendar, and connecting one
never uploads a Koyomi event. Someone who connects nothing gets exactly the calendar they had:
no sign-in, no request to the server, nothing new on their device.

## How it works

```
 Browser (app.koyomi.guru)            Koyomi's server (Vercel)              Elsewhere
 ─────────────────────────            ────────────────────────              ─────────
 Calendars → Connect ───────────────▶ /api/google/connect
                                        not signed in? ───────────────────▶ 6Away Auth (sign in)
                                      ◀──────────────────────────────────── signed in
                                        ──────────────────────────────────▶ Google (consent screen)
                                      /api/google/callback ◀─────────────── code
                                        trades the code for tokens ◀──────▶ Google
                                        seals the refresh token
                                        stores it ────────────────────────▶ Postgres (Neon)
 back on the calendar ◀─────────────
 asks for calendars and events ─────▶ /api/google/calendars, /events
                                        opens the token, gets an access
                                        token, reads ◀────────────────────▶ Google Calendar API
 titles and times ◀─────────────────    reduces to what Koyomi shows
 kept in their own local database
```

Three things are worth knowing about that picture.

**Google's tokens never reach the browser.** The code Google sends back is exchanged on the
server. The refresh token is sealed with AES-256-GCM (`lib/server/seal.ts`) before it is stored,
with a key that exists only in the server's environment, and tied to the person it belongs to,
so a sealed token copied onto another row cannot be opened. The browser holds a session cookie
that page code cannot read, and nothing else.

**Signing in happens only at Connect.** The connection has to belong to someone, so pressing
Connect signs you in with 6Away (`@6away/auth-connect`, the same way every app in the ecosystem
does it). Nothing else in Koyomi asks for an account, and the calendar itself still has none.

**The server keeps one row per person.** Not events, not calendar names, not an email address:

| Column | What it is |
| --- | --- |
| `auth_subject` | The 6Away id of the person: opaque and stable |
| `provider` | `google` |
| `refresh_token_sealed` | Google's refresh token, sealed |
| `scope` | The permissions that were granted |
| `status` | `active`, or `reconnect` once Google has refused the token |
| `window_started_at`, `window_spent` | How much the person has asked of Google in the current minute (see "How much one person may ask") |
| `created_at`, `updated_at` | |

A row is made by connecting and removed by disconnecting, and by nothing else.

## Signed out is not disconnected

There are two different things that can lapse, and Koyomi keeps them apart.

| | The Koyomi sign-in | The Google connection |
| --- | --- | --- |
| **What it is** | A session cookie on one device | The row above, on the server |
| **Belongs to** | That browser | The person: their 6Away identity |
| **Ends when** | Thirty days pass, cookies are cleared, or you sign out | The person disconnects, or Google refuses the token |
| **What you see** | "Sign in again to keep Google Calendar up to date" · **Sign in** | "Google Calendar needs reconnecting" · **Reconnect** |
| **What mends it** | Signing in to 6Away. Google is not involved | Google's consent screen |

When the sign-in ends, the server no longer knows who is asking, so it can say only "sign in".
It does not touch the connection. Signing in again as the same person finds the row exactly as
it was, and reading carries on with **no visit to Google's consent screen**. Sign in goes to
6Away and back, and never on to Google.

"Needs reconnecting" appears only when Google itself has refused the stored token: the
permission was withdrawn in the Google account, or it expired.

If both have happened, sign-in comes first, because that is all the server can know. Once you
are signed in, the reading finds that Google has refused, and only then asks to reconnect.

If a *different* person signs in on the device, they have no connection of their own. The device
lets go of the first person's events, and the first person's connection is untouched: it is
there when they sign in again, here or anywhere.

**Signing out** is `/api/auth/signout`. It ends the Koyomi session on that device, then passes
the browser to 6Away to end the session there, and 6Away sends it back to the calendar. It is the
sign-in that ends, so everything above applies: the connection stays, what was read stays, and
Google is told nothing. To take the permission away, use Disconnect. No button leads to
sign-out yet; the address is there for the 6Away ecosystem and for whoever wants it.

## What Koyomi asks Google for

Two permissions, both read-only, and narrower than the usual `calendar.readonly`:

- `calendar.calendarlist.readonly`: see which calendars you have.
- `calendar.events.readonly`: read the events on them.

Nothing for Gmail, Contacts, Drive or anything else. If someone unticks one of the two on Google's
screen, Koyomi connects nothing and hands the partial permission straight back.

From each event Koyomi asks Google for the title, the start and end, whether it is cancelled,
the link to it, and your own reply to it (so that what you declined is left out). It does not
ask for descriptions, locations, guest lists or meeting links, and Google does not send them.

## Privacy

| | |
| --- | --- |
| **What is read** | The list of your calendars, and for the ones you choose to show: event titles and times, about five weeks back and six months ahead |
| **What is kept on your device** | Those titles and times, in a database of their own (`koyomi-external`), so they are still there offline. Which calendars you show. No credential of any kind |
| **What the server keeps** | The one row above. It keeps no events: they pass through on their way to your device |
| **What Disconnect removes** | The permission, at Google. The row, on the server. Your Koyomi sign-in on that device. The local copy of the events. Your Koyomi events are in a different database and are not touched |
| **What is never done** | Event contents are not sent to any AI service, not used for analytics, and not logged |

If Google cannot be reached at the moment of disconnecting, Koyomi still deletes its token, which
makes the permission useless. It stays listed in your Google account until you remove it there.

## What is read, and how often

Not the whole history: **five weeks back and twenty-seven weeks ahead** of today
(`lib/calendars/window.ts`). Five weeks back keeps last month meaningful in Month view;
twenty-seven ahead is about half a year of planning. A meeting on every working day is about
160 events in that span.

Repeating events are expanded by Google into the times they happen, so Koyomi has no second set
of recurrence rules to get wrong.

After the first reading, a refresh asks Google only for **what changed** since the last one (its
sync token). Once the span has slipped a week, or Google lets the token lapse, everything in the
span is read again. Koyomi looks when it is opened or returned to if the last reading is more
than five minutes old, every fifteen minutes while it is in front, and when Refresh is pressed.

A calendar you hide is not read at all, and its events are removed from your device.

## Time zones

- A timed event is stored as its instant, with the zone it was written in kept beside it. It is
  shown on the device's own clock, so six in the evening in Los Angeles is two the next
  afternoon in Auckland.
- An all-day event is stored as its day (`2026-10-07`), never as an instant, so it cannot slide to
  the day before for someone west of Greenwich. Koyomi's own all-day events are stored the same way.
- An event that runs past midnight is drawn as the evening of one day and the small hours of the
  next. One lasting a day or longer joins the all-day row.

## When something goes wrong

Koyomi's own calendar never depends on any of this.

| What happened | What you see |
| --- | --- |
| No connection | Nothing. Events already read stay on screen |
| Google is failing or limiting requests | Nothing. Koyomi tries again later |
| The Calendar API is switched off for Koyomi's own Google Cloud project | Nothing, for someone already connected: their connection is left as it is. Someone connecting for the first time is told "Your calendars couldn’t be read just now. Press Connect again in a moment." Nobody is asked to reconnect, because consenting again cannot mend it. The server's log says what to switch on |
| Your Koyomi sign-in has ended | One quiet line: "Sign in again to update Google Calendar". Events already read stay. Signing in carries on where it left off |
| Permission withdrawn or expired at Google | One quiet line: "Google Calendar needs reconnecting". Events already read stay until you do |
| You pressed Refresh many times in a minute | Nothing. The extra requests are not sent on to Google |
| A calendar is removed at Google | It disappears from the list, with its events |
| Disconnected on another device | This device follows the next time it looks |

## The round trip to Google, and what protects it

Each of these is tested (`tests/unit/server.test.ts`, `tests/e2e/connection-security.spec.ts`).

**The attempt.** Pressing Connect creates a `state` of 128 random bits and a PKCE secret of 256,
new every time. Google is shown the state and the SHA-256 of the secret. Both, with who is
asking and when the attempt expires, are sealed (AES-256-GCM) into one cookie:

| Cookie | `koyomi_google_oauth` |
| --- | --- |
| HttpOnly | Yes: page code cannot read it |
| Secure | Yes, in production |
| SameSite | Lax. Not Strict, because the way back from Google is a link from another site, which a Strict cookie would not accompany |
| Path | `/api/google`: it is not sent with the app's own pages |
| Lifetime | Ten minutes, enforced twice: by the browser, and by an expiry inside the seal |

**The return.** `/api/google/callback` honours a return only if all of these hold:

- the cookie is present, was sealed by this server, and has not been altered;
- it has not expired;
- the `state` in the address is the one that was sent (compared in constant time);
- the person signed in now is the person who started.

The cookie is deleted the moment the callback is reached, before anything is checked, so an
attempt can be presented **once**, whether it succeeds or fails. A replayed address, a forged
or missing state, another browser, or another person all end the same way: back at the calendar
with "couldn't connect", and **the code is never sent to Google**.

**The exchange.** When a return is honoured, the server trades the code with Google using the
app's client id and secret, its one fixed redirect address, and the PKCE secret. Google redeems
a code only for that client, that address and that secret, and only once. Koyomi is a
confidential client, so PKCE is not strictly required here; it was already in place, costs
nothing, and means a stolen code is useless on its own.

**Redirects.** Every redirect goes to an address the server builds from its own settings: the
app's address with one of four fixed words (`connected`, `cancelled`, `declined`, `failed`),
6Away's sign-in or sign-out, or Google's consent screen. Nothing in a request (a parameter, a
`Host` header) can choose it. The one caller-supplied destination, sign-in's `returnTo`, is
accepted only if it is a path on this site; anything else is replaced with `/`. Sign-out names
one place to come back to, the app's own address, and takes none from the request.

**Words in the app's own address.** The app reads how a round trip went from `?calendars=…`. An
address can be a link from anywhere, so no word does anything by itself. `connected` and
`resume` only make the app ask the server, and if the server does not agree the device is left
as it was. `disconnect` (used to finish a Disconnect that needed a sign-in first) is acted on
only if this tab itself left a marker before it went to sign in. The rest only show a line of text.

**The session cookie** (`koyomi_session`, set by `@6away/auth-connect`): HttpOnly, Secure in
production, SameSite Lax, path `/`, thirty days, signed with HMAC-SHA256. It holds the 6Away
identity, never anything of Google's.

**Requests from other sites.** Everything that changes something is a POST (`/events`,
`/disconnect`), protected twice. The session cookie is SameSite Lax, so a browser does not send
it with a POST from another site. And the server refuses any POST whose `Origin` is not the
app's own address, cookie or no cookie. A GET to either is a 405.

Sign-out is the exception, and a deliberate one: it answers a GET as well as a POST, as
`@6away/auth-connect` provides it, so that a plain link can sign someone out. A link on another
site could therefore do the same. All it costs is signing in again: nothing is read, changed,
disconnected or deleted by it.

**Other people's connections.** Who is asking comes from the session cookie and from nowhere
else. No route takes a person's id from the address, the body or a header, so there is no way to
name someone else's row. On top of that, a sealed token opens only for the person it was sealed
for.

**Tokens.** Refresh and access tokens stay on the server. They are not in any response, cookie
or redirect. Answers that are not data are one fixed word (`signed_out`, `reconnect`, `busy`…),
never a message from Google or a stack. Anything written to the server log passes through
`lib/server/log.ts`, which withholds every long token-like run of characters whatever error
carried it.

## How much one person may ask

So that one browser, or a script holding its cookie, cannot make Koyomi hammer Google:

- **An allowance per person: 120 units a minute.** Listing calendars costs one; reading events
  costs one per calendar. The app's own use is a few units, minutes apart. The count is kept in
  the database row, updated in a single statement, so it is one count however many servers
  Vercel is running. (A counter in memory would be a separate counter on each.) Past it, the
  server answers `429` with `Retry-After` and **does not ask Google**. The app treats that like
  Google being busy: nothing changes on screen and nothing is said.
- **The same question at the same moment is asked once.** Several tabs, a double click or a
  retry wait for the request already in flight and share its answer. In the app, asking for a
  reading while one is under way queues exactly one more, however many times it was asked.
- **Showing one more calendar reads that calendar**, not all of them.
- **Hard bounds on a request.** At most 232 days (the app reads 225), at most 25 calendars, ids
  of at most 256 printable characters. Anything else is a 400.
- **Bounded reading.** At most 500 calendars are listed and 10,000 events read per calendar per
  reading, five calendars at a time. A calendar cut short is read in full again next time rather
  than trusted.
- **Time limits.** No single request to Google is waited on for more than 15 seconds, and no
  job for more than 25.
- **No addresses from the browser.** Every address Koyomi asks comes from its own code. A
  calendar's id is only ever placed in the path percent-encoded.

## Setting it up

Calendar connections are **off until all of this is in place**. With any of it missing, the
Calendars entry does not appear and the app is exactly as it was, so it is safe to deploy first
and configure afterwards.

**Signing in is the one part that can be on by itself.** With the five sign-in settings
(`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_AUTH_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`,
`SESSION_SECRET`), the three addresses under `/api/auth` answer, so sign-in can be checked
against the real 6Away before a Google client exists. Nothing in the app leads to them until
the rest is there, every `/api/google` address is still a 404, and a session opens nothing by
itself.

1. **A database.** Any Postgres; the ecosystem uses Neon. Create the table (both files in `migrations/`):

   ```sh
   DATABASE_URL="postgres://..." npm run db:migrate            # shows which database it would change
   DATABASE_URL="postgres://..." npm run db:migrate -- --yes   # changes it
   ```

   It waits for `--yes` because a machine can have `DATABASE_URL` set for another project.

2. **A 6Away Auth client** for Koyomi. It exists: client id `koyomi-guru`, created at
   `auth.6away.ai/admin` with sign-up open and exactly two redirect addresses:
   `https://app.koyomi.guru/api/auth/callback/6away` and
   `http://localhost:3000/api/auth/callback/6away`.
   6Away refuses any other address, so real sign-in works on the production host and on
   port 3000 of your own machine, and nowhere else: not on a Vercel preview, and not on port 4310.

3. **A Google Cloud OAuth client** (type: web application) in a project with the Google Calendar
   API enabled. Enabling the API is a step of its own (APIs & Services → Library), and it is easy
   to miss: without it Google still shows the consent screen and still grants the permission,
   and then refuses every reading.
   - Authorised redirect URIs: `https://app.koyomi.guru/api/google/callback` and
     `http://localhost:3000/api/google/callback`.
   - On the consent screen, add the two scopes above.
   - While the consent screen is in "Testing", only the test users you list can connect, and
     **Google expires their refresh tokens after seven days**. To open it to everyone, Google has
     to verify the app, which needs a public privacy policy on `koyomi.guru`.

4. **Environment variables** in Vercel, for Production (and Preview, if previews should have it):

   | Name | What |
   | --- | --- |
   | `NEXT_PUBLIC_APP_URL` | `https://app.koyomi.guru` |
   | `NEXT_PUBLIC_AUTH_URL` | `https://auth.6away.ai` |
   | `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | From step 2 |
   | `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
   | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | From step 3 |
   | `TOKEN_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `DATABASE_URL` | From step 1 |

   Then redeploy: whether the feature is on is decided when the site is built.

Changing `TOKEN_ENCRYPTION_KEY` later makes every stored token unreadable. Nothing breaks: each
person sees "needs reconnecting" and connects again.

## Trying it without any of that

```sh
npm run preview:connected   # http://localhost:4310, then Plan → Calendars → Connect
```

This runs Koyomi against stand-ins for 6Away Auth and Google (`tests/fakes/providers.mjs`) with a
made-up account. No real credentials, no real calendar, and nothing kept once it stops.

## Signing in for real on your own machine

The real 6Away knows this machine only as `http://localhost:3000`, so the app has to be on that
port. `.env.local` (never committed) holds the five sign-in settings, with
`NEXT_PUBLIC_APP_URL=http://localhost:3000`:

```sh
npm run build && npm run start   # http://localhost:3000
```

Those five are enough for sign-in alone: `/api/auth/signin`, staying signed in across a reload
and `/api/auth/signout` all work, and the Calendars entry stays hidden. Connecting a calendar
needs the Google and database settings in `.env.local` as well.

## Tests

The automated tests use the same stand-ins, never a real account. They cover: a local-only
visitor being asked nothing; connecting; listing and choosing calendars; timed, all-day and
repeating events in Day, Week and Month; time zones (three device zones, and all-day events on
both sides of the date line); overlapping events; that an external event cannot be edited, moved
or deleted; the all-day row; reading only what changed; offline use; Google failing; permission
withdrawn; an expired sign-in; cancelled and partial consent; disconnecting; that Koyomi's own
records are untouched throughout; what the server refuses; and contrast in both themes.

- `tests/unit/calendars.test.ts`: Google events becoming Koyomi's record of them, and where they
  land on the local calendar.
- `tests/unit/server.test.ts`: sealing, the connection table and the allowance (run against the
  real migrations in an in-process Postgres), the consent round trip, what may be logged, the
  bounds on what is asked of Google, the permissions asked for, and when the feature is off.
- `tests/e2e/calendars.spec.ts`: the feature itself, in the real app.
- `tests/e2e/connection-security.spec.ts`: sign-in ending against Google refusing, signing out,
  the round trip under tampering (replay, wrong state, another browser, another person),
  redirects, cookies, requests from other sites, other people's connections, and the allowance.

### Checking it against the real Google

The stand-in behaves as Google's documentation says Google does. These need a real account once
the settings above are in place, and have **not** been done:

1. Connect with a real Google account. The consent screen names Koyomi and lists exactly two
   read-only permissions.
2. Your calendars are listed, with the ones ticked in Google Calendar shown.
3. A timed event, an all-day event, a multi-day event and a repeating event each appear correctly.
4. Change, add and delete an event in Google Calendar, then press Refresh: Koyomi follows.
5. Decline an invitation: it disappears from Koyomi.
6. Open in Google Calendar leads to the right event.
7. Remove Koyomi's access at `myaccount.google.com/permissions`, then Refresh: "needs
   reconnecting" appears, and Reconnect works.
8. Disconnect: Koyomi is gone from `myaccount.google.com/permissions`, and the row is gone from
   the database.
9. Leave it connected for more than an hour, then Refresh (a new access token is needed by then).
10. Sign in with 6Away as a second person: they see no connection.
11. Clear the site's cookies while connected, then Refresh: it asks to sign in, not to reconnect,
    and after signing in the events update without Google's consent screen appearing.

## Known limits

- One Google account per person.
- Events outside the span (more than five weeks back or twenty-seven ahead) are not shown.
- Search does not look in connected calendars.
- A meeting you declined is hidden; one you have not answered is shown.
- A Koyomi all-day event lasts one day. Multi-day ones can only come from Google.
- The Koyomi sign-in lasts thirty days and is not extended by use, so about once a month you
  will be asked to sign in again. That is how 6Away sign-in works across the ecosystem today.
  The Google connection is unaffected.
- A calendar with more than 10,000 events in the span shows the first 10,000.
- The connection belongs to the person, but which calendars are shown is chosen per device.
- The allowance is per connected person. Requests from someone who is not signed in, or has no
  connection, stop at the session check or one row lookup, and are limited only by Vercel.
