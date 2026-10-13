# Calendar connections

Koyomi shows calendars from elsewhere beside its own. The first provider is Google Calendar, it
is read-only, and a person can connect as many Google accounts as they have.

- External calendars are **context**: meetings that already occupy the time.
- Koyomi's own calendar is **yours to write in**: what you decide to do with the rest.

Koyomi never creates, changes or deletes anything in a connected calendar, and connecting one
never uploads a Koyomi event. Someone who connects nothing has Koyomi's own calendar and nothing
else: no sign-in, no request to the server, nothing more on their device.

## How it works

```
 Browser (app.koyomi.guru)            Koyomi's server (Vercel)              Elsewhere
 ─────────────────────────            ────────────────────────              ─────────
 Calendars → Add calendar account ──▶ /api/google/connect
                                        not signed in? ───────────────────▶ 6Away Auth (sign in)
                                      ◀──────────────────────────────────── signed in
                                        ──────────────────────────────────▶ Google (which account?
                                                                              then its consent)
                                      /api/google/callback ◀─────────────── code
                                        trades the code for tokens ◀──────▶ Google
                                        asks which account it is ◀────────▶ Google Calendar API
                                        seals the refresh token
                                        stores it as that account's ──────▶ Postgres (Neon)
 back on the calendar ◀─────────────
 asks for accounts and calendars ───▶ /api/google/calendars
 asks for each account's events ────▶ /api/google/events
                                        opens that account's token, gets
                                        an access token, reads ◀──────────▶ Google Calendar API
 titles and times ◀─────────────────    reduces to what Koyomi shows
 kept in their own local database,
 filed by account
```

Three things are worth knowing about that picture.

**Google's tokens never reach the browser.** The code Google sends back is exchanged on the
server. The refresh token is sealed with AES-256-GCM (`lib/server/seal.ts`) before it is stored,
with a key that exists only in the server's environment, and tied to the row it belongs to (the
person, the provider and the account), so a sealed token copied onto another row cannot be
opened. The browser holds a session cookie that page code cannot read, and nothing else.

**Signing in happens only when an account is added.** A connection has to belong to someone, so
pressing "Add calendar account" signs you in with 6Away (`@6away/auth-connect`, the same way
every app in the ecosystem does it). Nothing else in Koyomi asks for an account, and the calendar
itself still has none.

**The server keeps one row for each account a person connects.** Not events, not calendar
names, not an email address:

| Column | What it is |
| --- | --- |
| `connection_id` | Koyomi's own name for the row: a random id, and all a browser is ever told of it |
| `auth_subject` | The 6Away id of the person: opaque and stable |
| `provider` | `google` |
| `provider_account_id` | Which account it is, as a keyed hash (see "Several accounts"). Not the account's address |
| `refresh_token_sealed` | That account's refresh token, sealed |
| `scope` | The permissions that were granted |
| `status` | `active`, or `reconnect` once Google has refused the token |
| `window_started_at`, `window_spent` | How much has been asked of Google about this account in the current minute (see "How much may be asked") |
| `created_at`, `updated_at` | |

The row's key is `connection_id`, and the table's rule is **one row for each person, provider
and account**: `(auth_subject, provider, provider_account_id)` is unique. A row is made by
connecting an account and removed by disconnecting it, and by nothing else.

## Several accounts

A person's 6Away identity can hold any number of connections, each to one Google account, each
with its own calendars:

```
 one person (6Away identity)
   ├─ Google · one@example.com        Personal, Family
   └─ Google · two@example.com        Work, Company events
```

**"Add calendar account" always goes to Google, and Google always asks which account.** The
consent address carries `prompt=consent select_account`: Google's own list of accounts first,
then the consent screen, every time. Nothing is taken for granted from whichever account the
browser used last, so a second account can be chosen as easily as the first.

**Which account came back decides which row it is.** Koyomi asks Google for no sign-in or
profile permission, so it never receives a name, a user id or an "id token". What it can read,
with the permission it already has to list calendars, is the id of the account's own (primary)
calendar: `calendarList.get('primary')`, asking for the one field `id`. For a Google account
that id is the account's address, and it is how one account is told from another:

- **On the server it is never stored.** `provider_account_id` is an HMAC-SHA256 of it
  (`accountKey` in `lib/server/connections.ts`), keyed with a key drawn from the server's token
  key and mixed with whose connection it is. The same person connecting the same account again
  comes to the same word, so their row is found and its token replaced, not doubled. Nobody
  without the key can turn the word back into an address, and two people who connect the same
  account get two different words.
