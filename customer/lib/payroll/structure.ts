// Salary structure builder: annual CTC + grade template -> monthly components.

import type { StatutoryParams } from './params';
import { computePf } from './pf';
import { computeEsi } from './esi';
import { computeWages } from './wages';
import type { WageDefinition, WageTreatment } from './wages';
import { roundRupee, sum } from './util';

export type CalcRule =
  | { type: 'pct_ctc'; pct: number }
  | { type: 'pct_basic'; pct: number }
  | { type: 'fixed'; amount: number }
  | { type: 'balance' };

export interface TemplateComponent {
  code: string;
  name: string;
  calc: CalcRule;
  /** 'wage' components count towards Labour Code wages; 'excluded' ones are on the Code's exclusion list. */
  treatment: WageTreatment;
  taxable: boolean;
  /** Pro-rated for loss of pay. */
  prorate: boolean;
  showInPayslip: boolean;
  isBasic?: boolean;
}

export interface GradeTemplate {
  grade: string;
  name: string;
  components: TemplateComponent[];
  /** CTC already contains the employer's PF / ESI / gratuity cost, so gross = CTC - those. */
  ctcIncludesEmployerCosts: boolean;
}

export interface StructureComponent {
  code: string;
  name: string;
  monthly: number;
  treatment: WageTreatment;
  taxable: boolean;
  prorate: boolean;
  showInPayslip: boolean;
  isBasic: boolean;
}

export interface SalaryStructure {
  grade: string;
  annualCtc: number;
  monthlyCtc: number;
  components: StructureComponent[];
  grossMonthly: number;
  employerMonthly: { pf: number; esi: number; gratuity: number; edliAndAdmin: number };
  /** Basic as a share of monthly CTC, for the 50% rule health check. */
  basicShareOfCtc: number;
  wageShareOfCtc: number;
  warnings: string[];
}

export interface BuildOptions {
  params: StatutoryParams;
  wageDefinition?: WageDefinition;
  /** Treat gratuity accrual (15/26 x wages / 12) as part of CTC. Default true when ctcIncludesEmployerCosts. */
  includeGratuityAccrual?: boolean;
}

