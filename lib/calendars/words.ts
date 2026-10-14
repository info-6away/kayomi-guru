import type { Provider } from './types';

// How the calendar speaks of the providers a person's calendars come from. Where only Google is
// involved, it says exactly what it always has.

export interface ProviderWords {
  /** Above its accounts in Calendars. */
  heading: string;
  /** An account whose address has not been read yet. */
  unnamed: string;
  /** In the choice of where to add an account. */
  label: string;
  /** Where an event came from, in its popover. */
  source: string;
  /** The way back to an event at its provider. */
  open: string;
  /** Said of an account the provider will not let Koyomi read. */
  blocked: string;
}

export const WORDS: Record<Provider, ProviderWords> = {
  google: {
    heading: 'GOOGLE',
    unnamed: 'Google account',
    label: 'Google',
    source: 'Google Calendar',
    open: 'Open in Google Calendar',
    blocked: 'Google doesn’t let Koyomi read this account’s calendar.',
  },
  microsoft: {
    heading: 'MICROSOFT',
    unnamed: 'Microsoft account',
    label: 'Microsoft',
    source: 'Microsoft',
    open: 'Open in Outlook',
    blocked: 'Microsoft doesn’t let Koyomi read this account’s calendar.',
  },
};

/** Which of the providers a sentence is about: one of them, or more than one. */
export function which(providers: Provider[]): Provider | 'several' | null {
  const distinct = [...new Set(providers)];
  return distinct.length > 1 ? 'several' : (distinct[0] ?? null);
}
