// The settings that switch calendar connections on and point them at the stand-in providers
// (providers.mjs) instead of 6Away Auth and Google. Used by the browser tests and by
// `npm run preview:connected`. Every value is made up: none is a real secret, and a deployment
// on Vercel ignores the two KOYOMI_TEST settings whatever they say.

export const PORT = 4310;
export const FAKE_PORT = 4315;

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
};

const local = (day, time) => new Date(`${day}T${time}:00`).toISOString();

/**
 * A made-up Google account for looking at the feature by hand and for the design screenshots:
 * the week of Monday 5 October 2026, with neutral names. Times are on this machine's clock.
 */
export const DEMO_ACCOUNT = {
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
