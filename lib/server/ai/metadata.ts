import { SCOPE, type AiConfig } from './config';

// The two documents a client reads to learn how to get access (docs/MCP.md).

/** RFC 9728: what the MCP endpoint is, and who issues its tokens. */
export const protectedResource = (config: AiConfig) => ({
  resource: config.resource,
  authorization_servers: [config.issuer],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ['header'],
  resource_name: 'Koyomi',
  resource_documentation: 'https://koyomi.guru/privacy',
});

/** RFC 8414: how Koyomi issues them. Public clients only, codes with PKCE (S256), refresh tokens rotated. */
export const authorizationServer = (config: AiConfig) => ({
  issuer: config.issuer,
  authorization_endpoint: `${config.issuer}/api/oauth/authorize`,
  token_endpoint: `${config.issuer}/api/oauth/token`,
  registration_endpoint: `${config.issuer}/api/oauth/register`,
  revocation_endpoint: `${config.issuer}/api/oauth/revoke`,
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  revocation_endpoint_auth_methods_supported: ['none'],
  scopes_supported: [SCOPE, 'offline_access'],
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
  service_documentation: 'https://koyomi.guru/privacy',
});

/** A metadata answer: public, cacheable briefly, readable from any origin (clients may fetch it from a browser). */
export const metadataResponse = (body: unknown) =>
  Response.json(body, { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
