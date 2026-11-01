import type { Provider } from './types';

// How the calendar speaks of the providers a person's calendars come from. Where only Google is
// involved, it says exactly what it always has. A calendar link is not an account: it is not
// reconnected but updated, not disconnected but removed, and it is known by its name.

export interface ProviderWords {
  /** Above its accounts in Calendars. */
  heading: string;
  /** An account whose address has not been read yet. */
  unnamed: string;
  /** In the choice of where to add an account, and in a list of them. */
  label: string;
  /** Where an event came from, in its popover. */
  source: string;
  /** The way back to an event at its provider. */
  open: string;
  /** Said of an account the provider will not let Koyomi read. */
  blocked: string;
  /** Said of one that needs the person: its permission refused, or (for a link) the link no longer working. */
  needs: string;
  /** Said under it, where there is more to say than that. */
  needsWhy: string | null;
  /** The way to mend it. */
  mend: string;
  /** The way to end it. */
  end: string;
  /** On the calendar itself, while one needs the person. */
  pill: string;
  /** Kept up to date by signing in again: "Sign in again to keep … up to date". */
  kept: string;
  /** Never changed by Koyomi: "Koyomi never changes your …". */
  yours: string;
}

const ACCOUNT = { needs: 'Needs reconnecting', needsWhy: null, mend: 'Reconnect', end: 'Disconnect' };

export const WORDS: Record<Provider, ProviderWords> = {
  google: {
    heading: 'GOOGLE',
    unnamed: 'Google account',
    label: 'Google',
    source: 'Google Calendar',
    open: 'Open in Google Calendar',
    blocked: 'Google doesn’t let Koyomi read this account’s calendar.',
    ...ACCOUNT,
    pill: 'Google Calendar needs reconnecting',
    kept: 'Google Calendar',
    yours: 'Google Calendar',
  },
  microsoft: {
    heading: 'MICROSOFT',
    unnamed: 'Microsoft account',
    label: 'Microsoft',
    source: 'Microsoft',
    open: 'Open in Outlook',
    blocked: 'Microsoft doesn’t let Koyomi read this account’s calendar.',
    ...ACCOUNT,
    pill: 'Microsoft calendar needs reconnecting',
    kept: 'your Microsoft calendar',
    yours: 'Microsoft calendar',
  },
  yahoo: {
    heading: 'YAHOO',
    unnamed: 'Yahoo account',
    label: 'Yahoo',
    source: 'Yahoo Calendar',
    // Yahoo has no address for one event, so there is no way back to show.
    open: '',
    blocked: 'Yahoo doesn’t let Koyomi read this account’s calendar.',
    ...ACCOUNT,
    pill: 'Yahoo calendar needs reconnecting',
    kept: 'your Yahoo calendar',
    yours: 'Yahoo calendar',
  },
  link: {
    heading: 'CALENDAR LINKS',
    unnamed: 'Calendar link',
    label: 'Calendar link',
    source: 'Calendar link',
    open: '',
    blocked: 'This calendar link no longer returns a valid calendar.',
    needs: 'Needs updating',
    needsWhy: 'This calendar link no longer returns a valid calendar.',
    mend: 'Update link',
    end: 'Remove calendar',
    pill: 'Calendar link needs updating',
    kept: 'your calendar links',
    yours: 'calendar',
  },
};

/** Which of the providers a sentence is about: one of them, or more than one. */
export function which(providers: Provider[]): Provider | 'several' | null {
  const distinct = [...new Set(providers)];
  return distinct.length > 1 ? 'several' : (distinct[0] ?? null);
}

/** The providers by name, as a sentence lists them: "Google", "Google and Microsoft", "Google, Microsoft and Yahoo". */
export function listed(providers: Provider[]): string {
  const names = [...new Set(providers)].map((provider) => WORDS[provider].label);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? 'Google');
}
