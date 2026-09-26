// Employees' Provident Fund, Employees' Pension Scheme and EDLI.

import type { PfParams } from './params';
import { roundRupee } from './util';

export interface PfResult {
  /** Wages on which contributions are computed (after ceiling unless contributing on actual). */
  pfWages: number;
  /** Wages for the pension (EPS) share: never above the statutory ceiling. */
  epsWages: number;
  /** Wages for EDLI: never above the statutory ceiling. */
  edliWages: number;
  employee: number; // 12% to EPF A/c 1
  eps: number; // 8.33% of epsWages to A/c 10 (employer)
  epf: number; // employer 12% minus EPS, to A/c 1
  employerTotal: number; // 12% of pfWages
  edli: number; // 0.5% of edliWages (employer)
  admin: number; // 0.5% of pfWages (employer, before establishment minimum)
  ceilingApplied: boolean;
}

/**
 * @param earnedPfWages  Wages for the month as defined (already prorated for paid days).
 * @param onActual       True when the employee and employer contribute on actual wages above the ceiling.
 */
export function computePf(earnedPfWages: number, p: PfParams, onActual = false): PfResult {
  const wages = Math.max(0, earnedPfWages);
  const pfWages = onActual ? wages : Math.min(wages, p.wageCeiling);
  const epsWages = Math.min(pfWages, p.wageCeiling);
  const edliWages = Math.min(pfWages, p.wageCeiling);
  const employee = roundRupee(pfWages * p.employeeRate);
  const employerTotal = roundRupee(pfWages * p.employerTotalRate);
  const eps = roundRupee(epsWages * p.epsRate);
  const epf = employerTotal - eps;
  return {
    pfWages,
    epsWages,
    edliWages,
    employee,
    eps,
    epf,
    employerTotal,
    edli: roundRupee(edliWages * p.edliRate),
    admin: roundRupee(pfWages * p.adminRate),
    ceilingApplied: !onActual && wages > p.wageCeiling,
  };
}

/** Establishment-level EPF administration charge: 0.5% of total PF wages, subject to the monthly minimum. */
export function pfAdminCharges(totalPfWages: number, p: PfParams): number {
  return Math.max(p.adminMin, roundRupee(totalPfWages * p.adminRate));
}
