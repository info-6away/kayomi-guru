# kayomi-guru

Koyomi (暦, Japanese for calendar) is a calm, local-first calendar: one quiet place for all
your calendars.

- **Koyomi's own calendar.** Events you write here are stored on the device, in the browser's
  IndexedDB. It needs no account, and none of it is sent anywhere.
- **The calendars you already have.** Google Calendar and Microsoft (Outlook) calendars,
  read-only, from as many accounts at each as you choose to connect, shown beside your own. That
  is the only part with a server behind it. See [Calendar connections](docs/CALENDAR_CONNECTIONS.md).

Koyomi is a calendar and nothing else. It used to carry a list of things waiting for a time,
called Plan; that is gone (see "Data model" for what became of what it stored).

The product was first written "Kayomi". That spelling survives in the repository name, in the
`Kayomi` component, and in the names the app uses inside the browser (the `kayomi` database, caches
and theme key). Those are deliberate: renaming the database would hide everything people have saved.

## Run it

Needs Node 20.9 or newer.

```sh
npm install
npm run dev                 # http://localhost:3000, no service worker
npm run preview             # production build on http://localhost:4310, installable, works offline
npm run preview:connected   # the same, with stand-in Google and Microsoft accounts to connect (no credentials needed)
```

`npm run preview` uses its own port on purpose: the production build registers a service worker for
its origin, and you do not want that worker left behind on the port your other projects use.

## Two sites, one deployment

The same build serves both sites and tells them apart by host name (see `next.config.ts`):

| Host | What it shows |
| --- | --- |
| `koyomi.guru` | The landing page (`app/home`), at `/` |
| `www.koyomi.guru` | The landing page too. Which of the two redirects to the other is a Vercel domain setting, never the code's: a redirect in both places loops |
| `app.koyomi.guru` | The calendar (`app/page.tsx`) |
| Anything else (a Vercel address, `localhost`) | The calendar at `/`, the landing page at `/home` |

The landing page's buttons link to `/open`, which goes to `app.koyomi.guru` from the live site and
to `/` on any other host, so they work in previews and locally too.

The calendar keeps its data in the browser, and a browser keeps data per address. What someone
saved at one address (say the Vercel one) does not appear at another (say `app.koyomi.guru`).

## The installed app

Koyomi is a web app that can be installed, and `app.koyomi.guru` is the one address it is installed
from. Everything that follows is checked by `tests/e2e/pwa.spec.ts`.

- **Identity.** `public/manifest.webmanifest`: name and short name Koyomi, `id`, `start_url` and
  `scope` all `/`, standalone, paper for the splash and the window. Those three paths are what make
  an installed copy the same app after every release, so they must not change. The icons are the
  vermilion dot on paper, drawn by `npm run icons`; the two screenshots shown by Chrome's install
  sheet are taken by `npm run screenshots`.
- **Installing.** Chrome's own install banner is held back. While Chrome can install the app, one
  line at the foot of Calendars offers it (`lib/install.ts`); it never appears at another address
  or once installed. Safari has no install prompt: on an iPhone it is Share, then Add to Home Screen.
- **Fonts.** Both typefaces are downloaded at build time by `next/font` and served from this site.
  Nothing is requested from Google, or any other server, while the app runs.
- **Offline.** One visit is enough. The worker (`public/sw.js`) keeps the page and every file it
  loaded, fonts included. Being offline is not an error and nothing on screen says it is, since
  nothing the calendar does needs a server.
- **Updates.** There is no update prompt. The page is fetched fresh on every launch, so a new release
  is what the next launch shows; on a connection slower than four seconds the saved copy opens
  instead and the fresh one is kept for the launch after. An open calendar is never reloaded
  underneath its user. Files from older releases are dropped once a newer page has loaded.
