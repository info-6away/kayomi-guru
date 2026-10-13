import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

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

/**
 * A word that stands for a value without giving it away. The same value and context always come
 * to the same word, so a row can be found again by it; without the key the word cannot be turned
 * back into the value, or even checked against a guess. HMAC-SHA256, with a key of its own drawn
 * from the sealing key so that the two uses never share one.
 */
export function fingerprint(value: string, keyHex: string, context: string): string {
  const key = createHmac('sha256', keyFrom(keyHex)).update('koyomi fingerprint v1').digest();
  return createHmac('sha256', key).update(`${context}\n${value}`).digest('base64url');
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
