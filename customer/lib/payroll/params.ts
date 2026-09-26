// Effective-dated statutory parameter registry.
//
// Nothing statutory is hard-coded inside calculators. Every rate or ceiling is an entry here with an
// effective date, a status and a source. In production the same rows live in the `statutory_rules`
// table so HumaNest staff can publish a change (e.g. the EPFO wage ceiling) without a code release,
// and each customer can see the impact before it applies to their payroll.

import { monthEndIso } from './util';

export type RuleStatus = 'in_force' | 'announced';

export interface RuleEntry<T = number> {
  effectiveFrom: string; // ISO date, inclusive
  status: RuleStatus;
  value: T;
  source: string;
  note?: string;
}

export type RuleKey =
  | 'pf.wageCeiling'
  | 'pf.employeeRate'
  | 'pf.epsRate'
  | 'pf.employerTotalRate'
  | 'pf.edliRate'
  | 'pf.adminRate'
  | 'pf.adminMin'
  | 'esi.wageCeiling'
  | 'esi.employeeRate'
  | 'esi.employerRate'
  | 'esi.dailyWageExempt'
  | 'bonus.eligibilityCeiling'
  | 'bonus.calcFloor'
  | 'bonus.minPct'
  | 'bonus.maxPct'
  | 'gratuity.maxAmount'
  | 'gratuity.minYearsPermanent'
  | 'gratuity.minYearsFixedTerm'
  | 'wage.excludedCapPct';

export const RULES: Record<RuleKey, RuleEntry[]> = {
  'pf.wageCeiling': [
    { effectiveFrom: '2014-09-01', status: 'in_force', value: 15000, source: 'EPF Scheme 1952 (statutory wage ceiling)' },
    {
      effectiveFrom: '2026-09-17',
      status: 'announced',
      value: 25000,
      source: 'Union Cabinet decision, 16 Sep 2026 (pmindia.gov.in)',
      note: 'Approved by Cabinet on 16 Sep 2026. The official release gives no effective date; one secondary source says 17 Sep 2026. Gazette notification pending. Publish as in_force only after notification.',
    },
  ],
  'pf.employeeRate': [{ effectiveFrom: '1952-11-01', status: 'in_force', value: 0.12, source: 'EPF Scheme 1952' }],
  'pf.epsRate': [{ effectiveFrom: '1995-11-16', status: 'in_force', value: 0.0833, source: 'EPS 1995 (8.33%)' }],
  'pf.employerTotalRate': [{ effectiveFrom: '1952-11-01', status: 'in_force', value: 0.12, source: 'EPF Scheme 1952 (EPF 3.67% + EPS 8.33%)' }],
  'pf.edliRate': [{ effectiveFrom: '2000-01-01', status: 'in_force', value: 0.005, source: 'EDLI Scheme 1976 contribution 0.5% (current rate; historical effective date not tracked)' }],
  'pf.adminRate': [{ effectiveFrom: '2000-01-01', status: 'in_force', value: 0.005, source: 'EPF admin charges 0.5% (current rate; historical effective date not tracked)' }],
  'pf.adminMin': [{ effectiveFrom: '2000-01-01', status: 'in_force', value: 500, source: 'EPF admin charges minimum Rs 500 per establishment per month (current; historical effective date not tracked)' }],
  'esi.wageCeiling': [{ effectiveFrom: '2017-01-01', status: 'in_force', value: 21000, source: 'ESI Act notification, Rs 21,000 per month' }],
  'esi.employeeRate': [{ effectiveFrom: '2019-07-01', status: 'in_force', value: 0.0075, source: 'ESIC rates from 1 Jul 2019 (0.75%)' }],
  'esi.employerRate': [{ effectiveFrom: '2019-07-01', status: 'in_force', value: 0.0325, source: 'ESIC rates from 1 Jul 2019 (3.25%)' }],
  'esi.dailyWageExempt': [{ effectiveFrom: '2019-07-01', status: 'in_force', value: 176, source: 'ESIC: employee share waived at average daily wage up to Rs 176' }],
  'bonus.eligibilityCeiling': [{ effectiveFrom: '2025-11-21', status: 'in_force', value: 21000, source: 'Code on Wages 2019 s.26(1); MoLE notification Aug 2026, effective 21 Nov 2025' }],
  'bonus.calcFloor': [{ effectiveFrom: '2025-11-21', status: 'in_force', value: 7000, source: 'MoLE notification Aug 2026: higher of Rs 7,000 or applicable minimum wage' }],
  'bonus.minPct': [{ effectiveFrom: '2025-11-21', status: 'in_force', value: 8.33, source: 'Code on Wages 2019 s.26' }],
  'bonus.maxPct': [{ effectiveFrom: '2025-11-21', status: 'in_force', value: 20, source: 'Code on Wages 2019 s.26' }],
  'gratuity.maxAmount': [{ effectiveFrom: '2018-03-29', status: 'in_force', value: 2000000, source: 'Payment of Gratuity (Amendment) Act 2018; carried into Code on Social Security 2020' }],
  'gratuity.minYearsPermanent': [{ effectiveFrom: '2025-11-21', status: 'in_force', value: 5, source: 'Code on Social Security 2020' }],
  'gratuity.minYearsFixedTerm': [{ effectiveFrom: '2025-11-21', status: 'in_force', value: 1, source: 'Code on Social Security 2020: pro-rata gratuity after 1 year for fixed-term employees' }],
  'wage.excludedCapPct': [{ effectiveFrom: '2025-11-21', status: 'in_force', value: 0.5, source: 'Code on Wages 2019 s.2(y) proviso: excluded payments above 50% are added back to wages' }],
};

