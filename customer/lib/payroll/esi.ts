// Employees' State Insurance.

import type { EsiParams } from './params';
import { ceilRupee } from './util';

export interface EsiInput {
  /** ESI wages earned in the month (gross wages incl. overtime, excl. items the Act excludes). */
  esiWages: number;
  /** Days paid in the month (used only for the average-daily-wage exemption of the employee share). */
  paidDays: number;
  /**
   * True if this employee was already covered at the start of the current contribution period
   * (Apr-Sep or Oct-Mar) or earlier in it. Coverage then continues to the end of the period even
   * if wages cross the ceiling mid-period.
   */
  lockedInForPeriod?: boolean;
}

export interface EsiResult {
  applicable: boolean;
  employee: number;
  employer: number;
  wages: number;
  reason: 'below_ceiling' | 'locked_in_for_period' | 'above_ceiling' | 'no_wages';
  employeeShareWaived: boolean;
}

export function computeEsi(input: EsiInput, p: EsiParams): EsiResult {
  const wages = Math.max(0, input.esiWages);
  if (wages === 0) {
    return { applicable: false, employee: 0, employer: 0, wages, reason: 'no_wages', employeeShareWaived: false };
  }
  let applicable = false;
  let reason: EsiResult['reason'] = 'above_ceiling';
  if (wages <= p.wageCeiling) {
    applicable = true;
    reason = 'below_ceiling';
  } else if (input.lockedInForPeriod) {
    applicable = true;
    reason = 'locked_in_for_period';
  }
  if (!applicable) {
    return { applicable, employee: 0, employer: 0, wages, reason, employeeShareWaived: false };
  }
  const avgDaily = input.paidDays > 0 ? wages / input.paidDays : wages;
  const waived = avgDaily <= p.dailyWageExempt;
  return {
    applicable,
    employee: waived ? 0 : ceilRupee(wages * p.employeeRate),
    employer: ceilRupee(wages * p.employerRate),
    wages,
    reason,
    employeeShareWaived: waived,
  };
}