- **In the browser it is the account's name.** Each time the server lists a person's accounts
  it reads each one's calendars, and passes the primary calendar's id on with them. The browser
  shows it as the heading over that account's calendars and under an event's details, and keeps
  it in the device's copy so it is there offline. It reaches nobody else.

If Google will not say which account a fresh consent was for (it is failing at that moment, or
the Calendar API is switched off for the app), there is nowhere to keep the permission: nothing
is stored, and the person is asked to try again. The permission is handed back to Google only
when the person has no other connection, because at Google withdrawing it for an account ends
every token of that account, and the account might be one that is already connected and working.

**Each account stands by itself.** Adding one touches no other row. Its calendars are listed,
its events read, its allowance counted, its trouble reported and its connection ended without
reference to any other. What that means on the device is under "One copy, in parts".

**A device that shows no account yet says so.** Its button goes to `/api/google/connect`; one
that already shows an account goes to `/api/google/connect?add=1`. With `add`, the server always
goes on to Google. Without it, if the person signing in turns out to have accounts connected
already (they connected on another device, or cleared this one), there is nothing to ask Google:
the device is sent back to read those, and its next press says `add`. The word only chooses
between those two harmless things, and is carried through sign-in as a fixed word, never as
whatever was sent.

## Signed out is not disconnected

There are two different things that can lapse, and Koyomi keeps them apart.

| | The Koyomi sign-in | A Google connection |
| --- | --- | --- |
| **What it is** | A session cookie on one device | A row as above, on the server |
| **Belongs to** | That browser | The person: their 6Away identity |
| **How many** | One, for all their accounts | One for each account |
| **Ends when** | Thirty days pass, cookies are cleared, or you sign out | The person disconnects that account, or Google refuses its token |
| **What you see** | "Sign in again to keep Google Calendar up to date" · **Sign in** | "Needs reconnecting" under that account's address · **Reconnect** |
| **What mends it** | Signing in to 6Away. Google is not involved | Google's consent screen, for that account |

When the sign-in ends, the server no longer knows who is asking, so it can say only "sign in".
It does not touch any connection. Signing in again as the same person finds every row exactly as
it was, and reading carries on with **no visit to Google's consent screen**. Sign in goes to
6Away and back, and never on to Google.

"Needs reconnecting" appears only when Google itself has refused an account's stored token: the
permission was withdrawn in that Google account, or it expired. It is said of that account
alone; any other account goes on being read. Reconnect goes to Google, where choosing the same
account mends its row in place.

If both have happened, sign-in comes first, because that is all the server can know. Once you
are signed in, the reading finds that Google has refused, and only then asks to reconnect.

If a *different* person signs in on the device, the server lists their accounts, not the first
person's. The device lets go of everything it held of the first person's accounts and takes up
the second person's, if they have any. The first person's connections are untouched: they are
there when they sign in again, here or anywhere.

**Signing out** is `/api/auth/signout`. It ends the Koyomi session on that device, then passes
the browser to 6Away to end the session there, and 6Away sends it back to the calendar. It is the
sign-in that ends, so everything above applies: the connections stay, what was read stays, and
Google is told nothing. To take a permission away, use that account's Disconnect. No button
leads to sign-out yet; the address is there for the 6Away ecosystem and for whoever wants it.

## Disconnecting

Each account has its own Disconnect, beside its address in Calendars. It:

- asks Google to revoke Koyomi's access to **that account**;
- deletes **that account's row** on the server;
- deletes **that account's part** of the device's copy: its calendars and its events.

Every other account is left exactly as it was, on the server and on the device, and goes on
being read. Koyomi's own calendar is a different database and is not involved. When the last
account is disconnected the device is also signed out of Koyomi's server, since the connections
were the only reason it was signed in, and the device's copy is deleted altogether.

If the sign-in has lapsed, the server cannot be told who is disconnecting. Koyomi signs you in
first and then finishes that one Disconnect.

## One copy, in parts

