# kayomi-guru

Kayomi is a calm, local-first planning calendar.

- **Calendar** is scheduled time.
- **Plan** is what is still waiting for time.

Everything is stored on the device, in the browser's IndexedDB. There is no account, no server and no sync yet.

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
| `kayomi.guru` | The landing page (`app/home`), at `/` |
| `www.kayomi.guru` | Redirects to `kayomi.guru` |
| `app.kayomi.guru` | The calendar (`app/page.tsx`) |
| Anything else (a Vercel address, `localhost`) | The calendar at `/`, the landing page at `/home` |

The landing page's buttons link to `/open`, which goes to `app.kayomi.guru` from the live site and
to `/` on any other host, so they work in previews and locally too.

The calendar keeps its data in the browser, and a browser keeps data per address. What someone
saved at one address (say the Vercel one) does not appear at another (say `app.kayomi.guru`).

## Test it

```sh
npm test           # date, recurrence and layout logic
npm run test:e2e   # the real app in Google Chrome: builds, serves and drives the production build
```

The browser tests cover the whole first milestone: quick-add, editing, drag and resize, Plan, search,
Day/Week/Month, phone layout, dark mode, reload and browser restart, offline use and installability.

## How it is built

- `app/`: the Next.js shell: fonts, theme and icons. `app/page.tsx` is the calendar and
  `app/home/page.tsx` is the landing page.
- `components/`: the calendar itself. `Kayomi.tsx` holds the screen; `Timeline`, `MonthView`,
  `PlanPanel`, `EventPopover` and `SearchPanel` are its parts.
- `lib/`: no React. `types.ts` is the data model, `db.ts` and `store.ts` persist it, and
  `dates.ts`, `recurrence.ts` and `occurrences.ts` are the calendar arithmetic.
- `public/sw.js`: the service worker that keeps the app shell available offline.
- `scripts/make-icons.mjs`: draws the icons (`npm run icons`).
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
