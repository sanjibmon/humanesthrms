// Bridges the database and the calculators. The database returns everything a run needs
// (app.payroll_inputs); this module turns it into engine inputs and returns the results in the shape
// app.save_pay_run_items expects. It is deliberately free of I/O so it runs in an Edge Function,
// a Node API or a test with identical results.

import { resolveStatutory } from './params';
import type { ResolveOptions, StatutoryParams } from './params';
import { buildStructure } from './structure';
import type { GradeTemplate } from './structure';
import { computeEmployeeMonth } from './payroll';
import type { EmployeePayroll, VariablePay, VoluntaryDeductions, YtdTotals } from './payroll';
import type { Declarations, Regime } from './tds';
import type { WageDefinition } from './wages';

export const ENGINE_VERSION = '0.1.0';

export interface PayrollInputsEmployee {
  employeeId: string;
  code: string;
  name: string;
  state: string;
  city?: string | null;
  gender?: 'M' | 'F' | 'O' | null;
  hasPan: boolean;
  regime: Regime;
  flags: { pf: boolean; pfOnActual: boolean; esi: boolean; pt: boolean; lwf: boolean };
  compensation: { annualCtc: number; effectiveFrom: string; grade?: string | null; template: GradeTemplate };
  calendar: { totalDays: number; paidDays: number; lopDays: number; attendanceRecorded: number };
  variable: VariablePay;
  deductions: VoluntaryDeductions;
  declarations: Declarations;
  ytd: YtdTotals;
  previousEmployer?: { income: number; tds: number } | null;
  esiLockedInForPeriod: boolean;
}

export interface PayrollInputs {
  run: { id: string; month: string; type: string; entityId: string | null };
  settings: { wageDefinition: WageDefinition; esiIncludesOvertime: boolean; dayBasis: string };
  employees: PayrollInputsEmployee[];
  skipped: { employeeId: string; code: string; reason: string }[];
}

export interface RunOutput {
  items: (EmployeePayroll & { code: string })[];
  params: StatutoryParams;
  engineVersion: string;
  skipped: PayrollInputs['skipped'];
  warnings: { employeeId: string; code: string; message: string }[];
}

export function runPayroll(inputs: PayrollInputs, opts: ResolveOptions = {}): RunOutput {
  const params = resolveStatutory(inputs.run.month, opts);
  const items: RunOutput['items'] = [];
  const warnings: RunOutput['warnings'] = [];
  const warn = (e: PayrollInputsEmployee, message: string) => warnings.push({ employeeId: e.employeeId, code: e.code, message });

  for (const e of inputs.employees) {
    const structure = buildStructure(e.compensation.annualCtc, e.compensation.template, {
      params,
      wageDefinition: inputs.settings.wageDefinition,
    });
    const result = computeEmployeeMonth({
      employeeId: e.employeeId,
      name: e.name,
      month: inputs.run.month,
      state: e.state,
      gender: e.gender ?? undefined,
      structure,
      calendar: { totalDays: e.calendar.totalDays, paidDays: e.calendar.paidDays },
      variable: e.variable,
      deductions: e.deductions,
      flags: e.flags,
      esiLockedInForPeriod: e.esiLockedInForPeriod,
      tax: {
        regime: e.regime,
        declarations: { ...e.declarations, cityForHra: e.declarations.cityForHra ?? e.city ?? undefined },
        ytd: e.ytd,
        previousEmployer: e.previousEmployer ?? undefined,
      },
      options: { params, wageDefinition: inputs.settings.wageDefinition, esiIncludesOvertime: inputs.settings.esiIncludesOvertime },
    });
    items.push({ ...result, code: e.code });
    for (const w of structure.warnings) warn(e, w);
    for (const w of result.warnings) warn(e, w);
    if (!e.hasPan) warn(e, 'No PAN on record: tax must be deducted at the higher rate under the Income-tax Act; the engine does not apply it yet');
    if (e.calendar.attendanceRecorded === 0) warn(e, 'No attendance recorded for this month: paid days assume full attendance');
    if (result.net < 0) warn(e, 'Net pay is negative');
  }
  return { items, params, engineVersion: ENGINE_VERSION, skipped: inputs.skipped, warnings };
}
