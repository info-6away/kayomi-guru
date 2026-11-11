'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Provider } from '@/lib/calendars/types';

// The AI access page (app/ai/access): each assistant that may read some of the person's calendars,
// how many calendars at which provider, and a way to end it. From any device: everything here came
// from the server, by the person's own sign-in.

export interface ManagedGrant {
  id: string;
  label: string;
  host: string;
  createdAt: string;
  lastUsedAt: string | null;
  providers: { provider: Provider; count: number }[];
}

const PROVIDER: Record<Provider, [string, string]> = {
  google: ['Google calendar', 'Google calendars'],
  microsoft: ['Microsoft calendar', 'Microsoft calendars'],
  yahoo: ['Yahoo calendar', 'Yahoo calendars'],
  link: ['calendar link', 'calendar links'],
};
const QUIET = 'underline decoration-line underline-offset-4 hover:text-ink';
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function AiAccessList({ grants, endpoint, account }: { grants: ManagedGrant[]; endpoint: string; account: string | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const revoke = async (id: string) => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/ai/grants/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grantId: id }), cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      setConfirming(null);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <h1 className="font-mincho text-[clamp(26px,4vw,34px)] leading-[1.3] font-normal">AI access</h1>
      {account && (
        <p className="mt-3 text-[13px] text-muted">
          Signed in to Koyomi as <span className="break-all text-ink2">{account}</span>
        </p>
      )}
      <p className="mt-5 text-[15px] leading-[1.8] text-pretty text-ink2">
        These AI assistants can read calendars you chose, through Koyomi. They can only read. Revoking one ends its access at once; your
        calendars stay connected to Koyomi.
      </p>

      <div className="mt-8 flex flex-col" data-grants>
        {grants.length === 0 && (
          <p className="border-y border-line py-4 text-[15px] text-ink2">
            <span className="text-ink">No AI connections.</span> Koyomi never shares calendars with an AI unless you allow it.
          </p>
        )}
        {grants.map((grant) => {
          const count = grant.providers.reduce((n, p) => n + p.count, 0);
          const named = grant.label === 'Other MCP client' || grant.label === 'An app on this computer';
          return (
            <div key={grant.id} role="group" aria-label={`${grant.label} access`} className="flex flex-col gap-1 border-b border-line py-4 first:border-t">
              <span className="flex flex-wrap items-baseline gap-x-3">
                <span className="flex-1 text-[16px] text-ink">{grant.label}</span>
                <span className="text-[12.5px] text-muted">since {day(grant.createdAt)}</span>
              </span>
              <span className="text-[13.5px] text-ink2">
                Read-only · {count} calendar{count === 1 ? '' : 's'}
                {grant.providers.length > 0 && ` (${grant.providers.map((p) => `${p.count} ${PROVIDER[p.provider][p.count === 1 ? 0 : 1]}`).join(', ')})`}
                {named ? ` · ${grant.host}` : ''}
              </span>
              <span className="text-[12.5px] text-muted">{grant.lastUsedAt ? `Last read ${day(grant.lastUsedAt)}` : 'Not used yet'}</span>
              {confirming === grant.id ? (
                <span className="mt-2 flex flex-wrap items-center gap-3 text-[13.5px]">
                  <span className="flex-1 text-pretty text-ink2">End {grant.label}’s access? It cannot take back what it already read.</span>
                  <button onClick={() => setConfirming(null)} className={`min-h-11 px-1 text-ink2 ${QUIET}`}>
                    Keep
                  </button>
                  <button
                    onClick={() => void revoke(grant.id)}
                    disabled={busy}
                    aria-label={`Revoke ${grant.label}`}
                    className="grid h-9 place-items-center rounded-full border border-line px-4 text-[13px] text-verm-text hover:border-verm disabled:opacity-60"
                  >
                    Revoke
                  </button>
                </span>
              ) : (
                <span className="mt-1">
                  <button onClick={() => setConfirming(grant.id)} aria-label={`Revoke ${grant.label}…`} className={`min-h-11 px-1 text-[13.5px] text-ink2 ${QUIET}`}>
                    Revoke
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {failed && (
        <p role="status" className="mt-4 text-[13.5px] text-verm-text">
          Couldn’t revoke just now. Try again in a moment.
        </p>
      )}

      <div className="mt-8 flex flex-col gap-2 text-[13.5px] leading-[1.7] text-ink2">
        <p>
          Koyomi’s address for assistants: <code className="break-all font-mono text-[12.5px] text-ink">{endpoint}</code>
        </p>
        <p>Removing Koyomi inside an assistant may not end its access here: revoke it on this page.</p>
        <p>Local Koyomi events stay on your device and are never shared with an assistant.</p>
        <p className="flex flex-wrap gap-x-5">
          <a href="/" className={QUIET}>
            Open Koyomi
          </a>
          <a href="/help" className={QUIET}>
            Help
          </a>
        </p>
      </div>
    </div>
  );
}
