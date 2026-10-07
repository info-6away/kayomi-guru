import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Provider tokens are sealed before they are stored and opened only to be used.
// AES-256-GCM: the database holds nothing that can be read or altered without the key, and the
// key lives only in the server's environment.

const VERSION = 'v1';

function keyFrom(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes)');
  return Buffer.from(hex, 'hex');
}

/**
 * @param context What the secret belongs to, such as `user:provider`. It is not stored, but the
 *                same value is needed to open the seal, so a sealed token copied onto another
 *                user's row cannot be opened there.
 */
export function seal(secret: string, keyHex: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyHex), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Throws if the seal was made with another key or context, or has been changed in any way. */
export function open(sealed: string, keyHex: string, context: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('Not a sealed value');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyHex), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
