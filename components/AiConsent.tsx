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

/** Who is signed in to Koyomi, as 6Away said at sign-in: shown to that person only. */
export interface ConsentAccount {
  name: string | null;
  email: string | null;
}

const PROVIDER: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft', yahoo: 'Yahoo', link: 'Calendar link' };
const LINK = 'underline decoration-line underline-offset-4 hover:text-ink';
const SWITCH_FORM = 'koyomi-ai-switch';

/**
 * The question an AI assistant's request puts to the person (docs/MCP.md): which calendars it may
 * read, none of them chosen until the person chooses, and what that does and does not give it.
 */
export function AiConsent({ label, host, groups, form, account }: { label: string; host: string; groups: ConsentGroup[]; form: string; account: ConsentAccount }) {
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

  // Every calendar that can be chosen, by the value its box sends: its name, and its provider.
  const choices = new Map(
    groups.flatMap((group) => (group.readable ? group.calendars.map((c) => [JSON.stringify([group.connectionId, c.calendarId]), { name: c.name, provider: group.provider }] as const) : [])),
  );
  const picked = [...choices].filter(([value]) => chosen.has(value)).map(([, c]) => c);
  const googlePicked = picked.some((c) => c.provider === 'google');
  const who = account.email ?? account.name ?? 'your 6Away account';

  return (
    <>
    {/* Signing out has a form of its own, so that it can never be what Enter submits. */}
    <form id={SWITCH_FORM} method="post" action="/api/oauth/decision" hidden>
      <input type="hidden" name="form" value={form} />
      <input type="hidden" name="action" value="switch" />
    </form>
    <form method="post" action="/api/oauth/decision" className="flex flex-col">
      <input type="hidden" name="form" value={form} />
      <input type="hidden" name="timezone" value={zone} />
      <h1 className="font-mincho text-[clamp(26px,4vw,34px)] leading-[1.3] font-normal text-balance">Allow {name} to read these calendars?</h1>
      <p className="mt-3 text-[13px] text-muted" data-requester>
        Asked by {Name}, which will receive the answer at {host}.
      </p>

      {/* Who this is being decided for: the signed-in person, with a safe way to be someone else. */}
      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-y border-line py-3 text-[13.5px] text-ink2" data-signed-in>
        <p className="min-w-0">
          Signed in to Koyomi as <span className="break-all text-ink">{who}</span>
        </p>
        <button type="submit" form={SWITCH_FORM} className={`text-ink2 ${LINK}`}>
          Not you? Sign out
        </button>
        <p className="w-full text-[12.5px] text-muted">Signing out ends this request. Then connect Koyomi again from {name} and sign in with the account you want.</p>
      </div>

      <p className="mt-6 text-[15px] leading-[1.8] text-pretty text-ink2">
        {Name} will receive the titles and times of events in the calendars you select, whether each lasts all day or is tentative, and the
        calendars’ names. No descriptions, places or guests.
      </p>
      <p className="mt-3 text-[15px] leading-[1.8] text-pretty text-ink2">
        While this access is in place, {name} can ask Koyomi for these calendars whenever it chooses, not only when you ask it a question, until
        you revoke it.
      </p>
      <p className="mt-3 text-[15px] leading-[1.8] text-pretty text-ink2">
        <span className="text-ink">{Name} is not part of Koyomi.</span> What it receives is kept by the company that runs it, under that company’s own
        privacy policy and terms. Revoking access later stops it reading more; it cannot take back what it already received.{' '}
        <a href="/privacy" className={LINK}>
          How Koyomi handles this
        </a>
      </p>

      {groups.length ? (
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
        <div className="mt-8 flex flex-col gap-3 text-[15px] leading-[1.8] text-ink2" data-no-calendars>
          <p>You have no connected calendars to share yet.</p>
          <p>
            <a href="/?calendars=open" target="_blank" rel="noopener" className={LINK}>
              Connect a calendar in Koyomi
            </a>
            , then come back to this page and reload it within ten minutes, or connect Koyomi again from {name}.
          </p>
        </div>
      )}

      {/* Google's calendars: what Koyomi does with them, and what it cannot answer for. Said, not ticked. */}
      {googlePicked && (
        <p className="mt-6 border-l-2 border-line pl-4 text-[14px] leading-[1.7] text-pretty text-ink2" data-google-notice>
          <span className="text-ink">Google calendars.</span> Koyomi sends their events to {name} only so that it can answer you, as Google’s Limited Use
          requirements allow, and never uses them to train AI models. What {name}’s company then does with them is set by its own terms and your
          settings there: some assistants’ personal plans may use conversations to improve their models unless you turn that off in the
          assistant’s data settings.
        </p>
      )}

      <div className="mt-8 flex flex-col gap-2 text-[14px] leading-[1.7] text-ink2">
        <p>
          <span className="text-ink">Not shared:</span> local Koyomi events stay on this device and are not included.
        </p>
        <p>Koyomi does not give {name} your Google, Microsoft, Yahoo or private-calendar credentials.</p>
        <p>
          Read-only: {name} cannot add, change or delete anything. You can revoke this at any time in Koyomi, under Calendars, AI access.{' '}
          <a href="/help" className={LINK}>
            Help
          </a>
        </p>
      </div>

      <p className="mt-8 text-[14px] leading-[1.7] text-ink2" aria-live="polite" data-chosen>
        {picked.length ? (
          <>
            <span className="text-ink">To be shared with {name}:</span> {picked.map((c) => c.name).join(', ')}.
          </>
        ) : (
          'Choose at least one calendar.'
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
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
      <p className="mt-4 text-[12.5px] text-muted">
        {chosen.size ? `${chosen.size} calendar${chosen.size === 1 ? '' : 's'} chosen. ` : ''}You will return to {host}.
      </p>
    </form>
    </>
  );
}