- **Storage.** The calendar is in IndexedDB (database `kayomi`, version 1) and the worker's caches
  hold only files that can be fetched again. Nothing in the worker touches the database, and no
  release so far has changed its shape: removing Plan left it exactly as it was (see "Data
  model"). A change that does must raise the version, carry the existing records over, and
  extend the test that opens a calendar saved by the first release.

## Test it

```sh
npm test           # date, recurrence and layout logic
npm run test:e2e   # the real app in Google Chrome: builds, serves and drives the production build
```

The browser tests: `kayomi.spec.ts` (the calendar: quick-add, editing, drag and resize, search,
Day/Week/Month, where Calendars is, that nothing of Plan is left, phone layout, dark mode),
`pwa.spec.ts` (the installed app, as above), `calendars.spec.ts` (a connected account and the
all-day row), `accounts.spec.ts` (several connected accounts: adding, colliding ids, one failing
or disconnected while another carries on), `microsoft.spec.ts` (Microsoft accounts, personal and
work, alone and beside Google ones), `connection-security.spec.ts` (sign-in, the round trip
to Google, requests from other sites, and how much may be asked), `readability.spec.ts` (the
contrast of every piece of text, in both themes, at three sizes) and `site.spec.ts` (the landing
page, Privacy and Terms, and the host names).

No test touches a real account. Signing in, Google and Microsoft are played by stand-ins
(`tests/fakes/providers.mjs`) that Playwright starts with the app, and connections are kept in
memory, never in a database, whatever `DATABASE_URL` the machine happens to have.

## How it is built

- `app/`: the Next.js shell: fonts, theme and icons. `app/page.tsx` is the calendar and
  `app/home/page.tsx` is the landing page. `app/api/` is the server side of calendar
  connections, and the only code that runs on a server.
- `components/`: the calendar itself. `Kayomi.tsx` holds the screen; `Timeline`, `MonthView`,
  `EventPopover` and `SearchPanel` are its parts. `CalendarsPanel` is the Calendars drawer (a
  sheet on a phone): Koyomi's own calendar and each connected account's. `ExternalPopover` shows
  an event from a connected calendar.
- `lib/`: no React. `types.ts` is the data model, `db.ts` and `store.ts` persist it, and
  `dates.ts`, `recurrence.ts` and `occurrences.ts` are the calendar arithmetic.
- `lib/calendars/`: connected calendars in the browser: their own local database, filed by
  account, reading them, and where their events land on the calendar. `lib/server/`: the
  server's part: sealing tokens, the table of connections, and everything said to Google
  (`google.ts`) and to Microsoft (`microsoft.ts`), and calendar links (`link.ts`, fetched only
  through `fetchlink.ts`, which keeps the server off private networks), each behind the same few
  calls (`providers.ts`). `lib/calendars/ical.ts` works out a published calendar's occurrences.
- `public/sw.js`: the service worker that keeps the app shell available offline.
- `scripts/`: `make-icons.mjs` draws the icons and `make-screenshots.mjs` takes the pictures in
  `docs/design` and the manifest. `migrate.mjs` applies `migrations/` (one table).
  `preview-connected.mjs` runs the app against stand-ins for 6Away, Google and Microsoft.
- `docs/design/`: the approved visual baseline, with screenshots. Read
  [DESIGN_BASELINE.md](docs/design/DESIGN_BASELINE.md) before changing how anything looks.

### Data model

One record type of Koyomi's own, with a UUID and `createdAt` / `updatedAt` timestamps:

- `CalendarEvent`: title, `start` and `end` (UTC instants, or the day itself for an all-day
  event), category, and optional recurrence.

An event can be created, edited, moved, resized, repeated and deleted, and that is all. Nothing
about it is a task: it cannot be marked done.

**What Plan left behind.** Until October 2026 the `kayomi` database also held Plan items, in a
second store, `planItems`, and an event scheduled from one carried its id as `planItemId`. Plan
has been removed, and Koyomi no longer reads or writes either. The database itself was
deliberately not changed: it is still version 1 with both stores, a device that used Plan still
holds what it held, and an event that came from Plan is simply an event (the stray `planItemId`
stays on its record and means nothing). Leaving the unused store costs nothing, and changing a
database whose only job is to keep people's events safe would have risked something. If it is
ever tidied away, that is a version 2 with the events carried over, under the rule in "The
installed app" above.

Events from a connected calendar are another kind of record, `ExternalEvent`
(`lib/calendars/types.ts`), kept in a database of their own (`koyomi-external`) and filed by
the account they were read through. They are never mixed with, merged into or converted to
Koyomi's events, and deleting that whole database never goes near one.

## License

[GPL-3.0](LICENSE)
