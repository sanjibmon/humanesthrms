// Monthly payroll for one employee: proration -> earnings -> Labour Code wages -> PF / ESI / PT / LWF / TDS -> net.

import type { StatutoryParams } from './params';
import type { SalaryStructure } from './structure';
import { computeWages } from './wages';
import type { WageDefinition, WageLine, WageResult } from './wages';
import { computePf } from './pf';
import type { PfResult } from './pf';
import { computeEsi } from './esi';
import type { EsiResult } from './esi';
import { computePt } from './pt';
import type { PtResult } from './pt';
import { computeLwf } from './lwf';
import type { LwfResult } from './lwf';
import { computeMonthlyTds } from './tds';
import type { Declarations, MonthlyTdsResult, Regime } from './tds';
import { monthsRemainingInFy, parseMonth, roundRupee, sum, taxYearOf } from './util';

export interface YtdTotals {
  taxableGross: number;
  basicDa: number;
  hra: number;
  employeePf: number;
  pt: number;
  tds: number;
}

export function emptyYtd(): YtdTotals {
  return { taxableGross: 0, basicDa: 0, hra: 0, employeePf: 0, pt: 0, tds: 0 };
}

export interface VariablePay {
  overtimeHours?: number;
  /** Commission / incentive: excluded from wages, taxable. */
  incentives?: number;
  /** Arrears of wages (counts as wages, taxable). */
  arrears?: number;
  /** One-time bonus: excluded from wages, taxable. */
  bonus?: number;
  /** Non-taxable reimbursements paid through payroll. */
  reimbursements?: number;
}

export interface VoluntaryDeductions {
  loanEmi?: number;
  advanceRecovery?: number;
  other?: number;
}

export interface EmployeeMonthInput {
  employeeId: string;
  name?: string;
  /** YYYY-MM */
  month: string;
  /** Work-location state code for PT / LWF, e.g. "MH". */
  state: string;
  gender?: 'M' | 'F' | 'O';
  structure: SalaryStructure;
  calendar: { totalDays: number; paidDays: number };
  variable?: VariablePay;
  deductions?: VoluntaryDeductions;
  flags: { pf: boolean; pfOnActual?: boolean; esi: boolean; pt: boolean; lwf: boolean };
  /** Covered by ESI at the start of the current contribution period (or earlier in it). */
  esiLockedInForPeriod?: boolean;
  tax: {
    regime: Regime;
    declarations?: Declarations;
    ytd: YtdTotals;
    previousEmployer?: { income: number; tds: number };
  };
  ptContext?: { halfYearGross?: number };
  options: {
    params: StatutoryParams;
    wageDefinition?: WageDefinition;
    /** ESI wages include overtime. Default true (confirm with ESIC advice for your establishment). */
    esiIncludesOvertime?: boolean;
    /** Overtime divisor: working days per month and hours per day for the hourly rate. */
    overtimeBasis?: { daysPerMonth: number; hoursPerDay: number; multiplier: number };
  };
}

export interface PayslipLine {
  code: string;
  name: string;
  amount: number;
  note?: string;
}

export interface EmployeePayroll {
  employeeId: string;
  name?: string;
  month: string;
  paidDays: number;
  totalDays: number;
  lopDays: number;
  earnings: PayslipLine[];
  reimbursements: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  wages: WageResult;
  pf: PfResult | null;
  esi: EsiResult | null;
  pt: PtResult;
  lwf: LwfResult;
  tds: MonthlyTdsResult;
  /** Year-to-date totals after this month, to feed the next month's payroll. */
  nextYtd: YtdTotals;
  warnings: string[];
}

