// Small, dependency-free helpers. All money is whole rupees unless a function says otherwise.

/** Round half up to whole rupees (EPFO / payroll convention: 0.50 rounds up). */
export function roundRupee(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/** Round up to the next whole rupee (ESIC convention for contributions). */
export function ceilRupee(x: number): number {
  return Math.ceil(x - 1e-9);
}

/** Round to the nearest multiple of ten, half up (Income-tax s.288A/288B style rounding). */
export function roundToTen(x: number): number {
  return Math.floor(x / 10 + 0.5 + 1e-9) * 10;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function sum(xs: readonly number[]): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

/** 'YYYY-MM' -> { year, month } (month 1-12). */
export function parseMonth(ym: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error(`Invalid month "${ym}", expected YYYY-MM`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid month "${ym}"`);
  return { year, month };
}

export function daysInMonth(ym: string): number {
  const { year, month } = parseMonth(ym);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Indian financial year start year for a given month: Apr-Mar. 2026-09 -> 2026, 2027-02 -> 2026. */
export function fyStartYear(ym: string): number {
  const { year, month } = parseMonth(ym);
  return month >= 4 ? year : year - 1;
}

/** Tax year label used by the Income-tax Act, 2025, e.g. 2026-09 -> "2026-27". */
export function taxYearOf(ym: string): string {
  const y = fyStartYear(ym);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** Months remaining in the financial year INCLUDING the given month. Apr=12 ... Mar=1. */
export function monthsRemainingInFy(ym: string): number {
  const { month } = parseMonth(ym);
  return month >= 4 ? 12 - (month - 4) : 3 - month + 1;
}

/** ESIC contribution period: Apr-Sep or Oct-Mar. Returns 'YYYY-A' (Apr-Sep) or 'YYYY-B' (Oct-Mar). */
export function esiPeriodOf(ym: string): string {
  const { year, month } = parseMonth(ym);
  if (month >= 4 && month <= 9) return `${year}-A`;
  if (month >= 10) return `${year}-B`;
  return `${year - 1}-B`;
}

/** Last day of a month as ISO date. Rules are resolved against this date: a change that takes
 *  effect on any day of a wage month applies to that whole wage month unless the organisation
 *  chooses a later month in the Regulatory Change Center. */
export function monthEndIso(ym: string): string {
  return `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
}