export function buildStructure(annualCtc: number, template: GradeTemplate, opts: BuildOptions): SalaryStructure {
  const { params } = opts;
  const wageDef: WageDefinition = opts.wageDefinition ?? 'labour_code';
  const monthlyCtc = roundRupee(annualCtc / 12);
  const warnings: string[] = [];
  const includeGrat = opts.includeGratuityAccrual ?? template.ctcIncludesEmployerCosts;

  const basicTpl = template.components.find((c) => c.isBasic);
  if (!basicTpl) throw new Error(`Template ${template.grade} has no basic component`);

  let employer = { pf: 0, esi: 0, gratuity: 0, edliAndAdmin: 0 };
  let amounts: Record<string, number> = {};

  // Fixed-point iteration: employer costs depend on wages, wages depend on the balancing component,
  // and the balancing component depends on employer costs. Converges in a few passes.
  for (let pass = 0; pass < 8; pass++) {
    const employerCosts = template.ctcIncludesEmployerCosts ? employer.pf + employer.esi + employer.gratuity + employer.edliAndAdmin : 0;
    const available = monthlyCtc - employerCosts;

    const next: Record<string, number> = {};
    // basic first
    next[basicTpl.code] = evalCalc(basicTpl.calc, monthlyCtc, 0);
    const basic = next[basicTpl.code] as number;
    for (const c of template.components) {
      if (c.code === basicTpl.code || c.calc.type === 'balance') continue;
      next[c.code] = evalCalc(c.calc, monthlyCtc, basic);
    }
    const fixedSum = sum(Object.values(next));
    const balanceComp = template.components.find((c) => c.calc.type === 'balance');
    if (balanceComp) next[balanceComp.code] = Math.max(0, available - fixedSum);

    amounts = next;

    // employer costs from the full-month structure
    const wageLines = template.components.map((c) => ({ code: c.code, amount: amounts[c.code] ?? 0, treatment: c.treatment }));
    const employerLines = template.ctcIncludesEmployerCosts
      ? [
          { code: 'ER_PF', amount: employer.pf + employer.edliAndAdmin, treatment: 'excluded' as WageTreatment },
          { code: 'ER_ESI', amount: employer.esi, treatment: 'excluded' as WageTreatment },
          { code: 'ER_GRAT', amount: employer.gratuity, treatment: 'excluded' as WageTreatment },
        ]
      : [];
    const w = computeWages([...wageLines, ...employerLines], params.wageExcludedCapPct, wageDef);
    const pf = computePf(w.wages, params.pf);
    const gross = sum(template.components.map((c) => amounts[c.code] ?? 0));
    const esi = computeEsi({ esiWages: gross, paidDays: 30 }, params.esi);
    const gratuity = includeGrat ? roundRupee((w.wages * 15) / 26 / 12) : 0;
    const nextEmployer = { pf: pf.employerTotal, esi: esi.employer, gratuity, edliAndAdmin: pf.edli + pf.admin };
    const same = nextEmployer.pf === employer.pf && nextEmployer.esi === employer.esi && nextEmployer.gratuity === employer.gratuity && nextEmployer.edliAndAdmin === employer.edliAndAdmin;
    employer = nextEmployer;
    if (same) break;
  }

  const components: StructureComponent[] = template.components.map((c) => ({
    code: c.code,
    name: c.name,
    monthly: amounts[c.code] ?? 0,
    treatment: c.treatment,
    taxable: c.taxable,
    prorate: c.prorate,
    showInPayslip: c.showInPayslip,
    isBasic: !!c.isBasic,
  }));
  const grossMonthly = sum(components.map((c) => c.monthly));

  const employerTotal = template.ctcIncludesEmployerCosts ? employer.pf + employer.esi + employer.gratuity + employer.edliAndAdmin : 0;
  if (template.ctcIncludesEmployerCosts && grossMonthly + employerTotal > monthlyCtc + 1) {
    warnings.push('Fixed components exceed CTC after employer costs; the balancing component was set to zero.');
  }
  const basicAmt = components.find((c) => c.isBasic)?.monthly ?? 0;
  const wageLines = components.map((c) => ({ code: c.code, amount: c.monthly, treatment: c.treatment }));
  const w = computeWages(wageLines, params.wageExcludedCapPct, wageDef);
  const basicShare = monthlyCtc > 0 ? basicAmt / monthlyCtc : 0;
  if (wageDef === 'labour_code' && w.ruleTriggered) {
    warnings.push(`50% wage rule adds back Rs ${Math.round(w.addBack)} per month to wages; PF, gratuity and bonus bases rise.`);
  }
  return {
    grade: template.grade,
    annualCtc,
    monthlyCtc,
    components,
    grossMonthly,
    employerMonthly: employer,
    basicShareOfCtc: basicShare,
    wageShareOfCtc: monthlyCtc > 0 ? w.wages / monthlyCtc : 0,
    warnings,
  };
}

function evalCalc(rule: CalcRule, monthlyCtc: number, basic: number): number {
  switch (rule.type) {
    case 'pct_ctc':
      return roundRupee((monthlyCtc * rule.pct) / 100);
    case 'pct_basic':
      return roundRupee((basic * rule.pct) / 100);
    case 'fixed':
      return roundRupee(rule.amount);
    case 'balance':
      return 0;
  }
}

/** Default template set mirroring the PDF's E1..M2 grades, adapted to the Labour Codes. */
export function defaultTemplate(grade: string, opts: { metro?: boolean } = {}): GradeTemplate {
  const hraPct = opts.metro ? 50 : 40;
  return {
    grade,
    name: grade,
    ctcIncludesEmployerCosts: true,
    components: [
      { code: 'BASIC', name: 'Basic', calc: { type: 'pct_ctc', pct: 50 }, treatment: 'wage', taxable: true, prorate: true, showInPayslip: true, isBasic: true },
      { code: 'HRA', name: 'House Rent Allowance', calc: { type: 'pct_basic', pct: hraPct }, treatment: 'excluded', taxable: true, prorate: true, showInPayslip: true },
      { code: 'CONV', name: 'Conveyance Allowance', calc: { type: 'fixed', amount: 1600 }, treatment: 'excluded', taxable: true, prorate: true, showInPayslip: true },
      { code: 'SPL', name: 'Special Allowance', calc: { type: 'balance' }, treatment: 'wage', taxable: true, prorate: true, showInPayslip: true },
    ],
  };
}
