import { createHmac } from 'node:crypto';
import { connectionsConfig, type ConnectionsConfig } from '../env';

// AI access (docs/MCP.md): Koyomi as a read-only MCP server and the OAuth authorization server in
// front of it. Off unless KOYOMI_MCP=on, and only where calendar connections themselves are set up:
// it reads nothing they cannot.

export interface AiConfig {
  connections: ConnectionsConfig;
  /** The authorization server's identifier: the app's own origin, e.g. https://app.koyomi.guru. */
  issuer: string;
  /** The MCP endpoint, and the one audience Koyomi's access tokens are issued for. */
  resource: string;
}

/** The one scope there is: reading the calendars a person chose. */
export const SCOPE = 'calendars.read';

export function aiConfig(): AiConfig | null {
  if (process.env.KOYOMI_MCP?.trim() !== 'on') return null;
  const connections = connectionsConfig();
  if (!connections) return null;
  return { connections, issuer: connections.appUrl, resource: `${connections.appUrl}/mcp` };
}

/**
 * A key of its own for each use, drawn from the sealing key (as `fingerprint()` draws its own),
 * so no two uses ever share one and there is no new secret to keep.
 */
export const keyFor = (config: AiConfig, use: 'access' | 'hash' | 'handle' | 'event' | 'form') =>
  createHmac('sha256', Buffer.from(config.connections.tokenKey, 'hex')).update(`koyomi ai ${use} v1`).digest();

/** A keyed hash, for codes and refresh tokens: what is stored cannot be used, or turned back into what was issued. */
export const hashOf = (config: AiConfig, value: string) => createHmac('sha256', keyFor(config, 'hash')).update(value).digest('base64url');

/** Whether a request arrived at the app's own host, the only one these endpoints answer on. */
export const ownHost = (request: Request, config: AiConfig) => new URL(request.url).host === new URL(config.issuer).host;
