import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AiAccessList, type ManagedGrant } from '@/components/AiAccessList';
import { storeFor } from '@/lib/server/api';
import { auth } from '@/lib/server/auth';
import { aiConfig } from '@/lib/server/ai/config';
import { grantsToManage, providersOf } from '@/lib/server/ai/manage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'AI access — Koyomi', robots: { index: false, follow: false } };

const WRAP = 'mx-auto w-full max-w-[640px] px-6';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className={`${WRAP} flex items-center justify-between gap-4 pt-7`}>
        <a href="/" className="flex items-center gap-2.5" aria-label="Koyomi">
          <span className="size-[9px] rounded-full bg-verm" />
          <span className="pb-0.5 font-mincho text-[21px] leading-none">koyomi</span>
        </a>
      </header>
      <main className={`${WRAP} flex-1 pt-[clamp(40px,8vh,88px)] pb-16`}>{children}</main>
    </div>
  );
}

/**
 * The person's AI connections, from any device (docs/MCP.md, "Revoking from any device"). Read
 * from the server by the person's own sign-in alone: nothing kept on the device is needed, and no
 * calendar provider is asked anything. Under /ai/, which the service worker never answers.
 */
export default async function AiAccessPage() {
  const config = aiConfig();
  if (!config) notFound();
  const user = await auth.getCurrentUser();
  if (!user) {
    return (
      <Frame>
        <h1 className="font-mincho text-[clamp(26px,4vw,34px)] leading-[1.3] font-normal">AI access</h1>
        <p className="mt-4 text-[15px] leading-[1.8] text-ink2">Sign in to see which AI assistants can read your calendars, and to end their access.</p>
        <a href={`/api/auth/signin?returnTo=${encodeURIComponent('/ai/access')}`} className="mt-8 inline-flex h-11 items-center rounded-full border border-ink px-6 text-[14px] tracking-[.03em] hover:bg-ink hover:text-bg">
          Sign in
        </a>
      </Frame>
    );
  }
  const grants = await grantsToManage(config, user.sub);
  if (!grants) notFound();
  const connections = await storeFor(config.connections).list(user.sub);
  const managed: ManagedGrant[] = grants.map((grant) => ({
    id: grant.id,
    label: grant.clientLabel,
    host: grant.redirectHost,
    createdAt: grant.createdAt,
    lastUsedAt: grant.lastUsedAt,
    providers: providersOf(grant, connections),
  }));
  return (
    <Frame>
      <AiAccessList grants={managed} endpoint={config.resource} account={user.email ?? user.name ?? null} />
    </Frame>
  );
}