export interface ResolveOptions {
  /** Also apply rules whose status is 'announced' (used by the Regulatory Change Center impact simulator). */
  includeAnnounced?: boolean;
  /** Per-organisation or test overrides. Highest priority. */
  overrides?: Partial<Record<RuleKey, number>>;
  /** Alternative rule table (e.g. rows loaded from the statutory_rules table). */
  rules?: Record<RuleKey, RuleEntry[]>;
}

/** Resolve one rule as at a given month (YYYY-MM). */
export function resolveRule(key: RuleKey, month: string, opts: ResolveOptions = {}): number {
  if (opts.overrides && opts.overrides[key] !== undefined) return opts.overrides[key] as number;
  const table = (opts.rules ?? RULES)[key];
  const at = monthEndIso(month);
  let hit: RuleEntry | undefined;
  for (const e of table) {
    if (e.effectiveFrom > at) continue;
    if (e.status === 'announced' && !opts.includeAnnounced) continue;
    if (!hit || e.effectiveFrom >= hit.effectiveFrom) hit = e;
  }
  if (!hit) throw new Error(`No rule for ${key} effective at ${month}`);
  return hit.value;
}

export interface PfParams {
  wageCeiling: number;
  employeeRate: number;
  epsRate: number;
  employerTotalRate: number;
  edliRate: number;
  adminRate: number;
  adminMin: number;
}
export interface EsiParams {
  wageCeiling: number;
  employeeRate: number;
  employerRate: number;
  dailyWageExempt: number;
}
export interface BonusParams {
  eligibilityCeiling: number;
  calcFloor: number;
  minPct: number;
  maxPct: number;
}
export interface GratuityParams {
  maxAmount: number;
  minYearsPermanent: number;
  minYearsFixedTerm: number;
}
export interface StatutoryParams {
  month: string;
  pf: PfParams;
  esi: EsiParams;
  bonus: BonusParams;
  gratuity: GratuityParams;
  wageExcludedCapPct: number;
}

export function resolveStatutory(month: string, opts: ResolveOptions = {}): StatutoryParams {
  const r = (k: RuleKey) => resolveRule(k, month, opts);
  return {
    month,
    pf: {
      wageCeiling: r('pf.wageCeiling'),
      employeeRate: r('pf.employeeRate'),
      epsRate: r('pf.epsRate'),
      employerTotalRate: r('pf.employerTotalRate'),
      edliRate: r('pf.edliRate'),
      adminRate: r('pf.adminRate'),
      adminMin: r('pf.adminMin'),
    },
    esi: {
      wageCeiling: r('esi.wageCeiling'),
      employeeRate: r('esi.employeeRate'),
      employerRate: r('esi.employerRate'),
      dailyWageExempt: r('esi.dailyWageExempt'),
    },
    bonus: {
      eligibilityCeiling: r('bonus.eligibilityCeiling'),
      calcFloor: r('bonus.calcFloor'),
      minPct: r('bonus.minPct'),
      maxPct: r('bonus.maxPct'),
    },
    gratuity: {
      maxAmount: r('gratuity.maxAmount'),
      minYearsPermanent: r('gratuity.minYearsPermanent'),
      minYearsFixedTerm: r('gratuity.minYearsFixedTerm'),
    },
    wageExcludedCapPct: r('wage.excludedCapPct'),
  };
}
