// Income tax on salary (TDS). Regime slabs, rebate, surcharge with marginal relief, cess.
//
// Legal references: the Income-tax Act, 2025 applies from 1 April 2026 (Tax Year 2026-27 onward).
// Salary TDS is under section 392, the annual certificate is Form 130 and the quarterly return is
// Form 138. Slab numbers below are unchanged from FY 2025-26 (Budget 2026 announced no slab change).
// Internal keys keep the familiar 80C / 80D style names; UI labels can show the new section numbers.

import { clamp, roundRupee, roundToTen } from './util';

export type Regime = 'new' | 'old';

export interface Slab {
  /** Upper bound of the slab, null for the top slab. */
  upTo: number | null;
  rate: number;
}

export interface SurchargeTier {
  above: number;
  rate: number;
}

export interface RegimeParams {
  slabs: Slab[];
  standardDeduction: number;
  rebateIncomeLimit: number;
  rebateMax: number;
  /** New regime has marginal relief at the rebate limit; old regime has none. */
  rebateMarginalRelief: boolean;
  surcharge: SurchargeTier[];
}

export interface TaxYearParams {
  label: string;
  cess: number;
  new: RegimeParams;
  old: RegimeParams;
  /** Cities where HRA exemption uses 50% of basic. */
  metroCities: string[];
  employerNpsCapPctNew: number;
  employerNpsCapPctOld: number;
  c80Cap: number;
  c80ccd1bCap: number;
  homeLoanInterestCap: number;
}

const NEW_SLABS: Slab[] = [
  { upTo: 400000, rate: 0 },
  { upTo: 800000, rate: 0.05 },
  { upTo: 1200000, rate: 0.1 },
  { upTo: 1600000, rate: 0.15 },
  { upTo: 2000000, rate: 0.2 },
  { upTo: 2400000, rate: 0.25 },
  { upTo: null, rate: 0.3 },
];
const OLD_SLABS_BELOW_60: Slab[] = [
  { upTo: 250000, rate: 0 },
  { upTo: 500000, rate: 0.05 },
  { upTo: 1000000, rate: 0.2 },
  { upTo: null, rate: 0.3 },
];

const METRO_4 = ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'];
const METRO_8 = ['Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Bengaluru', 'Hyderabad', 'Pune', 'Ahmedabad'];

function taxYear(label: string, metro: string[]): TaxYearParams {
  return {
    label,
    cess: 0.04,
    new: {
      slabs: NEW_SLABS,
      standardDeduction: 75000,
      rebateIncomeLimit: 1200000,
      rebateMax: 60000,
      rebateMarginalRelief: true,
      surcharge: [
        { above: 5000000, rate: 0.1 },
        { above: 10000000, rate: 0.15 },
        { above: 20000000, rate: 0.25 },
      ],
    },
    old: {
      slabs: OLD_SLABS_BELOW_60,
      standardDeduction: 50000,
      rebateIncomeLimit: 500000,
      rebateMax: 12500,
      rebateMarginalRelief: false,
      surcharge: [
        { above: 5000000, rate: 0.1 },
        { above: 10000000, rate: 0.15 },
        { above: 20000000, rate: 0.25 },
        { above: 50000000, rate: 0.37 },
      ],
    },
    metroCities: metro,
    employerNpsCapPctNew: 0.14,
    employerNpsCapPctOld: 0.1,
    c80Cap: 150000,
    c80ccd1bCap: 50000,
    homeLoanInterestCap: 200000,
  };
}

export const TAX_YEARS: Record<string, TaxYearParams> = {
  '2025-26': taxYear('2025-26', METRO_4),
  // 8-city HRA metro list from FY 2026-27 is reported by a secondary source; confirm final notification.
  '2026-27': taxYear('2026-27', METRO_8),
  '2027-28': taxYear('2027-28', METRO_8),
};

export function getTaxYear(label: string): TaxYearParams {
  const t = TAX_YEARS[label];
  if (!t) throw new Error(`Tax year ${label} is not configured`);
  return t;
}

export function slabTax(income: number, slabs: Slab[]): number {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    const upper = s.upTo === null ? Infinity : s.upTo;
    if (income > lower) tax += (Math.min(income, upper) - lower) * s.rate;
    lower = upper;
    if (income <= upper) break;
  }
  return tax;
}

