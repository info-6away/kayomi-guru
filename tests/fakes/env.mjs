// The settings that switch calendar connections on and point them at the stand-in providers
// (providers.mjs) instead of 6Away Auth and Google. Used by the browser tests and by
// `npm run preview:connected`. Every value is made up: none is a real secret, and a deployment
// on Vercel ignores the KOYOMI_TEST settings whatever they say.

export const PORT = 4310;
export const FAKE_PORT = 4315;
/** Where the stand-in for published calendars answers (feeds.mjs): the one address a calendar link may name as it is, in tests. */
export const FAKE_LINK_PORT = 4317;

export const TEST_ENV = {
  NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
  NEXT_PUBLIC_AUTH_URL: `http://localhost:${FAKE_PORT}/idp`,
  AUTH_CLIENT_ID: 'koyomi-test',
  AUTH_CLIENT_SECRET: 'idp-secret',
  SESSION_SECRET: 'test-session-secret-0123456789abcdefghij',
  GOOGLE_CALENDAR_CLIENT_ID: 'google-test',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'google-secret',
  TOKEN_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
  // Connections are kept in memory, and this wins over any database address: a test run cannot
  // reach a real database, even on a machine that has one set for some other project.
  KOYOMI_TEST_STORE: 'memory',
  DATABASE_URL: '',
  KOYOMI_TEST_GOOGLE_URL: `http://localhost:${FAKE_PORT}/google`,
  MICROSOFT_CALENDAR_CLIENT_ID: 'microsoft-test',
  MICROSOFT_CALENDAR_CLIENT_SECRET: 'microsoft-secret',
  KOYOMI_TEST_MICROSOFT_URL: `http://localhost:${FAKE_PORT}/microsoft`,
  CALENDAR_LINKS: 'on',
  KOYOMI_TEST_LINK_ORIGIN: `http://localhost:${FAKE_LINK_PORT}`,
  // A link may be read again at once in a test, which a real server spaces out.
  KOYOMI_TEST_LINK_PACE_MS: '0',
};

const local = (day, time) => new Date(`${day}T${time}:00`).toISOString();

/**
 * Two made-up Google accounts for looking at the feature by hand and for the design
 * screenshots: the week of Monday 5 October 2026, with neutral names. Times are on this
 * machine's clock. Each is named here by its id at the stand-in; what Koyomi shows it as is the
 * id of its own calendar, as with a real account.
 */
const SECOND_ACCOUNT = {
  calendars: [
    {
      id: 'studio@example.test',
      summary: 'Studio',
      primary: true,
      selected: true,
      events: [
        { id: 'workshop', summary: 'Workshop', htmlLink: 'https://www.google.com/calendar', start: { dateTime: local('2026-10-09', '13:00') }, end: { dateTime: local('2026-10-09', '15:00') } },
        { id: 'open-day', summary: 'Open day', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } },
      ],
    },
    {
      id: 'team@example.test',
      summary: 'Team',
      selected: true,
      events: [{ id: 'retrospective', summary: 'Retrospective', start: { dateTime: local('2026-10-08', '16:30') }, end: { dateTime: local('2026-10-08', '17:30') } }],
    },
  ],
};

const FIRST_ACCOUNT = {
  calendars: [
    {
      id: 'personal@example.test',
      summary: 'Personal',
      primary: true,
      selected: true,
      events: [
        { id: 'dentist', summary: 'Dentist', htmlLink: 'https://www.google.com/calendar', start: { dateTime: local('2026-10-06', '11:30') }, end: { dateTime: local('2026-10-06', '12:30') } },
        { id: 'trip', summary: 'Trip', start: { date: '2026-10-09' }, end: { date: '2026-10-12' } },
        { id: 'birthday', summary: 'Birthday', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } },
      ],
    },
    {
      id: 'work@example.test',
      summary: 'Work',
      selected: true,
      events: [
        { id: 'standup_1', summary: 'Standup', start: { dateTime: local('2026-10-05', '09:15') }, end: { dateTime: local('2026-10-05', '09:45') } },
        { id: 'standup_2', summary: 'Standup', start: { dateTime: local('2026-10-07', '09:15') }, end: { dateTime: local('2026-10-07', '09:45') } },
        { id: 'standup_3', summary: 'Standup', start: { dateTime: local('2026-10-09', '09:15') }, end: { dateTime: local('2026-10-09', '09:45') } },
        { id: 'planning', summary: 'Quarterly planning', start: { dateTime: local('2026-10-08', '13:00') }, end: { dateTime: local('2026-10-08', '15:30') } },
        { id: 'client', summary: 'Client call', start: { dateTime: local('2026-10-05', '14:00') }, end: { dateTime: local('2026-10-05', '15:00') } },
        { id: 'interview', summary: 'Interview', start: { dateTime: local('2026-10-07', '16:00') }, end: { dateTime: local('2026-10-07', '17:00') } },
        { id: 'offsite', summary: 'Offsite', start: { date: '2026-10-08' }, end: { date: '2026-10-09' } },
      ],
    },
    { id: 'holidays@example.test', summary: 'Holidays', selected: false, events: [{ id: 'holiday', summary: 'Public holiday', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } }] },
  ],
};

/** Both, by the id each has at the stand-in, in the order they are offered to someone adding accounts by hand. */
export const DEMO_ACCOUNTS = { first: FIRST_ACCOUNT, second: SECOND_ACCOUNT };

/** A wall-clock time on this machine, as Microsoft Graph writes it when asked for UTC. */
const graph = (day, time) => `${local(day, time).slice(0, 19)}.0000000`;
const MICROSOFT_ACCOUNT = {
  kind: 'personal',
  address: 'alex@outlook.example',
  calendars: [
    {
      id: 'AAMkDemoCalendar=',
      name: 'Calendar',
      isDefaultCalendar: true,
      events: [
        { id: 'pilates', subject: 'Pilates', start: { dateTime: graph('2026-10-06', '18:00'), timeZone: 'UTC' }, end: { dateTime: graph('2026-10-06', '19:00'), timeZone: 'UTC' }, webLink: 'https://outlook.live.com/owa/?itemid=pilates' },
        { id: 'market', subject: 'Farmers market', isAllDay: true, start: { dateTime: '2026-10-10T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-11T00:00:00.0000000', timeZone: 'UTC' } },
      ],
    },
    { id: 'AAMkDemoFamily=', name: 'Family', events: [{ id: 'visit', subject: 'Visit', start: { dateTime: graph('2026-10-08', '19:30'), timeZone: 'UTC' }, end: { dateTime: graph('2026-10-08', '21:00'), timeZone: 'UTC' } }] },
  ],
};
/** The Microsoft account offered to someone adding one by hand, by its id at the stand-in. */
export const DEMO_MICROSOFT_ACCOUNTS = { personal: MICROSOFT_ACCOUNT };