export function computeEmployeeMonth(inp: EmployeeMonthInput): EmployeePayroll {
  const { params } = inp.options;
  const wageDef: WageDefinition = inp.options.wageDefinition ?? 'labour_code';
  const warnings: string[] = [];
  const { month: calMonth } = parseMonth(inp.month);

  const totalDays = inp.calendar.totalDays;
  const paidDays = Math.min(totalDays, Math.max(0, inp.calendar.paidDays));
  const lopDays = totalDays - paidDays;
  const factor = totalDays > 0 ? paidDays / totalDays : 0;

  // 1. Earnings from the structure, pro-rated for loss of pay.
  const earnings: PayslipLine[] = [];
  const wageLines: WageLine[] = [];
  let basicDaEarned = 0;
  let hraEarned = 0;
  let taxableEarned = 0;
  let recurringTaxableFull = 0;
  let basicDaFull = 0;
  let hraFull = 0;
  for (const c of inp.structure.components) {
    const earned = c.prorate ? roundRupee(c.monthly * factor) : c.monthly;
    if (earned > 0 || c.showInPayslip) earnings.push({ code: c.code, name: c.name, amount: earned });
    wageLines.push({ code: c.code, amount: earned, treatment: c.treatment });
    if (c.isBasic) basicDaEarned += earned;
    if (c.isBasic) basicDaFull += c.monthly;
    if (c.code === 'HRA') {
      hraEarned += earned;
      hraFull += c.monthly;
    }
    if (c.taxable) {
      taxableEarned += earned;
      recurringTaxableFull += c.monthly;
    }
  }

  // 2. Variable pay.
  const v = inp.variable ?? {};
  const ot = inp.options.overtimeBasis ?? { daysPerMonth: 26, hoursPerDay: 8, multiplier: 2 };
  let overtimePay = 0;
  if ((v.overtimeHours ?? 0) > 0) {
    const hourly = basicDaFull / ot.daysPerMonth / ot.hoursPerDay;
    overtimePay = roundRupee(hourly * ot.multiplier * (v.overtimeHours as number));
    earnings.push({ code: 'OT', name: 'Overtime', amount: overtimePay, note: `${v.overtimeHours} h at ${ot.multiplier}x` });
    wageLines.push({ code: 'OT', amount: overtimePay, treatment: 'excluded' });
    taxableEarned += overtimePay;
  }
  if ((v.incentives ?? 0) > 0) {
    earnings.push({ code: 'INCENTIVE', name: 'Incentive', amount: v.incentives as number });
    wageLines.push({ code: 'INCENTIVE', amount: v.incentives as number, treatment: 'excluded' });
    taxableEarned += v.incentives as number;
  }
  if ((v.arrears ?? 0) > 0) {
    earnings.push({ code: 'ARREARS', name: 'Arrears', amount: v.arrears as number });
    wageLines.push({ code: 'ARREARS', amount: v.arrears as number, treatment: 'wage' });
    taxableEarned += v.arrears as number;
  }
  if ((v.bonus ?? 0) > 0) {
    earnings.push({ code: 'BONUS', name: 'Bonus', amount: v.bonus as number });
    wageLines.push({ code: 'BONUS', amount: v.bonus as number, treatment: 'excluded' });
    taxableEarned += v.bonus as number;
  }
  const reimbursements: PayslipLine[] = [];
  if ((v.reimbursements ?? 0) > 0) reimbursements.push({ code: 'REIMB', name: 'Reimbursements', amount: v.reimbursements as number });

  const gross = sum(earnings.map((e) => e.amount));
  const reimbTotal = sum(reimbursements.map((r) => r.amount));

  // 3. Labour Code wages and PF.
  const wages = computeWages(wageLines, params.wageExcludedCapPct, wageDef);
  if (wages.ruleTriggered) warnings.push(`50% wage rule added Rs ${Math.round(wages.addBack)} back to wages for PF and gratuity bases.`);

  let pf: PfResult | null = null;
  if (inp.flags.pf) {
    pf = computePf(wages.wages, params.pf, !!inp.flags.pfOnActual);
    if (pf.ceilingApplied) warnings.push(`PF wages capped at the Rs ${params.pf.wageCeiling.toLocaleString('en-IN')} statutory ceiling.`);
  }

  // 4. ESI.
  let esi: EsiResult | null = null;
  if (inp.flags.esi) {
    const esiWages = gross - (inp.options.esiIncludesOvertime === false ? overtimePay : 0);
    esi = computeEsi({ esiWages, paidDays, lockedInForPeriod: inp.esiLockedInForPeriod }, params.esi);
    if (esi.reason === 'locked_in_for_period') warnings.push('ESI continues to the end of the contribution period although wages crossed the ceiling.');
  }

  // 5. Professional Tax and LWF.
  const pt: PtResult = inp.flags.pt
    ? computePt({ state: inp.state, monthlyGross: gross, calendarMonth: calMonth, gender: inp.gender, halfYearGross: inp.ptContext?.halfYearGross, ytdPt: inp.tax.ytd.pt })
    : { amount: 0, supported: true, note: 'Not applicable' };
  if (inp.flags.pt && !pt.supported && pt.note) warnings.push(pt.note);
  const lwf: LwfResult = inp.flags.lwf ? computeLwf(inp.state, calMonth) : { employee: 0, employer: 0, supported: true, due: false };

  // 6. TDS on salary.
  const monthsRemaining = monthsRemainingInFy(inp.month);
  const futureMonths = Math.max(0, monthsRemaining - 1);
  const employeePfThis = pf ? pf.employee : 0;
  const ytd = inp.tax.ytd;
  const projectedTaxableGross = ytd.taxableGross + taxableEarned + futureMonths * recurringTaxableFull;
  const tds = computeMonthlyTds({
    regime: inp.tax.regime,
    taxYear: taxYearOf(inp.month),
    grossSalary: projectedTaxableGross,
    previousEmployerIncome: inp.tax.previousEmployer?.income,
    basicDaAnnual: ytd.basicDa + basicDaEarned + futureMonths * basicDaFull,
    hraAnnual: ytd.hra + hraEarned + futureMonths * hraFull,
    employeePfAnnual: ytd.employeePf + employeePfThis + futureMonths * employeePfThis,
    ptAnnual: ytd.pt + pt.amount + futureMonths * pt.amount,
    declarations: inp.tax.declarations,
    tdsDeductedYtd: ytd.tds,
    previousEmployerTds: inp.tax.previousEmployer?.tds,
    monthsRemaining,
  });

  // 7. Deductions.
  const deductions: PayslipLine[] = [];
  if (pf) deductions.push({ code: 'EPF', name: 'Provident Fund (Employee)', amount: pf.employee });
  if (esi && esi.employee > 0) deductions.push({ code: 'ESI', name: 'ESI (Employee)', amount: esi.employee });
  if (pt.amount > 0) deductions.push({ code: 'PT', name: 'Professional Tax', amount: pt.amount });
  if (lwf.employee > 0) deductions.push({ code: 'LWF', name: 'Labour Welfare Fund', amount: lwf.employee });
  if (tds.tdsThisMonth > 0) deductions.push({ code: 'TDS', name: 'Income Tax (TDS, s.392)', amount: tds.tdsThisMonth });
  const statutoryDeductions = sum(deductions.map((d) => d.amount));

  const available = Math.max(0, gross + reimbTotal - statutoryDeductions);
  const dedReq = inp.deductions ?? {};
  let remaining = available;
  for (const [code, name, amt] of [
    ['LOAN', 'Loan EMI', dedReq.loanEmi ?? 0],
    ['ADVANCE', 'Advance recovery', dedReq.advanceRecovery ?? 0],
    ['OTHER', 'Other deductions', dedReq.other ?? 0],
  ] as const) {
    if (amt <= 0) continue;
    const applied = Math.min(amt, remaining);
    remaining -= applied;
    deductions.push({ code, name, amount: applied, note: applied < amt ? `Only Rs ${applied} of Rs ${amt} recovered; balance carried forward` : undefined });
    if (applied < amt) warnings.push(`${name} partly recovered so net pay does not go below zero.`);
  }
  const totalDeductions = sum(deductions.map((d) => d.amount));
  if (gross > 0 && totalDeductions > 0.5 * gross) warnings.push('Total deductions exceed 50% of wages; check against the Code on Wages limit on deductions.');
  const net = gross + reimbTotal - totalDeductions;

  // 8. Employer contributions.
  const employerContributions: PayslipLine[] = [];
  if (pf) {
    employerContributions.push({ code: 'ER_EPF', name: 'Employer EPF (3.67%)', amount: pf.epf });
    employerContributions.push({ code: 'ER_EPS', name: 'Employer EPS (8.33%)', amount: pf.eps });
    employerContributions.push({ code: 'ER_EDLI', name: 'EDLI', amount: pf.edli });
    employerContributions.push({ code: 'ER_ADMIN', name: 'EPF admin charges', amount: pf.admin });
  }
  if (esi && esi.employer > 0) employerContributions.push({ code: 'ER_ESI', name: 'ESI (Employer)', amount: esi.employer });
  if (lwf.employer > 0) employerContributions.push({ code: 'ER_LWF', name: 'LWF (Employer)', amount: lwf.employer });
  const employerCost = gross + sum(employerContributions.map((e) => e.amount));

  const nextYtd: YtdTotals = {
    taxableGross: ytd.taxableGross + taxableEarned,
    basicDa: ytd.basicDa + basicDaEarned,
    hra: ytd.hra + hraEarned,
    employeePf: ytd.employeePf + employeePfThis,
    pt: ytd.pt + pt.amount,
    tds: ytd.tds + tds.tdsThisMonth,
  };

  return {
    employeeId: inp.employeeId,
    name: inp.name,
    month: inp.month,
    paidDays,
    totalDays,
    lopDays,
    earnings,
    reimbursements,
    deductions,
    employerContributions,
    gross,
    totalDeductions,
    net,
    employerCost,
    wages,
    pf,
    esi,
    pt,
    lwf,
    tds,
    nextYtd,
    warnings,
  };
}
