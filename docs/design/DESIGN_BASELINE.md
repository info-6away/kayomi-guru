# Koyomi design baseline

The production app as it stands at the first local-first milestone (October 2026) is the approved
Koyomi visual baseline. It was ported from the approved Claude Design prototype and checked against
it side by side.

Do not redesign it. New work should be built in the same visual language, and any change to the look
below needs approval first.

In October 2026 Plan was removed from the product and Calendars took its place: the same drawer,
in the same position, opened by the control that used to say Plan. The calendar itself (the week,
the day, the month, an event and its details) was not redesigned. What changed is listed under
"Calendars, where Plan was".

## Screenshots

Taken from the production build with a neutral sample week, the clock set to Monday
5 October 2026, 14:25. Desktop is 1440×900; phone is 390×844 at twice the pixel density.
`npm run screenshots` retakes them all (with `npm run preview` running), along with the two
pictures the manifest shows when the app is installed.

| View | Light | Dark |
| --- | --- | --- |
| Desktop Week | [desktop-week-light.png](desktop-week-light.png) | [desktop-week-dark.png](desktop-week-dark.png) |
| Desktop Week + Calendars | [desktop-week-calendars-light.png](desktop-week-calendars-light.png) | [desktop-week-calendars-dark.png](desktop-week-calendars-dark.png) |
| Desktop Month | [desktop-month-light.png](desktop-month-light.png) | |
| Phone Day | [mobile-day-light.png](mobile-day-light.png) | [mobile-day-dark.png](mobile-day-dark.png) |
| Phone Calendars | [mobile-calendars-light.png](mobile-calendars-light.png) | |

Month and the phone Calendars sheet are shown in light only: dark changes their palette and nothing else.

![Desktop Week, light](desktop-week-light.png)

![Desktop Week with Calendars, dark](desktop-week-calendars-dark.png)

## What makes it Koyomi

- **Two palettes.** Light is warm paper; dark is ink at night. Every colour is a token in
  [app/globals.css](../../app/globals.css). The one accent is vermilion, used for the logo dot,
  today and the current time. Event colours are indigo (work), matcha (life), vermilion (focus)
  and a neutral grey (other, the default).
- **Two typefaces.** Shippori Mincho for the wordmark, dates and titles; Zen Kaku Gothic New for
  everything else.
- **Week first on a desktop, one day on a phone.** Below 760px the layout changes rather than
  shrinks: a week strip, a single day, and Calendars as a bottom sheet. The strip and the phone's
  month name their weekdays in three letters (MON, TUE), which fit down to 320px. A swipe across
  the strip moves a week, keeping the weekday; across the day, a day.
- **In a month, the months either side step back.** Their days are a smaller numeral (13px on a
  phone, 14px on a desktop, against 16 and 17) in `outside`. Text cannot go much lighter than
  `muted` and still meet AA, so the size is what tells them apart. Today and the chosen day keep
  their full size.
- **A narrow window keeps the same header.** From 980px up it is as in the screenshots. Below
  that it draws in a step at a time rather than changing, so that nothing in it overlaps
  anything else down to 760px. A day's date goes to three letters below 980px ("Wed 27 Sep 2028"), and a
  week's month below 900px ("20 — 26 Sep 2027"), where the date also moves closer to what is
  either side of it. The controls on the right close up below 850px. Below 800px a week and a
  day are shown without their year, as a day is on a phone; a month keeps its year.
- **Calendars is a drawer.** 320px wide; it sits beside the calendar from 1100px and slides over
  it below that. See "Calendars, where Plan was".
- **Events are quiet, but present.** A 2px colour bar and a tint of the same colour: 10% on paper
  and 6% at night, about twice that when selected. Once past, the bar and tint drop to half
  strength and the text goes one step lighter, in both themes. An event is never struck through:
  nothing on the calendar is a task.
- **An event nobody has coloured is still easy to find.** Most events keep the default colour.
  On paper that is a neutral grey as strong as the other three colours, not the pale stone used
  for decoration, so an ordinary week does not dissolve into the background.
- **Quiet structure, readable information.** What a day is read by (event blocks, titles and
  times, hour labels, weekday labels) is set darker than the chrome around it. The background and
  the grid lines stay faint.
