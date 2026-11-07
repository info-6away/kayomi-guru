import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { AiConsent, type ConsentGroup } from '@/components/AiConsent';
import { JOB_TIMEOUT_MS, inTurn, storeFor } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { aiConfig } from '@/lib/server/ai/config';
import { CONSENT_COOKIE, formToken, openPending } from '@/lib/server/ai/consent';
import { listing } from '@/lib/server/listing';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Allow read-only access — Koyomi', robots: { index: false, follow: false } };

const WRAP = 'mx-auto w-full max-w-[640px] px-6';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className={`${WRAP} flex items-center gap-2.5 pt-7`}>
        <span className="size-[9px] rounded-full bg-verm" />
        <span className="pb-0.5 font-mincho text-[21px] leading-none">koyomi</span>
      </header>
      <main className={`${WRAP} flex-1 pt-[clamp(40px,8vh,88px)] pb-16`}>{children}</main>
    </div>
  );
}

function Notice({ title, text, action }: { title: string; text: string; action?: { href: string; label: string } }) {
  return (
    <Frame>
      <h1 className="font-mincho text-[clamp(26px,4vw,34px)] leading-[1.3] font-normal">{title}</h1>
      <p className="mt-4 text-[15px] leading-[1.8] text-ink2">{text}</p>
      {action && (
        <a href={action.href} className="mt-8 inline-flex h-11 items-center rounded-full border border-ink px-6 text-[14px] tracking-[.03em] hover:bg-ink hover:text-bg">
          {action.label}
        </a>
      )}
    </Frame>
  );
}

/**
 * Where a person decides what an AI assistant may read (docs/MCP.md): every calendar they have
 * connected, read now, none chosen until they choose it.
 */
export default async function ConsentPage() {
  const config = aiConfig();
  if (!config) notFound();
  const pending = openPending(config, (await cookies()).get(CONSENT_COOKIE)?.value);
  if (!pending) return <Notice title="This request has ended" text="Requests to connect an assistant last ten minutes. Go back to the assistant and connect Koyomi again." />;
  const user = await auth.getCurrentUser();
  if (!user) return <Notice title="Sign in to continue" text={`${pending.label} asked to read some of your calendars through Koyomi. Sign in first, then choose which.`} action={{ href: `/api/auth/signin?returnTo=${encodeURIComponent('/ai/consent')}`, label: 'Sign in' }} />;

  const ctx = { config: config.connections, store: storeFor(config.connections), subject: user.sub };
  const deadline = AbortSignal.timeout(JOB_TIMEOUT_MS);
  const connections = await ctx.store.list(user.sub);
  const listed = await inTurn(connections, 5, (connection) => listing(ctx, connection, deadline).catch(() => null));
  const groups: ConsentGroup[] = listed
    .filter((each) => each !== null)
    .map((each) => ({ connectionId: each.connectionId, provider: each.provider, account: each.account, readable: each.state === 'ok', calendars: each.calendars.map((c) => ({ calendarId: c.calendarId, name: c.name })) }));

  return (
    <Frame>
      <AiConsent label={pending.label} host={pending.host} groups={groups} form={formToken(config, pending, user.sub)} />
    </Frame>
  );
}
