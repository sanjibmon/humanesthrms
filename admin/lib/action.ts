/**
 * Shared contract between server actions and the client components that call
 * them. Actions never throw at the boundary — they return a result the form can
 * render, so a constraint violation shows up next to the offending field rather
 * than as a stack trace.
 */

export type ActionOk = { ok: true; message?: string; id?: string; data?: unknown };
export type ActionErr = { ok: false; error: string; field?: string };
export type ActionResult = ActionOk | ActionErr;

export const ok = (message?: string, extra?: { id?: string; data?: unknown }): ActionOk => ({
  ok: true,
  message,
  ...extra,
});

export const fail = (error: string, field?: string): ActionErr => ({ ok: false, error, field });

/** Postgres and PostgREST speak in codes. People do not. */
export function friendly(e: { message?: string; code?: string; details?: string } | null): string {
  if (!e) return 'Something went wrong.';
  const msg = e.message ?? 'Something went wrong.';

  // Errors our own triggers raise carry a readable message already.
  if (msg.startsWith('SEAT_LIMIT_REACHED')) {
    return 'That organisation has used every seat on its licence. Add seats first.';
  }
  if (/Module .+ requires module/.test(msg)) return msg;
  if (/Core module .+ cannot be disabled/.test(msg)) return msg;
  if (/Only HumaNest staff/.test(msg)) return msg;

  switch (e.code) {
    case '23505':
      return 'That value is already taken. Pick another.';
    case '23503':
      return 'This record is still referenced elsewhere, so it cannot be changed or removed.';
    case '23514':
      return msg.includes('_check')
        ? 'One of the values does not match the format this field requires.'
        : msg;
    case '42501':
      return 'Your role does not allow this. Sign in with an account that has the permission.';
    case 'PGRST301':
    case '42P01':
      return 'Your session is not fully authenticated. Complete the authenticator step and retry.';
    default:
      return msg;
  }
}

/** Narrow unknown form input to a trimmed string. */
export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v === '' || v === null || v === undefined || Number.isNaN(n) ? null : n;
};
export const boolOf = (v: unknown): boolean => v === true || v === 'true' || v === 'on' || v === '1';
export const nullIfBlank = (v: unknown): string | null => {
  const s = str(v);
  return s === '' ? null : s;
};
