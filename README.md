# kayomi-guru

Koyomi (暦, Japanese for calendar) is a calm, local-first planning calendar.

- **Calendar** is scheduled time.
- **Plan** is what is still waiting for time.

Everything is stored on the device, in the browser's IndexedDB. There is no account, no server and no sync yet.

The product was first written "Kayomi". That spelling survives in the repository name, in the
`Kayomi` component, and in the names the app uses inside the browser (the `kayomi` database, caches
and theme key). Those are deliberate: renaming the database would hide everything people have saved.

## Run it

Needs Node 20.9 or newer.

```sh
npm install
npm run dev        # http://localhost:3000, no service worker
npm run preview    # production build on http://localhost:4310, installable, works offline
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
  line at the foot of Plan offers it (`lib/install.ts`); it never appears at another address or once
  installed. Safari has no install prompt: on an iPhone it is Share, then Add to Home Screen.
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
  release so far has changed its shape. A change that does must raise the version, carry the
  existing records over, and extend the test that opens a calendar saved by the first release.

## Test it

```sh
npm test           # date, recurrence and layout logic
npm run test:e2e   # the real app in Google Chrome: builds, serves and drives the production build
```

The browser tests are in three files: `kayomi.spec.ts` (the calendar: quick-add, editing, drag and
resize, Plan, search, Day/Week/Month, phone layout, dark mode), `pwa.spec.ts` (the installed app, as
above) and `readability.spec.ts` (the contrast of every piece of text, in both themes, at three
sizes). `site.spec.ts` covers the landing page and the host names.

## How it is built

- `app/`: the Next.js shell: fonts, theme and icons. `app/page.tsx` is the calendar and
  `app/home/page.tsx` is the landing page.
- `components/`: the calendar itself. `Kayomi.tsx` holds the screen; `Timeline`, `MonthView`,
  `PlanPanel`, `EventPopover` and `SearchPanel` are its parts.
- `lib/`: no React. `types.ts` is the data model, `db.ts` and `store.ts` persist it, and
  `dates.ts`, `recurrence.ts` and `occurrences.ts` are the calendar arithmetic.
- `public/sw.js`: the service worker that keeps the app shell available offline.
- `scripts/`: `make-icons.mjs` draws the icons and `make-screenshots.mjs` takes the pictures in
  `docs/design` and the manifest.
- `docs/design/`: the approved visual baseline, with screenshots. Read
  [DESIGN_BASELINE.md](docs/design/DESIGN_BASELINE.md) before changing how anything looks.

### Data model

Two record types, each with a UUID and `createdAt` / `updatedAt` timestamps:

- `CalendarEvent`: title, `start` and `end` (UTC instants), category, optional recurrence, and
  `planItemId` when it was scheduled from Plan.
- `PlanItem`: title and `status` (`open` or `completed`).

Whether a Plan item is scheduled is not stored: it is scheduled exactly when an event points at it.
Likewise an event is "done" only through its Plan item. An ordinary event is never a task.

## License

[GPL-3.0](LICENSE)