- **Text has levels, not opacity.** Every piece of text is set in one of a few named colours and
  is never dimmed by fading it, so its contrast is one that was chosen. All of it meets WCAG AA
  (4.5:1, or 3:1 for large text) in both themes, and `tests/e2e/readability.spec.ts` holds it there.

  | Level | Used for | On paper | At night |
  | --- | --- | --- | --- |
  | `ink` | Titles, dates, what you typed, an account's address in Calendars | 13.8:1 | 13.8:1 |
  | `ink2` | Secondary text, weekday labels, past event times, the small controls in Calendars | 6.9:1 | 8.5:1 |
  | `muted` | Navigation, hints, counts, the theme switch | 5.1:1 | 5.7:1 |
  | `outside` | Days of the month before and after, in the month view | 5.1:1 | 5.0:1 |
  | `event-time`, `hour` | Event times and the hour labels | 8.2:1 | 6.4:1 and 6.8:1 |
  | `verm-text` | Small vermilion text: today's date, the current time, and trouble | 4.9:1 | 5.1:1 |
  | `stone`, `line` | Never text: rules, dots and outlines only | | |

  At night `muted` was raised from 5.0:1 after testers on phones found thin secondary type too
  faint there. Days outside the month kept the old level, so they stay quieter than everything else.

- **Two vermilions, one accent.** The accent (`verm`) is for shapes: the logo dot, the now line,
  an event's bar. On paper it is 3.9:1, too little for an 11px time, so small vermilion text uses
  `verm-text`, a shade deeper. Today's filled disc on a phone uses the deeper shade too: it is
  the one shape with small text on it, and its numeral then reads at 4.9:1 (5.1:1 at night).
  Nothing else changes colour: the accent is never darkened as a whole.
- **The working day is on screen.** The hour height follows the window (44 to 58px) and the timeline
  opens just after 07:30, so about 08:00 to 20:00 is visible without scrolling.
- **Every hour is labelled, from 00.** Midnight's `00` sits on its line like every other hour, in the
  same type. The labels are 12px on a phone and 11.5px on a desktop.
- **The day is never under Calendars.** On a phone the Calendars bar sits below the day, not over
  it: scrolled to the end, midnight's line and the last event are above the bar, with 40px to
  spare. The bar grows by the safe area, so its words are never under the system's own bar.
- **A long title cannot break the day.** On an event it is cut short with an ellipsis; in its
  details it is wrapped onto as many lines as it needs. A swipe sideways turns the day only when it
  starts on the day itself, with one finger: never on an event, its details or a field.
- **Creation is one line.** Click a time, type, Enter: `14:00 │ What are you doing?` A click gives
  the event an hour. To give it another length, drag down (or up) the empty part of the day with a
  mouse or pen: a quiet outline with a vermilion edge follows in quarter-hours, saying the times
  (`10:00 – 11:30`), and letting go opens the same one line over that stretch.
- **＋ opens where the person is.** On the day in view (in a week, today if the week has it,
  otherwise its Monday): at a time the person chose on the calendar and has not used yet, if there
  is one; otherwise at the next half-hour today, or 09:00 on another day. A chosen time is spent
  once an event is made there, once it is put away with Escape, or when the view or day changes.
- **Times are typed, to the minute.** In an event's details, Start and End take `14:05`, or `1405`
  where a phone's number pad has no colon. Dragging still moves in quarter-hours. On a phone the
  two times are underlined, since there is no hover to show they can be typed in.
- **What a thumb presses is 44px.** On a phone each control in an event's details (its ×, Delete,
  the colours, All day, Repeat, the times), Calendars' close, and its small text controls takes a
  44px tap, while being drawn as small as it always was. None reaches over another.

## Calendars, where Plan was

Koyomi is one calm place for all your calendars, and Calendars is where they are chosen and
connected. It took over Plan's place exactly, so nothing about the frame moved:

- **On a desktop, one word in the header.** "Calendars" sits where "Plan" did, after Day, Week
  and Month and before search, in the same type and weight. No count beside it, no icon. It
  opens the drawer; `C` does too, as `P` used to.
