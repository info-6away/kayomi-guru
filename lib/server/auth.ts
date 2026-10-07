import 'server-only';
import { createAuthConnect } from '@6away/auth-connect';

// Signing in with 6Away, the same way every app in the ecosystem does it. Koyomi asks for it
// in exactly one place: when someone chooses to connect a calendar. The calendar itself never
// needs an account, and nothing here runs for someone who only uses Koyomi on their device.
export const auth = createAuthConnect({ cookieName: 'koyomi_session', defaultReturnTo: '/' });
