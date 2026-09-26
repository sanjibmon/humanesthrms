// Run-level totals and statutory file builders (ECR, bank sheet).

import type { EmployeePayroll } from './payroll';
import type { PfParams } from './params';
import { pfAdminCharges } from './pf';
import { sum } from './util';

export interface RunTotals {
  employees: number;
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
  epfEmployee: number;
  epfEmployer: number; // EPF + EPS employer share
  eps: number;
  edli: number;
  epfAdmin: number;
  esiEmployee: number;
  esiEmployer: number;
  pt: number;
  lwfEmployee: number;
  lwfEmployer: number;
  tds: number;
}

export function summariseRun(rows: readonly EmployeePayroll[], pf: PfParams): RunTotals {
  const totalPfWages = sum(rows.map((r) => r.pf?.pfWages ?? 0));
  const anyPf = rows.some((r) => r.pf);
  return {
    employees: rows.length,
    gross: sum(rows.map((r) => r.gross)),
    deductions: sum(rows.map((r) => r.totalDeductions)),
    net: sum(rows.map((r) => r.net)),
    employerCost: sum(rows.map((r) => r.employerCost)),
    epfEmployee: sum(rows.map((r) => r.pf?.employee ?? 0)),
    epfEmployer: sum(rows.map((r) => (r.pf?.epf ?? 0) + (r.pf?.eps ?? 0))),
    eps: sum(rows.map((r) => r.pf?.eps ?? 0)),
    edli: sum(rows.map((r) => r.pf?.edli ?? 0)),
    epfAdmin: anyPf ? pfAdminCharges(totalPfWages, pf) : 0,
    esiEmployee: sum(rows.map((r) => r.esi?.employee ?? 0)),
    esiEmployer: sum(rows.map((r) => r.esi?.employer ?? 0)),
    pt: sum(rows.map((r) => r.pt.amount)),
    lwfEmployee: sum(rows.map((r) => r.lwf.employee)),
    lwfEmployer: sum(rows.map((r) => r.lwf.employer)),
    tds: sum(rows.map((r) => r.tds.tdsThisMonth)),
  };
}

export interface EcrMember {
  uan: string;
  name: string;
  payroll: EmployeePayroll;
  /** Refund of advances, normally 0. */
  refundOfAdvances?: number;
}

/**
 * EPFO ECR text (hash-tilde separated) as used for the unified portal upload:
 * UAN#~#Member name#~#Gross wages#~#EPF wages#~#EPS wages#~#EDLI wages#~#EPF contribution (EE)#~#EPS contribution#~#EPF-EPS diff (ER)#~#NCP days#~#Refund of advances
 *
 * IMPORTANT: validate a generated file on the EPFO unified portal in the EPFO test/sandbox flow before
 * relying on it in production. Field layout must match the portal's current ECR specification.
 */
export function buildEcrText(members: readonly EcrMember[]): string {
  const lines: string[] = [];
  for (const m of members) {
    const p = m.payroll;
    if (!p.pf) continue;
    const name = m.name.replace(/#~#/g, ' ').replace(/[\r\n]+/g, ' ').trim();
    lines.push(
      [
        m.uan,
        name,
        Math.round(p.gross),
        Math.round(p.pf.pfWages),
        Math.round(p.pf.epsWages),
        Math.round(p.pf.edliWages),
        p.pf.employee,
        p.pf.eps,
        p.pf.epf,
        p.lopDays,
        m.refundOfAdvances ?? 0,
      ].join('#~#'),
    );
  }
  return lines.join('\n');
}

export interface BankRow {
  employeeCode: string;
  name: string;
  accountNumber: string;
  ifsc: string;
  net: number;
}

/** Simple bank transfer sheet (CSV). Bank-specific formats are produced by adapters on top of this. */
export function buildBankSheetCsv(rows: readonly BankRow[], narration: string): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = 'Employee Code,Beneficiary Name,Account Number,IFSC,Amount,Narration';
  const body = rows.map((r) => [r.employeeCode, esc(r.name), r.accountNumber, r.ifsc, r.net.toFixed(2), esc(narration)].join(','));
  return [head, ...body].join('\n');
}