- **On a phone, the bar along the foot.** The bar that said Plan says Calendars, in the same
  Mincho, with a small `⌃` beside it that turns over once the sheet is open, and a quiet line for
  what is on screen: "Koyomi", or "Koyomi and 3 more". It opens the same bottom sheet. Testers
  read the bar as a caption; the chevron is the one sign that it opens something. Desktop is unchanged.
- **The drawer is a list, not a settings page.** "Koyomi", always shown and ticked. Then, under
  a small "GOOGLE" heading, and "MICROSOFT" and "YAHOO" ones below it in the same style, each connected
  account: its address as a quiet line, and its calendars under it, each a row that is on (a
  tick) or off (a ring), then "Disconnect" as small text at the end, on the right. A heading is
  there only when an account is under it. Then "＋ Add calendar account", drawn like Plan's old
  "＋ Add" row. Where more than one provider is offered, pressing it opens a quiet row for each
  under it, "Google", "Microsoft", "Yahoo", in the row's own type and indented to its text, and
  nothing more; pressing it again closes them. Where only one is offered, it goes straight there.
  Choosing Yahoo opens a small form in the same place, as Yahoo has no page to send anyone to:
  "Connect Yahoo Calendar", then "Yahoo email" and "Yahoo app password" as plain fields with
  their labels above them, one muted sentence saying to use a Yahoo app password and where to
  make one, with a quiet "How" link to Yahoo's own help, then "Connect Yahoo" as a pill and
  "Cancel" as text. Reconnecting a Yahoo account shows its address instead of the email field.
  With nothing connected, one sentence under it says what adding an account means, naming the
  providers offered, with a link to the Privacy Policy.
- **Ending a connection is asked about first.** Disconnect (Remove calendar, for a calendar link)
  opens a small question in its place: "Disconnect this Google account?", what that does, and
  that Koyomi's own events stay as they are, with Cancel (which has the focus) and Disconnect in
  vermilion. The words say no more than is true: Google is asked to end Koyomi's access,
  Microsoft offers apps no way to, a Yahoo app password keeps working at Yahoo until it is
  deleted there, and a calendar link keeps working wherever else it is used.
  Deleting an event of Koyomi's own is not asked about.
