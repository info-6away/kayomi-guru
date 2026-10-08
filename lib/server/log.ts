// What the server writes to its log when something about a calendar connection goes wrong.
// A log is read by more people, and kept longer, than a database row: nothing that could be a
// token, a code or a sealed value is ever allowed into it, whatever error carried it there.

/** Long unbroken runs of token-like characters: tokens, codes, sealed values, keys, ids. */
const SECRET_LIKE = /[A-Za-z0-9_\-./+=]{32,}/g;

/** An error as one short line that is safe to log. */
export function describe(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown';
  return `${name}: ${message.replace(SECRET_LIKE, '[withheld]').replace(/\s+/g, ' ').slice(0, 200)}`;
}

export const report = (where: string, error: unknown) => console.error(`[calendars] ${where}: ${describe(error)}`);
