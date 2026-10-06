# Koyomi design baseline

The production app as it stands at the first local-first milestone (October 2026) is the approved
Koyomi visual baseline. It was ported from the approved Claude Design prototype and checked against
it side by side.

Do not redesign it. New work should be built in the same visual language, and any change to the look
below needs approval first.

## Screenshots

Taken from the production build with a neutral sample week, the clock set to Monday
5 October 2026, 14:25. Desktop is 1440×900; phone is 390×844 at twice the pixel density.

| View | Light | Dark |
| --- | --- | --- |
| Desktop Week | [desktop-week-light.png](desktop-week-light.png) | [desktop-week-dark.png](desktop-week-dark.png) |
| Desktop Week + Plan | [desktop-week-plan-light.png](desktop-week-plan-light.png) | [desktop-week-plan-dark.png](desktop-week-plan-dark.png) |
| Desktop Month | [desktop-month-light.png](desktop-month-light.png) | |
| Phone Day | [mobile-day-light.png](mobile-day-light.png) | [mobile-day-dark.png](mobile-day-dark.png) |
| Phone Plan | [mobile-plan-light.png](mobile-plan-light.png) | |

Month and the phone Plan sheet are shown in light only: dark changes their palette and nothing else.

![Desktop Week, light](desktop-week-light.png)

![Desktop Week with Plan, dark](desktop-week-plan-dark.png)

## What makes it Koyomi

- **Two palettes.** Light is warm paper; dark is ink at night. Every colour is a token in
  [app/globals.css](../../app/globals.css). The one accent is vermilion, used for the logo dot,
  today and the current time. Event colours are indigo (work), matcha (life), vermilion (focus)
  and stone (other).
- **Two typefaces.** Shippori Mincho for the wordmark, dates and titles; Zen Kaku Gothic New for
  everything else.
- **Week first on a desktop, one day on a phone.** Below 760px the layout changes rather than
  shrinks: a week strip, a single day, and Plan as a bottom sheet.
- **Plan is a drawer.** 320px wide; it sits beside the calendar from 1100px and slides over it below
  that. Completed items stay collapsed at its foot.
- **Events are quiet.** A 2px colour bar and a 6% tint of the same colour; 16% when selected;
  struck through when a Plan item is done. Once past, the bar and tint drop to half strength and
  the text goes one step lighter. At night the whole block fades to half instead.
- **Quiet structure, readable information.** On paper, the words a day is read by (event titles
  and times, hour labels, weekday labels) are set darker than the chrome around them. The
  background, the grid lines and the header controls stay faint.
- **The working day is on screen.** The hour height follows the window (44 to 58px) and the timeline
  opens just after 07:30, so about 08:00 to 20:00 is visible without scrolling.
- **Creation is one line.** Click a time, type, Enter: `14:00 │ What are you doing?`

## Differences from the prototype

Each of these was needed for a real calendar and was kept as small as possible:

- A search icon in both headers.
- The event popover edits in place (title, times, day) and has one extra row for colour and repeat.
  Mark done and Back to Plan appear only on events that came from Plan.
- The timeline covers 00:00 to 24:00 instead of 06:00 to 23:00.
- Overlapping events sit side by side.
- Text fields are 16px on phones, so iOS does not zoom when one is focused.
- The first visit follows the system's light or dark setting; after that the user's choice is kept.
- The app starts empty. The sample week exists only in these screenshots.

## The original prototype

The Claude Design export (`Kayomi (1).html`, about 16 MB, almost all of it embedded font data) is
deliberately not in the repository. It is listed in `.gitignore`. These screenshots and the
production code are the reference from here on.
