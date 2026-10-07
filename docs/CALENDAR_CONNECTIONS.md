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
| `created_at`, `updated_at` | |

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
| Permission withdrawn or expired at Google | One quiet line: "Google Calendar needs reconnecting". Events already read stay until you do |
| Your Koyomi sign-in has lapsed (after 30 days) | The same line. Reconnecting signs you in again; Google is not asked twice |
| A calendar is removed at Google | It disappears from the list, with its events |
| Disconnected on another device | This device follows the next time it looks |

## Setting it up

Calendar connections are **off until all of this is in place**. With any of it missing, the
Calendars entry does not appear and the app is exactly as it was, so it is safe to deploy first
and configure afterwards.

1. **A database.** Any Postgres; the ecosystem uses Neon. Create the table once:

   ```sh
   DATABASE_URL="postgres://..." npm run db:migrate            # shows which database it would change
   DATABASE_URL="postgres://..." npm run db:migrate -- --yes   # changes it
   ```

   It waits for `--yes` because a machine can have `DATABASE_URL` set for another project.

2. **A 6Away Auth client** for Koyomi, created at `auth.6away.ai/admin`, with sign-up open and
   these redirect addresses:
   `https://app.koyomi.guru/api/auth/callback/6away` and
   `http://localhost:4310/api/auth/callback/6away`.

3. **A Google Cloud OAuth client** (type: web application) in a project with the Google Calendar
   API enabled:
   - Authorised redirect URIs: `https://app.koyomi.guru/api/google/callback` and
     `http://localhost:4310/api/google/callback`.
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
- `tests/unit/server.test.ts`: sealing, the connection table (run against the real migration in an
  in-process Postgres), the permissions asked for, and when the feature is off.
- `tests/e2e/calendars.spec.ts`: everything else, in the real app.

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

## Known limits

- One Google account per person.
- Events outside the span (more than five weeks back or twenty-seven ahead) are not shown.
- Search does not look in connected calendars.
- A meeting you declined is hidden; one you have not answered is shown.
- A Koyomi all-day event lasts one day. Multi-day ones can only come from Google.
- The Koyomi sign-in lasts thirty days and is not extended by use, so about once a month you
  will see "needs reconnecting". That is how 6Away sign-in works across the ecosystem today.
- The connection belongs to the person, but which calendars are shown is chosen per device.
- There is no rate limit of Koyomi's own on the calendar endpoints beyond what Vercel provides.
