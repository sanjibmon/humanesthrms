// Gratuity, statutory bonus, leave encashment.

import type { BonusParams, GratuityParams } from './params';
import { roundRupee } from './util';

export type EmploymentType = 'permanent' | 'fixed_term';

export interface ServicePeriod {
  years: number;
  months: number;
  days: number;
  /** Completed years for gratuity: part of a year above six months counts as a full year. */
  completedYears: number;
}

/** Service between two ISO dates (join date inclusive to last working day inclusive). */
export function serviceBetween(joinIso: string, lastDayIso: string): ServicePeriod {
  const j = new Date(joinIso + 'T00:00:00Z');
  const l = new Date(lastDayIso + 'T00:00:00Z');
  l.setUTCDate(l.getUTCDate() + 1); // inclusive of the last day
  let years = l.getUTCFullYear() - j.getUTCFullYear();
  let months = l.getUTCMonth() - j.getUTCMonth();
  let days = l.getUTCDate() - j.getUTCDate();
  if (days < 0) {
    months -= 1;
    const prevMonthEnd = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 0)).getUTCDate();
    days += prevMonthEnd;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const roundUp = months > 6 || (months === 6 && days > 0);
  return { years, months, days, completedYears: years + (roundUp ? 1 : 0) };
}

export interface GratuityInput {
  /** Last drawn monthly wages under the Code (basic + DA, with the 50% rule add-back). */
  monthlyWages: number;
  joinDate: string;
  lastWorkingDay: string;
  employmentType: EmploymentType;
  /** Death or disablement waives the minimum service period. */
  deathOrDisability?: boolean;
}

export interface GratuityResult {
  eligible: boolean;
  amount: number;
  completedYears: number;
  reason: string;
  capped: boolean;
}

export function computeGratuity(inp: GratuityInput, p: GratuityParams): GratuityResult {
  const svc = serviceBetween(inp.joinDate, inp.lastWorkingDay);
  const minYears = inp.employmentType === 'fixed_term' ? p.minYearsFixedTerm : p.minYearsPermanent;
  // Eligibility uses actual continuous service, not the rounded-up figure.
  const actualYears = svc.years + svc.months / 12 + svc.days / 365;
  if (!inp.deathOrDisability && actualYears < minYears) {
    return { eligible: false, amount: 0, completedYears: svc.completedYears, reason: `Needs ${minYears} year(s) of service; has ${actualYears.toFixed(2)}`, capped: false };
  }
  const raw = roundRupee((inp.monthlyWages * 15 * svc.completedYears) / 26);
  const amount = Math.min(raw, p.maxAmount);
  return { eligible: true, amount, completedYears: svc.completedYears, reason: inp.deathOrDisability ? 'Death or disablement: no minimum service' : 'Eligible', capped: raw > p.maxAmount };
}

export interface BonusInput {
  /** Monthly wages (basic + DA) used for the eligibility test. */
  monthlyWages: number;
  /** Applicable minimum wage for the state/scheduled employment; 0 if unknown. */
  minimumWage: number;
  monthsWorked: number;
  daysWorked: number;
  /** Bonus percentage (8.33 to 20). */
  pct: number;
}

export interface BonusResult {
  eligible: boolean;
  calcBase: number;
  amount: number;
  reason: string;
}

export function computeBonus(inp: BonusInput, p: BonusParams): BonusResult {
  if (inp.pct < p.minPct - 1e-9 || inp.pct > p.maxPct + 1e-9) {
    throw new Error(`Bonus percentage must be between ${p.minPct} and ${p.maxPct}`);
  }
  if (inp.monthlyWages > p.eligibilityCeiling) return { eligible: false, calcBase: 0, amount: 0, reason: `Wages above Rs ${p.eligibilityCeiling}` };
  if (inp.daysWorked < 30) return { eligible: false, calcBase: 0, amount: 0, reason: 'Worked fewer than 30 days in the accounting year' };
  const ceiling = Math.max(p.calcFloor, inp.minimumWage);
  const calcBase = Math.min(inp.monthlyWages, ceiling);
  const amount = roundRupee(calcBase * inp.monthsWorked * (inp.pct / 100));
  return { eligible: true, calcBase, amount, reason: 'Eligible' };
}

export function leaveEncashment(monthlyWages: number, days: number, divisor = 26): number {
  return roundRupee((monthlyWages / divisor) * days);
}
