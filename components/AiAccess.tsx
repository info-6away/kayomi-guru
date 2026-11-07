'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ExternalCalendar } from '@/lib/calendars/types';

// AI access, at the foot of Calendars (docs/MCP.md): which AI assistants may read which calendars,
// and a way to end that. Folded until opened: it is there for the few who use it, and quiet for
// everyone else.

const ROW = 'flex min-h-11 items-center gap-3 rounded-[4px] px-3.5';
const QUIET = 'underline decoration-line underline-offset-4 hover:text-ink disabled:no-underline disabled:opacity-60';

interface AiGrant {
  id: string;
  label: string;
  host: string;
  createdAt: string;
  lastUsedAt: string | null;
  calendars: { connectionId: string; calendarId: string }[];
  /** Calendars this device does not know by name (hidden here, or not read yet). */
  unnamed: number;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function AiAccess({ calendars, mobile }: { calendars: ExternalCalendar[]; mobile: boolean }) {
  // Shown only once the server has said this person may use it: during the private beta it
  // answers 404 to everyone not on the allowlist, exactly as when AI access is off.
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<AiGrant[] | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const tap = mobile ? 'min-h-11 px-1' : '';

  const known = JSON.stringify(calendars.map((c) => ({ connectionId: c.connectionId, calendarId: c.calendarId })));
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/grants', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calendars: JSON.parse(known) }), cache: 'no-store' });
      if (response.status === 404) {
        setAllowed(false);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { endpoint: string; grants: AiGrant[] };
      setGrants(body.grants);
      setEndpoint(body.endpoint);
      setAllowed(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [known]);
  // Once to learn whether to show anything at all, and again whenever it is opened.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const revoke = async (id: string) => {
    setConfirming(null);
    try {
      await fetch('/api/ai/grants/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grantId: id }), cache: 'no-store' });
    } finally {
      await load();
    }
  };
  const copy = async () => {
    if (!endpoint) return;
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  const nameOf = (c: { connectionId: string; calendarId: string }) => calendars.find((k) => k.connectionId === c.connectionId && k.calendarId === c.calendarId)?.name;

  if (!allowed) return null;
  return (
    // Not a group of its own: in Calendars a group is an account.
    <div className="mt-5 border-t border-line pt-2" data-ai-access>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className={`${ROW} w-full text-left text-[14px] text-ink2 hover:bg-wash hover:text-ink`}>
        <span className="flex-1">AI access</span>
        {grants && grants.length > 0 && <span className="text-[12px] text-muted tabular-nums">{grants.length}</span>}
        <span aria-hidden className={`w-3 text-center text-[14px] text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-3.5 pt-1 pb-2 text-[12.5px] leading-[1.6] text-ink2">
          <p className="text-pretty">Let an AI assistant read calendars you choose, through Koyomi. It can only read: it cannot add, change or delete anything.</p>
          {endpoint && (
            <div className="flex flex-col gap-1">
              <span className="text-muted">Add this as a custom connector in Claude, ChatGPT or Grok:</span>
              <span className="flex items-center gap-3">
                <code className="min-w-0 flex-1 truncate rounded-[4px] border border-line px-2 py-1 font-mono text-[12px] text-ink">{endpoint}</code>
                <button onClick={copy} className={`flex-none text-ink2 ${QUIET} ${tap}`}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </span>
            </div>
          )}
          {failed && <p className="text-muted">Couldn’t load AI connections just now.</p>}
          {grants && grants.length === 0 && (
            <p className="text-pretty">
              <span className="text-ink">No AI connections.</span> Koyomi never shares calendars with an AI unless you explicitly authorize it.
            </p>
          )}
          {grants?.map((grant) => {
            const names = grant.calendars.map(nameOf).filter(Boolean) as string[];
            const count = grant.calendars.length + grant.unnamed;
            return (
              <div key={grant.id} role="group" aria-label={`${grant.label} access`} className="flex flex-col gap-0.5 border-b border-line2 pb-2.5">
                <span className="flex items-baseline gap-2">
                  <span className="flex-1 text-[14px] text-ink">{grant.label}</span>
                  <span className="text-muted">since {day(grant.createdAt)}</span>
                </span>
                <span className="text-muted">
                  Read-only · {count} calendar{count === 1 ? '' : 's'}
                  {grant.label === 'Other MCP client' || grant.label === 'An app on this computer' ? ` · ${grant.host}` : ''}
                </span>
                {names.length > 0 && <span className="text-pretty">{names.join(', ')}{grant.unnamed ? `, and ${grant.unnamed} more` : ''}</span>}
                {confirming === grant.id ? (
                  <span className="mt-1 flex flex-wrap items-center gap-3">
                    <span className="flex-1 text-pretty">End {grant.label}’s access? Your calendars stay connected to Koyomi.</span>
                    <button onClick={() => setConfirming(null)} className={`text-ink2 ${QUIET} ${tap}`}>
                      Keep
                    </button>
                    <button onClick={() => void revoke(grant.id)} aria-label={`Revoke ${grant.label}`} className="grid h-8 place-items-center rounded-full border border-line px-3.5 text-[12.5px] text-verm-text hover:border-verm">
                      Revoke
                    </button>
                  </span>
                ) : (
                  <span className="mt-1">
                    <button onClick={() => setConfirming(grant.id)} aria-label={`Revoke ${grant.label}…`} className={`text-ink2 ${QUIET} ${tap}`}>
                      Revoke
                    </button>
                  </span>
                )}
              </div>
            );
          })}
          <p className="text-pretty text-muted">Local Koyomi events stay on this device and are not shared with AI connections.</p>
        </div>
      )}
    </div>
  );
}