/** Surcharge with marginal relief. Returns the surcharge amount for the given tax and income. */
export function surchargeWithRelief(tax: number, income: number, rp: RegimeParams): number {
  const tiers = rp.surcharge;
  let rate = 0;
  let tierIdx = -1;
  for (let i = 0; i < tiers.length; i++) {
    if (income > (tiers[i] as SurchargeTier).above) {
      rate = (tiers[i] as SurchargeTier).rate;
      tierIdx = i;
    }
  }
  if (tierIdx < 0) return 0;
  let surcharge = tax * rate;
  // Marginal relief: tax + surcharge must not exceed (tax + surcharge at the threshold) + income above threshold.
  const threshold = (tiers[tierIdx] as SurchargeTier).above;
  const prevRate = tierIdx > 0 ? (tiers[tierIdx - 1] as SurchargeTier).rate : 0;
  const taxAtThreshold = slabTax(threshold, rp.slabs);
  const totalAtThreshold = taxAtThreshold + taxAtThreshold * prevRate;
  const cap = totalAtThreshold + (income - threshold);
  if (tax + surcharge > cap) surcharge = Math.max(0, cap - tax);
  return surcharge;
}

export interface Declarations {
  /** Old regime: amounts declared under 80C (excluding employee PF, which the engine adds). */
  c80?: number;
  /** Old regime: NPS self contribution 80CCD(1B). */
  c80ccd1b?: number;
  /** Both regimes: employer NPS contribution 80CCD(2) (actual amount paid by employer). */
  employerNps?: number;
  /** Old regime: health insurance premium 80D (already capped by the caller for age/parents; capped again at 100000). */
  c80d?: number;
  /** Old regime: education loan interest 80E (no cap). */
  c80e?: number;
  /** Old regime: home loan interest on self-occupied property (section 24(b)). */
  homeLoanInterest?: number;
  /** Old regime: other Chapter VI-A deductions the caller has already validated (80G, 80TTA...). */
  otherChapterVIA?: number;
  /** Old regime: annual rent paid. */
  rentPaidAnnual?: number;
  /** Old regime: rented in a metro city per the tax-year list. */
  cityForHra?: string;
  /** Old regime: LTA exemption the employee proved (already limited by the caller). */
  ltaExempt?: number;
  /** Any regime: income from other sources (interest etc.). */
  otherIncome?: number;
}

export interface AnnualTaxInput {
  regime: Regime;
  taxYear: string;
  /** Projected taxable salary for the whole year, excluding exempt reimbursements. */
  grossSalary: number;
  /** Income from previous employer in the same year (Form 12B). Added to salary. */
  previousEmployerIncome?: number;
  /** Projected basic + DA for the year, used for HRA and employer NPS limits. */
  basicDaAnnual: number;
  /** Projected HRA received for the year. */
  hraAnnual: number;
  /** Projected employee PF contribution for the year (counts under 80C in old regime). */
  employeePfAnnual: number;
  /** Projected professional tax for the year (deductible in old regime only). */
  ptAnnual: number;
  declarations?: Declarations;
}

export interface AnnualTaxResult {
  regime: Regime;
  grossSalary: number;
  exemptions: { hra: number; lta: number };
  standardDeduction: number;
  professionalTaxDeduction: number;
  chapterVIA: { c80: number; c80ccd1b: number; employerNps: number; c80d: number; c80e: number; other: number; total: number };
  homeLoanInterest: number;
  taxableIncome: number;
  taxOnIncome: number;
  rebate: number;
  marginalRelief: number;
  surcharge: number;
  cess: number;
  totalTax: number;
}

export function hraExemption(p: {
  hraReceived: number;
  basicDa: number;
  rentPaid: number;
  metro: boolean;
}): number {
  if (p.hraReceived <= 0 || p.rentPaid <= 0) return 0;
  const a = p.hraReceived;
  const b = p.rentPaid - 0.1 * p.basicDa;
  const c = (p.metro ? 0.5 : 0.4) * p.basicDa;
  return Math.max(0, Math.min(a, b, c));
}