- **Trouble is noticed.** What says something did not happen (a link that gave no calendar, an app password Yahoo refused, an
  account that needs reconnecting or can't be read, a Refresh that could not read something) is
  set in `verm-text` with a small outlined mark before it, apart from the advice around it. No
  banners, no toasts. What is only news (a calendar was removed) stays in `ink2`.
  Refresh and when things were last read are text at the foot, with "Install Koyomi" when the
  browser offers it. No avatars, no provider logos, no account screen, nothing about how an
  account is connected.
- **With more than one account, each is one line until it is opened.** The address, how many of
  its calendars are shown ("2 of 3") in muted figures, and a small "›" that turns down when it is
  open. Pressing the line opens or folds it; the calendars and Disconnect are only inside. Each
  device remembers which it has open. An account that needs reconnecting, or can't be read,
  opens by itself; if the person folds it, its line says so instead of the count. With one
  account there is nothing to fold, and its calendars are simply there.
- **Accounts are told apart by their address and nothing else.** No colour for each account, on
  the list or on the calendar.

What went with Plan: the list of things waiting and its count, "Completed", the "＋ Add" field,
dragging a thing onto the week, the "Choose a time for…" pill, "Mark done" and "Back to Plan" in
an event's details, and the struck-through title of a done event.

## Connected calendars

For someone who connects nothing, the calendar is as above. These are the additions for someone
who does. Taken with `npm run screenshots -- --connected` against `npm run preview:connected`,
which stands in for Google with two made-up accounts, and for Microsoft with one; the two
pictures with Microsoft with `npm run screenshots -- --microsoft`.

| View | |
| --- | --- |
| Desktop Week with Google events | [light](desktop-week-google-light.png), [dark](desktop-week-google-dark.png) |
| A Google event open | [desktop-google-event-light.png](desktop-google-event-light.png) |
| Calendars with two accounts, folded | [desktop-calendars-light.png](desktop-calendars-light.png) |
| Calendars with one account opened | [desktop-calendars-open-light.png](desktop-calendars-open-light.png) |
| Phone Calendars with two accounts | [mobile-calendars-google-light.png](mobile-calendars-google-light.png) |
| Phone Day with Google events | [mobile-day-google-light.png](mobile-day-google-light.png) |
| Calendars with Google and Microsoft accounts | [desktop-calendars-microsoft-light.png](desktop-calendars-microsoft-light.png) |
| Add calendar account, choosing where | [desktop-calendars-choice-light.png](desktop-calendars-choice-light.png) |
| Connecting Yahoo: the form | [desktop-calendars-yahoo-form-light.png](desktop-calendars-yahoo-form-light.png) |
| A Yahoo account in Calendars | [desktop-calendars-yahoo-light.png](desktop-calendars-yahoo-light.png) |

![Desktop Week with Google events, light](desktop-week-google-light.png)

- **Outline for theirs, tint for yours.** An event from a connected calendar is drawn on plain
  paper with a hairline outline and a grey bar; a Koyomi event keeps its tint and its colour.
  Its title is one text level lighter (`ink2`, regular weight) and its time is `muted`. Quieter,
  never faint: both still meet the same contrast as everything else. No provider logo and no
  provider colours.
- **It can be looked at, not changed.** Opening one shows its title, time, and "Google Calendar ·"
  (or "Microsoft ·") with the calendar's name, then the address of the account that calendar is
  in on a line of its own, in the same quiet type; beside a ring where a Koyomi event has a
  coloured dot. The only action is Open in Google Calendar, or Open in Outlook. It cannot be
  dragged, resized or deleted. Events from either provider look the same on the calendar.
- **The all-day row.** A slim row under the day headings, there only when the days in view have
  something in it. Koyomi's all-day events are tinted, external ones outlined, and one that runs
  for several days is a single bar across them. Two rows show; more fold into "+n", which opens
  the rest. An event of Koyomi's own moves in and out of the row with "All day" and "Set a time"
  in its details.
- **Trouble is one line, and says which trouble.** If the Koyomi sign-in has ended: "Sign in
  again to update Google Calendar". If Google itself has refused an account's permission:
  "Google Calendar needs reconnecting". Either appears as a small pill at the bottom of the
  calendar, and the two are never confused. In Calendars the first is a line with "Sign in", and
  the second is "Needs reconnecting" with "Reconnect", under the one account it is true of; the
  other accounts look as they always do. Being offline, or Google being slow, shows nothing at
  all. The words name the provider of the accounts concerned: "Microsoft calendar needs
  reconnecting", and "Calendars need reconnecting" or "your calendars" where both are. A
  Microsoft account that Microsoft will not let be read at all says so under it in one muted
  line, with nothing to press but Disconnect. Folded, these show on the account's own line as
  "Needs reconnecting" or "Can’t be read".

## Differences from the prototype

Each of these was needed for a real calendar and was kept as small as possible:

- A search icon in both headers.
- The event popover edits in place (title, times, day) and has one extra row for colour and repeat.
  Its one action is Delete.
- The timeline covers 00:00 to 24:00 instead of 06:00 to 23:00.
- Overlapping events sit side by side.
- Text fields are 16px on phones, so iOS does not zoom when one is focused.
- The first visit follows the system's light or dark setting; after that the user's choice is kept.
  The switch is named "Dark theme" and says whether it is on, to assistive technology and on hover.
- An event's details have a quiet × to close them, as well as a tap elsewhere or Escape.
- The landing page's "Open Koyomi" is a hairline pill in ink, with its arrow in `verm-text`.
- When the browser can install Koyomi, one line at the foot of Calendars says "Install Koyomi".
  It is absent everywhere else: in Safari and Firefox, at any address but `app.koyomi.guru`, and
  once the app is installed.
- Plan, which the prototype had, is gone, and Calendars is in its place (see above).
- The app starts empty. The sample week exists only in these screenshots.

## The original prototype

The Claude Design export (`Kayomi (1).html`, about 16 MB, almost all of it embedded font data) is
deliberately not in the repository. It is listed in `.gitignore`. These screenshots and the
production code are the reference from here on.
