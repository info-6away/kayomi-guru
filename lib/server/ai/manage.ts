import 'server-only';
import type { Provider } from '../../calendars/types';
import type { Connection } from '../connections';
import type { AiConfig } from './config';
import { aiStoreFor } from './context';
import type { Grant } from './store';

// Who may see and end their AI connections (docs/MCP.md, "Revoking from any device"): a person AI
// access lets in, and also anyone who still holds a grant from before (taken off the allowlist, or
// public access turned off since). Ending one's own access is never refused. To everyone else
// there is nothing here, exactly as when AI access is off: nothing says the beta exists.

/** This person's grants, if they may see them; null if, for them, AI access is not there at all. */
export async function grantsToManage(config: AiConfig, subject: string): Promise<Grant[] | null> {
  const grants = await aiStoreFor(config).listGrants(subject);
  return config.allowed(subject) || grants.length > 0 ? grants : null;
}

/** How many of a grant's calendars are at each provider, from the person's own connections: nothing is asked of any provider. */
export function providersOf(grant: Grant, connections: Connection[]): { provider: Provider; count: number }[] {
  const byId = new Map(connections.map((c) => [c.id, c.provider]));
  const counts = new Map<Provider, number>();
  for (const calendar of grant.calendars) {
    const provider = byId.get(calendar.connectionId);
    if (provider) counts.set(provider, (counts.get(provider) ?? 0) + 1);
  }
  const order: Provider[] = ['google', 'microsoft', 'yahoo', 'link'];
  return order.filter((p) => counts.has(p)).map((provider) => ({ provider, count: counts.get(provider)! }));
}