export function computeAnnualTax(input: AnnualTaxInput): AnnualTaxResult {
  const ty = getTaxYear(input.taxYear);
  const rp = ty[input.regime];
  const d = input.declarations ?? {};
  const salary = input.grossSalary + (input.previousEmployerIncome ?? 0);

  const isOld = input.regime === 'old';
  const isMetro = d.cityForHra !== undefined && ty.metroCities.includes(d.cityForHra);
  const hra = isOld
    ? hraExemption({ hraReceived: input.hraAnnual, basicDa: input.basicDaAnnual, rentPaid: d.rentPaidAnnual ?? 0, metro: isMetro })
    : 0;
  const lta = isOld ? Math.max(0, d.ltaExempt ?? 0) : 0;
  const standardDeduction = Math.min(rp.standardDeduction, Math.max(0, salary));
  const ptDeduction = isOld ? Math.max(0, input.ptAnnual) : 0;

  const employerNpsCap = (isOld ? ty.employerNpsCapPctOld : ty.employerNpsCapPctNew) * input.basicDaAnnual;
  const employerNps = clamp(d.employerNps ?? 0, 0, employerNpsCap);

  const netSalary = Math.max(0, salary - hra - lta - standardDeduction - ptDeduction);
  const other = Math.max(0, d.otherIncome ?? 0);

  let c80 = 0;
  let c80ccd1b = 0;
  let c80d = 0;
  let c80e = 0;
  let otherVIA = 0;
  let homeLoan = 0;
  if (isOld) {
    c80 = Math.min(ty.c80Cap, Math.max(0, (d.c80 ?? 0) + input.employeePfAnnual));
    c80ccd1b = Math.min(ty.c80ccd1bCap, Math.max(0, d.c80ccd1b ?? 0));
    c80d = Math.min(100000, Math.max(0, d.c80d ?? 0));
    c80e = Math.max(0, d.c80e ?? 0);
    otherVIA = Math.max(0, d.otherChapterVIA ?? 0);
    homeLoan = Math.min(ty.homeLoanInterestCap, Math.max(0, d.homeLoanInterest ?? 0));
  }
  const viaTotal = c80 + c80ccd1b + employerNps + c80d + c80e + otherVIA;
  const gross = netSalary + other - homeLoan;
  const taxableIncome = roundToTen(Math.max(0, gross - viaTotal));

  const taxOnIncome = slabTax(taxableIncome, rp.slabs);
  let rebate = 0;
  let marginalRelief = 0;
  let taxAfterRebate = taxOnIncome;
  if (taxableIncome <= rp.rebateIncomeLimit) {
    rebate = Math.min(taxOnIncome, rp.rebateMax);
    taxAfterRebate = taxOnIncome - rebate;
  } else if (rp.rebateMarginalRelief) {
    const excess = taxableIncome - rp.rebateIncomeLimit;
    if (taxOnIncome > excess) {
      marginalRelief = taxOnIncome - excess;
      taxAfterRebate = excess;
    }
  }
  const surcharge = surchargeWithRelief(taxAfterRebate, taxableIncome, rp);
  const cess = (taxAfterRebate + surcharge) * ty.cess;
  const totalTax = roundToTen(taxAfterRebate + surcharge + cess);

  return {
    regime: input.regime,
    grossSalary: salary,
    exemptions: { hra, lta },
    standardDeduction,
    professionalTaxDeduction: ptDeduction,
    chapterVIA: { c80, c80ccd1b, employerNps, c80d, c80e, other: otherVIA, total: viaTotal },
    homeLoanInterest: homeLoan,
    taxableIncome,
    taxOnIncome: roundRupee(taxOnIncome),
    rebate: roundRupee(rebate),
    marginalRelief: roundRupee(marginalRelief),
    surcharge: roundRupee(surcharge),
    cess: roundRupee(cess),
    totalTax,
  };
}

export interface MonthlyTdsInput extends AnnualTaxInput {
  /** TDS already deducted this financial year by this employer, before this month. */
  tdsDeductedYtd: number;
  /** TDS deducted by the previous employer (Form 12B / Form 16). */
  previousEmployerTds?: number;
  /** Months left in the financial year including the current month (Apr = 12 ... Mar = 1). */
  monthsRemaining: number;
}

export interface MonthlyTdsResult {
  annual: AnnualTaxResult;
  tdsThisMonth: number;
  remainingLiability: number;
}

export function computeMonthlyTds(input: MonthlyTdsInput): MonthlyTdsResult {
  const annual = computeAnnualTax(input);
  const remaining = Math.max(0, annual.totalTax - input.tdsDeductedYtd - (input.previousEmployerTds ?? 0));
  const months = Math.max(1, input.monthsRemaining);
  return { annual, tdsThisMonth: roundRupee(remaining / months), remainingLiability: remaining };
}

/** Compare regimes for the ESS "which regime saves me more" view. */
export function compareRegimes(base: Omit<AnnualTaxInput, 'regime'>): { old: AnnualTaxResult; new: AnnualTaxResult; better: Regime; saving: number } {
  const o = computeAnnualTax({ ...base, regime: 'old' });
  const n = computeAnnualTax({ ...base, regime: 'new' });
  const better: Regime = o.totalTax < n.totalTax ? 'old' : 'new';
  return { old: o, new: n, better, saving: Math.abs(o.totalTax - n.totalTax) };
}
