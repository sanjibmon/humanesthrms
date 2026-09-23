/**
 * Validation that mirrors the database's own CHECK constraints, so a bad value
 * is caught in the form instead of coming back as a Postgres error code. The
 * regexes here are copied from the constraint definitions, not invented.
 */

export type Rule = (value: string) => string | null;

export const required =
  (label = 'This field'): Rule =>
  (v) =>
    v.trim() === '' ? `${label} is required.` : null;

export const maxLen =
  (n: number, label = 'This field'): Rule =>
  (v) =>
    v.length > n ? `${label} must be ${n} characters or fewer.` : null;

/** organizations_slug_check */
export const slug: Rule = (v) =>
  v === '' || /^[a-z0-9-]{3,40}$/.test(v)
    ? null
    : 'Use 3 to 40 characters: lowercase letters, numbers and hyphens only.';

/** organizations_pan_check */
export const pan: Rule = (v) =>
  v === '' || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)
    ? null
    : 'PAN looks like ABCDE1234F — five letters, four digits, one letter.';

/** organizations_tan_check */
export const tan: Rule = (v) =>
  v === '' || /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(v)
    ? null
    : 'TAN looks like ABCD12345E — four letters, five digits, one letter.';

/** organizations_gstin_check */
export const gstin: Rule = (v) =>
  v === '' || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)
    ? null
    : 'GSTIN must be the full 15 characters, e.g. 27ABCDE1234F1Z5.';

export const email: Rule = (v) =>
  v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : 'Enter a valid email address.';

export const positiveInt =
  (label = 'This field'): Rule =>
  (v) => {
    if (v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? null : `${label} must be a whole number above zero.`;
  };

export const nonNegative =
  (label = 'This field'): Rule =>
  (v) => {
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? null : `${label} cannot be negative.`;
  };

/** pay_runs_period_month_check and anything else keyed by month. */
export const periodMonth: Rule = (v) =>
  v === '' || /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(v) ? null : 'Use the form 2026-09.';

export const ifsc: Rule = (v) =>
  v === '' || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) ? null : 'IFSC looks like HDFC0001234.';

export function runRules(value: string, rules: Rule[] | undefined): string | null {
  if (!rules) return null;
  for (const r of rules) {
    const e = r(value);
    if (e) return e;
  }
  return null;
}

/** Turns "Acme India Private Limited" into "acme-india-private-limited". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
