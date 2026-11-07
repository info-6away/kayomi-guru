'use client';

import { useEffect, useState } from 'react';
import type { Provider } from '@/lib/calendars/types';

export interface ConsentGroup {
  connectionId: string;
  provider: Provider;
  account: string | null;
  /** False when the account could not be read just now: none of its calendars can be chosen. */
  readable: boolean;
  calendars: { calendarId: string; name: string }[];
}

const PROVIDER: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft', yahoo: 'Yahoo', link: 'Calendar link' };

/**
 * The question an AI assistant's request puts to the person (docs/MCP.md): which calendars it may
 * read, none of them chosen until the person chooses, and what that does and does not give it.
 */
export function AiConsent({ label, host, groups, form }: { label: string; host: string; groups: ConsentGroup[]; form: string }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [zone, setZone] = useState('UTC');
  useEffect(() => {
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    } catch {}
  }, []);
  const name = label === 'Other MCP client' ? `the app at ${host}` : label === 'An app on this computer' ? 'an app on this computer' : label;
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  const toggle = (value: string) =>
    setChosen((was) => {
      const next = new Set(was);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  const any = groups.some((g) => g.readable && g.calendars.length);

  return (
    <form method="post" action="/api/oauth/decision" className="flex flex-col">
      <input type="hidden" name="form" value={form} />
      <input type="hidden" name="timezone" value={zone} />
      <h1 className="font-mincho text-[clamp(26px,4vw,34px)] leading-[1.3] font-normal text-balance">Allow {name} to read these calendars?</h1>
      <p className="mt-4 text-[15px] leading-[1.8] text-pretty text-ink2">
        {Name} will receive event titles and times from the calendars you select, and their names, when you ask it calendar-related questions.
      </p>
      <p className="mt-3 text-[15px] leading-[1.8] text-pretty text-ink2">
        <span className="text-ink">{Name} is not part of Koyomi.</span> What it receives is kept by the company that runs it, under that company’s own
        privacy policy and terms. Revoking access later stops it reading more; it cannot take back what it already received.{' '}
        <a href="/privacy" className="underline decoration-line underline-offset-4 hover:text-ink">
          How Koyomi handles this
        </a>
      </p>

      {any ? (
        <fieldset className="mt-8 flex flex-col gap-6">
          <legend className="sr-only">Calendars {name} may read</legend>
          {groups.map((group) => (
            <div key={group.connectionId} role="group" aria-label={`${PROVIDER[group.provider]}${group.account ? `, ${group.account}` : ''}`} className="flex flex-col">
              <p className="flex items-baseline gap-2 border-b border-line pb-2 text-[12px] tracking-[.04em] text-muted">
                <span>{PROVIDER[group.provider].toUpperCase()}</span>
                {group.account && <span className="min-w-0 truncate">{group.account}</span>}
              </p>
              {group.readable ? (
                group.calendars.map((calendar) => {
                  const value = JSON.stringify([group.connectionId, calendar.calendarId]);
                  return (
                    <label key={calendar.calendarId} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-line2 text-[15px]">
                      <input type="checkbox" name="calendar" value={value} checked={chosen.has(value)} onChange={() => toggle(value)} className="size-4 accent-[var(--ink)]" />
                      <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
                    </label>
                  );
                })
              ) : (
                <p className="py-3 text-[13px] text-muted">Can’t be read just now. Try again later, or reconnect it in Koyomi.</p>
              )}
            </div>
          ))}
        </fieldset>
      ) : (
        <p className="mt-8 text-[15px] leading-[1.8] text-ink2">You have no connected calendars to share. Connect one in Koyomi first, then connect the assistant again.</p>
      )}

      <div className="mt-8 flex flex-col gap-2 text-[14px] leading-[1.7] text-ink2">
        <p>
          <span className="text-ink">Not shared:</span> local Koyomi events stay on this device and are not included.
        </p>
        <p>Koyomi does not give {name} your Google, Microsoft, Yahoo or private-calendar credentials.</p>
        <p>Read-only: {name} cannot add, change or delete anything. You can revoke this at any time in Koyomi, under Calendars.</p>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          name="action"
          value="allow"
          disabled={!chosen.size}
          className="flex h-11 items-center rounded-full border border-ink px-6 text-[14px] tracking-[.03em] text-ink transition-colors duration-200 hover:bg-ink hover:text-bg disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
        >
          Allow read-only access
        </button>
        <button type="submit" name="action" value="deny" className="flex h-11 items-center px-2 text-[14px] text-ink2 hover:text-ink">
          Cancel
        </button>
      </div>
      <p className="mt-4 text-[12.5px] text-muted">{chosen.size ? `${chosen.size} calendar${chosen.size === 1 ? '' : 's'} chosen. ` : 'Choose at least one calendar. '}You will return to {host}.</p>
    </form>
  );
}