The device's copy of connected calendars (`koyomi-external`, in IndexedDB) is one database in
parts, **one part for each connected account**. Every calendar is filed as
`connectionId:calendarId` and every event as `connectionId:calendarId:eventId`, with indexes on
the connection and on the pair. Two accounts can hold a calendar, or an event, with the very same
id at Google (a shared team calendar is exactly that): on the device they are two records, and
nothing read from one account can be written over, cleared with or shown as something from
another. A change to one account's part is one transaction that touches only records filed under
that connection, whatever the change holds (`saveConnection` in `lib/calendars/db.ts`).

Several tabs share the copy. A reading takes a moment, and in that moment another tab can
disconnect an account, someone else can sign in, or the person can go to Google and back.
Whatever a reading brings back then may be for something the device no longer has. No tab can
know for certain what another has just done: word between tabs travels by more than one route (a
message, and a note in the browser's storage), and the routes do not arrive together. So nothing
rests on them. **The copy itself is what decides**, by two kinds of made-up word that name
nobody and nothing outside the device:

- Each connection has an **epoch**, written when its part begins and gone when it ends. A
  reading of an account remembers the epoch it began from. **Every write to an account's part is
  one transaction that first finds that account still there, with that epoch, and goes ahead
  only then.** If the account has been disconnected, or its part has begun again, nothing is
  written and nothing is shown. A reading of another account is not affected by any of it.
- The copy has a **roster** word for which accounts it holds. It moves on whenever an account
  leaves. **The server's list of accounts is taken up only if the roster is still the one the
  list was asked under**, in one transaction that reads it first. A list that is late cannot
  bring back an account that has just been disconnected.

What follows from those two:

- **Disconnect** removes that connection, its calendars and its events in one transaction and
  moves the roster on. If it was the last account, everything is cleared in the same
  transaction and the emptied database is deleted, then the note in storage is cleared, and
  only then are other tabs told. A tab that had the copy open hears of the deletion from the
  database itself, which cannot finish deleting until that tab has let go.
- **Coming back from 6Away or from Google** gives every account a new epoch, and the copy a new
  roster, before anything is read, because who is signed in, or what is connected, may not be
  what it was. Anything asked for before, in any tab, for any account, is for the old ones and
  is not kept.
- The server saying an account is not connected ends that account's part only if it is still
  the one the question was about. A reading that is late cannot end a part that has begun again.
- A reading whose copy was taken from under it **stops where it is**: it asks for nothing
  further and reports nothing. Otherwise its next request, perhaps now signed out, would be
  taken for the sign-in ending.
- A tab that finds its write refused takes up what the device does hold, and reads what is
  still connected afresh.

A message between tabs is only a prompt to look, and "off" needs no looking. A tab told that
something is connected opens the copy and believes what it finds: with no account there, it is
off, whatever the note in storage says. Opening never makes a copy: only the first reading of a
first account does, so a device with nothing connected has no such database at all.

**A copy from before accounts were told apart is not carried over.** Releases up to October
2026 knew one account, filed the copy by calendar alone, and marked the whole of it with one
epoch. Such a copy cannot say which account anything in it came from, and it is only a copy. So
when it is first opened by this release it is dropped (the database's version goes from 2 to 3
and its stores are made anew), the device shows nothing connected, and adding the account reads
everything again. Koyomi's own database is not opened, changed or upgraded by any of this.

## What Koyomi asks Google for

Two permissions, both read-only, and narrower than the usual `calendar.readonly`:

- `calendar.calendarlist.readonly`: see which calendars you have.
- `calendar.events.readonly`: read the events on them.

Nothing for Gmail, Contacts, Drive or anything else, and nothing for sign-in or a profile: no
`openid`, `email` or `profile`. If someone unticks one of the two on Google's screen, Koyomi
connects nothing and hands the partial permission straight back.

With those two permissions Koyomi makes three kinds of read-only call, and no other:

| Call | What for | What is asked for |
| --- | --- | --- |
| `calendarList.get('primary')` | Once, when an account is connected: to tell which account it is | `id` |
| `calendarList.list` | Which calendars an account has, and which is its own | `id`, `summary`, `summaryOverride`, `primary`, `selected`, `deleted` |
| `events.list` | The events of the calendars being shown | See below |

From each event Koyomi asks Google for the title, the start and end, whether it is cancelled,
the link to it, and your own reply to it (so that what you declined is left out). It does not
ask for descriptions, locations, guest lists or meeting links, and Google does not send them.

## Privacy

| | |
| --- | --- |
| **What is read** | For each connected account: the list of its calendars, and for the ones you choose to show, event titles and times, about five weeks back and six months ahead |
| **What is kept on your device** | Those titles and times, in a database of their own (`koyomi-external`), filed by account, so they are still there offline. The address of each account, and which of its calendars you show. A note that a calendar is connected, and with the copy made-up marks for which connection each part belongs to, which name nobody. No credential of any kind |
| **What the server keeps** | The one row above for each connected account. It keeps no events: they pass through on their way to your device. It keeps no account address either, only a keyed hash that stands for it |
| **What an account's Disconnect removes** | That account's permission, at Google. Its row, on the server. Its part of the local copy. With the last account, also your Koyomi sign-in on that device. Your Koyomi events are in a different database and are not touched |
| **What is never done** | Event contents are not sent to any AI service, not used for analytics, and not logged |

If Google cannot be reached at the moment of disconnecting, Koyomi still deletes its token, which
makes the permission useless. It stays listed in your Google account until you remove it there.

The public version of this section is the Privacy page, `https://koyomi.guru/privacy`
(`app/privacy/page.tsx`), with the Terms beside it at `/terms`. The two must say the same thing:
a change to what Koyomi reads, keeps or sends changes that page in the same commit, with a new
date. `tests/e2e/site.spec.ts` holds the page to the scopes, the span and the fields in the code.

## What is read, and how often

Not the whole history: **five weeks back and twenty-seven weeks ahead** of today
(`lib/calendars/window.ts`). Five weeks back keeps last month meaningful in Month view;
twenty-seven ahead is about half a year of planning. A meeting on every working day is about
160 events in that span.

Repeating events are expanded by Google into the times they happen, so Koyomi has no second set
of recurrence rules to get wrong.

A refresh asks the server once for the person's accounts and their calendars, then reads each
account's events in turn, one account after another. After the first reading of a calendar, a
refresh asks Google only for **what changed** since the last one (its sync token). Once the span
has slipped a week, or Google lets the token lapse, everything in the span is read again. Koyomi
looks when it is opened or returned to if the last reading is more than five minutes old, every
fifteen minutes while it is in front, and when Refresh is pressed.

A calendar read again in full replaces what the device held of it: the old events are cleared
and the new ones put, in that order, in the one transaction (`saveConnection` in
`lib/calendars/db.ts`). The order matters because most of the new events have the ids of the
old ones, so clearing afterwards would take them all away again. What is cleared is that
account's calendar: a calendar with the same id in another account is not among it.

A calendar you hide is not read at all, and its events are removed from your device.

A refresh takes a moment, and a calendar can be shown or hidden while one is under way. So each
account's reading ends by adding what it read to the calendars as they are then, not as they
were when it began (`read` in `lib/calendars/store.ts`). A calendar hidden meanwhile stays
hidden and nothing read of it is kept; one shown meanwhile stays shown and is read next; one
hidden and shown again is read whole, because what changed since a reading the device no longer
holds has nothing to be added to.

## Time zones

- A timed event is stored as its instant, with the zone it was written in kept beside it. It is
  shown on the device's own clock, so six in the evening in Los Angeles is two the next
  afternoon in Auckland.
- An all-day event is stored as its day (`2026-10-07`), never as an instant, so it cannot slide to
  the day before for someone west of Greenwich. Koyomi's own all-day events are stored the same way.
- An event that runs past midnight is drawn as the evening of one day and the small hours of the
  next. One lasting a day or longer joins the all-day row.

## When something goes wrong

Koyomi's own calendar never depends on any of this, and one account's trouble is never
another's: the accounts that can be read are read.

| What happened | What you see |
| --- | --- |
| No connection | Nothing. Events already read stay on screen |
| Google is failing or limiting requests for an account | Nothing. That account keeps what was read of it and is tried again later; the others are read as usual |
| The Calendar API is switched off for Koyomi's own Google Cloud project | Nothing, for accounts already connected: their connections are left as they are. Nobody is asked to reconnect, because consenting again cannot mend it. The server's log says what to switch on |
| Google will not say which account a new consent was for (as when that API is off) | "Couldn’t connect to Google Calendar. Try again in a moment." Nothing was kept, so trying again goes through Google once more |
| Your Koyomi sign-in has ended | One quiet line: "Sign in again to update Google Calendar". Events already read stay. Signing in carries on where it left off |
| Permission withdrawn or expired at Google for an account | "Needs reconnecting" under that account, and one quiet line on the calendar: "Google Calendar needs reconnecting". Events already read stay until you do. Other accounts carry on |
| You pressed Refresh many times in a minute | Nothing. The extra requests are not sent on to Google |
| A calendar is removed at Google | It disappears from its account's list, with its events |
| An account disconnected on another device | This device follows the next time it looks: that account goes, the others stay |

## The round trip to Google, and what protects it

Each of these is tested (`tests/unit/server.test.ts`, `tests/e2e/connection-security.spec.ts`).

**The attempt.** Pressing "Add calendar account" (or Reconnect) creates a `state` of 128 random
bits and a PKCE secret of 256, new every time. Google is shown the state and the SHA-256 of the
secret. Both, with who is asking and when the attempt expires, are sealed (AES-256-GCM) into one
cookie:

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
nothing, and means a stolen code is useless on its own. The account the tokens are for is then
read from Google itself (see "Several accounts"), never taken from the request, and the token
is stored as that account's connection for the person who started.

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
only if this tab itself left a marker before it went to sign in, naming the one account it was
asked to disconnect. The rest only show a line of text.

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
else: no route takes a person's id from the address, the body or a header. A person can have
several connections, so a request does say which one, by its `connection_id`. But every look in
the table is for that id **among the signed-in person's own rows** (`where auth_subject = … and
connection_id = …`), so an id that belongs to someone else finds nothing, exactly as one that
never existed does. Anything not shaped like an id is refused before the database is asked. On
top of that, a sealed token opens only on the row it was sealed for.

**Tokens.** Refresh and access tokens stay on the server. They are not in any response, cookie
or redirect. Answers that are not data are one fixed word (`signed_out`, `reconnect`, `busy`…),
never a message from Google or a stack. Anything written to the server log passes through
`lib/server/log.ts`, which withholds every long token-like run of characters whatever error
carried it.

## How much may be asked

So that one browser, or a script holding its cookie, cannot make Koyomi hammer Google:

- **An allowance for each connected account: 120 units a minute.** Listing the account's
  calendars costs one; reading events costs one per calendar. The app's own use is a few units,
  minutes apart. The count is kept in the account's own row, updated in a single statement, so it
  is one count however many servers Vercel is running. (A counter in memory would be a separate
  counter on each.) Past it, **Google is not asked**: reading that account's events answers
  `429` with `Retry-After`, and the list of accounts shows that one as not readable just now
  while listing the others. The app treats both like Google being busy: nothing changes on
  screen and nothing is said. One account asked about too often does not hold back another.
- **The same question at the same moment is asked once.** Several tabs, a double click or a
  retry wait for the request already in flight and share its answer. In the app, asking for a
  reading while one is under way queues exactly one more, however many times it was asked.
- **Showing one more calendar reads that calendar**, not all of them, and asks nothing of any
  other account.
- **Hard bounds on a request.** One account, at most 232 days (the app reads 225), at most 25
  calendars, ids of at most 256 printable characters. Anything else is a 400.
- **Bounded reading.** At most 500 calendars are listed per account and 10,000 events read per
  calendar per reading, five calendars (and five accounts) at a time. A calendar cut short is
  read in full again next time rather than trusted.
- **Time limits.** No single request to Google is waited on for more than 15 seconds, and no
  job for more than 25.
- **No addresses from the browser.** Every address Koyomi asks comes from its own code. A
  calendar's id is only ever placed in the path percent-encoded.

## Setting it up

Calendar connections are **off until all of this is in place**. With any of it missing there is
no "Add calendar account" and every `/api/google` address is a 404: Calendars shows Koyomi's own
calendar and nothing to connect, so it is safe to deploy first and configure afterwards.

**Signing in is the one part that can be on by itself.** With the five sign-in settings
(`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_AUTH_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`,
`SESSION_SECRET`), the three addresses under `/api/auth` answer, so sign-in can be checked
against the real 6Away before a Google client exists. Nothing in the app leads to them until
the rest is there, and a session opens nothing by itself.

1. **A database.** Any Postgres; the ecosystem uses Neon. Create the table (every file in
   `migrations/`, in order):

   ```sh
   DATABASE_URL="postgres://..." npm run db:migrate            # shows which database it would change
   DATABASE_URL="postgres://..." npm run db:migrate -- --yes   # changes it
   ```

   It waits for `--yes` because a machine can have `DATABASE_URL` set for another project. Each
   file is one statement, applied whole or not at all, and running them all again changes
   nothing.

   **Coming from a release with one account for each person** (anything before
   `003_many_accounts.sql`): run the same command at the moment the new release goes out. That
   file gives each row an id of its own, changes the table's rule to one row for each account,
   and **removes the rows that were there**: they have no account to their name, and nothing in
   a migration can ask Google which it was. Whoever had connected presses "Add calendar account"
   once more. The release before and the table after do not fit together (it cannot connect
   anyone until it is replaced), and nor do the new release and the old table, so the two go out
   together.

2. **A 6Away Auth client** for Koyomi. It exists: client id `koyomi-guru`, created at
   `auth.6away.ai/admin` with sign-up open and exactly two redirect addresses:
   `https://app.koyomi.guru/api/auth/callback/6away` and
   `http://localhost:3000/api/auth/callback/6away`.
   6Away refuses any other address, so real sign-in works on the production host and on
   port 3000 of your own machine, and nowhere else: not on a Vercel preview, and not on port 4310.

3. **A Google Cloud OAuth client** (type: web application) in a project with the Google Calendar
   API enabled. Enabling the API is a step of its own (APIs & Services → Library), and it is easy
   to miss: without it Google still shows the consent screen and still grants the permission,
   and then refuses every reading, including the one that says which account it is.
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

Changing `TOKEN_ENCRYPTION_KEY` later makes every stored token unreadable, and every account's
hash unmatchable. Nothing breaks: each account shows "Needs reconnecting". Reconnecting makes a
new row under the new key, and the old one, which can no longer be told to be the same account,
stays beside it until its Disconnect is pressed.

## Trying it without any of that

```sh
npm run preview:connected   # http://localhost:4310, then Calendars → Add calendar account, twice
```

This runs Koyomi against stand-ins for 6Away Auth and Google (`tests/fakes/providers.mjs`) with
two made-up accounts: the first press connects one, the second the other. No real credentials,
no real calendar, and nothing kept once it stops.

## Signing in for real on your own machine

The real 6Away knows this machine only as `http://localhost:3000`, so the app has to be on that
port. `.env.local` (never committed) holds the five sign-in settings, with
`NEXT_PUBLIC_APP_URL=http://localhost:3000`:

```sh
npm run build && npm run start   # http://localhost:3000
```

Those five are enough for sign-in alone: `/api/auth/signin`, staying signed in across a reload
and `/api/auth/signout` all work, and Calendars has nothing to connect. Connecting a calendar
needs the Google and database settings in `.env.local` as well.

## Tests

The automated tests use the same stand-ins, never a real account. They cover: a local-only
visitor being asked nothing; connecting; listing and choosing calendars, also while a refresh is
under way (the stand-in for Google can keep one account's answer back until a test lets go);
timed, all-day and repeating events in Day, Week and Month; time zones (three device zones, and
all-day events on both sides of the date line); overlapping events; that an external event
cannot be edited, moved or deleted; the all-day row; reading only what changed, and reading
everything again (a lapsed cursor, the span moving on a week) without losing the device's copy;
offline use; Google failing; permission withdrawn; an expired sign-in; cancelled and partial
consent; disconnecting; a reading that comes back after its connection has ended (Disconnect in
another tab, however that tab hears of it; another account connected; someone else signing in; a
Disconnect finished while the copy is being refreshed); a copy from an earlier release; that
Koyomi's own records are untouched throughout; what the server refuses; and contrast in both
themes.

And, for several accounts: adding a second through Google's choice of account while the first
is untouched; the same account added twice being one connection; two accounts whose calendars
and events have the very same ids being kept, chosen, refreshed, re-read and cleared apart; each
account's changes reaching it alone; both being there offline; one account failing, or refused
by Google, while the other is read; reconnecting one in place; disconnecting one and then the
last; the same races, account by account (a calendar hidden during a refresh, Disconnect of one
account in another tab, coming back from Google in another tab); and that someone else signing
in gets neither account, while the first person finds both again.

- `tests/unit/calendars.test.ts`: Google events becoming Koyomi's record of them, where they
  land on the local calendar, and that the same ids in two accounts are two things.
- `tests/unit/server.test.ts`: sealing, how an account is told apart without being named, the
  table of connections, its rule and the migration to it, and the allowance (run against the
  real migrations in an in-process Postgres), the consent round trip, what may be logged, the
  bounds on what is asked of Google, the permissions asked for, and when the feature is off.
- `tests/e2e/calendars.spec.ts`: the feature itself, with one account, in the real app.
- `tests/e2e/accounts.spec.ts`: several accounts.
- `tests/e2e/connection-security.spec.ts`: sign-in ending against Google refusing, signing out,
  the round trip under tampering (replay, wrong state, another browser, another person),
  redirects, cookies, requests from other sites, other people's connections, and the allowance.

### Checked against the real Google

The stand-in behaves as Google's documentation says Google does. On 9 October 2026 the same
things were checked on production against Google itself: a real account, a person signing in
and consenting, and Koyomi's Google Cloud app in "Testing". That was the release with one
account for each person; what it showed about Google still holds.

| | What was seen |
| --- | --- |
| Consent | Google named the app as it is named in the Cloud console and listed exactly two permissions: "See the list of Google calendars you're subscribed to" and "View events on all your calendars" |
| Granted | Exactly the two read-only scopes. The server held one row: the sealed token, the scopes and a status |
| On the device | No token of any kind in storage, cookies page code can read, or anything the server sent. An event's description and location never arrived |
| Calendars | The primary calendar, a second calendar and a subscribed one were listed. Hiding one removed its events from the device; showing it read it again; the choice survived a reload |
| Events | Timed, all-day, three-day and repeating events were right in Day, Week and Month. An occurrence removed at Google was absent. An event written at 18:00 in Los Angeles showed at 05:00 the next day in Dubai |
| The span | The first reading asked for exactly five weeks back to twenty-seven ahead. Events either side of it never arrived |
| What changed | After an event was added at Google, Refresh sent each calendar's cursor and Google answered with that one event |
| Offline | With no network the events already read were shown, with when they were read, and Koyomi's own calendar stayed fully usable |
| Sign-in ended | "Sign in again to keep Google Calendar up to date". Signing in as the same person carried on with the same stored token and no consent screen |
| Another person | Signed in as a second 6Away identity: the server had no connection for them, and the device let go of the first person's events. The first person's row was untouched |
| Revoked at Google | The next Refresh said "Google Calendar needs reconnecting", not "sign in". Reconnect showed Google's consent screen again and reading resumed |
| Disconnect | The permission was gone from the Google account, the row was gone from the database, the device's copy was gone, and Koyomi's own database was byte for byte unchanged |
| Open in Google Calendar | Opened that event at Google |

Not yet checked against the real Google:

- **several accounts**: that `prompt=consent select_account` shows Google's list of accounts
  every time; that `calendarList.get('primary')` answers with the account's address for a
  consumer account and for a Workspace one; two real accounts connected side by side, one
  disconnected and one refused while the other carries on;
- declining an invitation, and changing or deleting (rather than adding) an event;
- a connection left for more than an hour, by when a new access token is needed;
- the seven days after which Google ends a grant given to an app in "Testing".

## Known limits

- **An account is known by its address.** Koyomi asks Google for no identity permission, so the
  id of the account's primary calendar is the only name it has for it. If that address changes
  at Google (a Workspace account renamed), the existing connection goes on working, but adding
  the account again is taken for a new account and makes a second connection beside the first.
  They are one account at Google, so disconnecting either withdraws the permission for both;
  the other then needs reconnecting, or its own Disconnect.
- Two people who connect the same Google account each have a connection of their own, but there
  is one permission at Google. One of them disconnecting withdraws it for both.
- Events outside the span (more than five weeks back or twenty-seven ahead) are not shown.
- Search does not look in connected calendars.
- A meeting you declined is hidden; one you have not answered is shown.
- A Koyomi all-day event lasts one day. Multi-day ones can only come from Google.
- The Koyomi sign-in lasts thirty days and is not extended by use, so about once a month you
  will be asked to sign in again. That is how 6Away sign-in works across the ecosystem today.
  The Google connections are unaffected.
- A calendar with more than 10,000 events in the span shows the first 10,000.
- A connection belongs to the person, but which of its calendars are shown is chosen per device.
- Connected accounts are listed by address, and their events look alike on the calendar: no
  colour for each account. Which account an event is from is in its details.
- The allowance is for each connected account. Requests from someone who is not signed in, or
  about a connection that is not theirs, stop at the session check or one row lookup, and are
  limited only by Vercel.
- Google is the only provider. The table, the device's copy and the requests all say which
  provider a connection is for, so another can be added beside it; none has been.
