// Professional Tax (state levy on employment, capped at Rs 2,500 a year by Article 276).
//
// Slabs are DATA, not code. In production they live in the `professional_tax_slabs` table so an
// admin can edit them when a state notifies a change. `confidence` and `verifiedOn` drive the
// "verify before go-live" badge in the admin portal.

export type Confidence = 'high' | 'medium' | 'low';

export interface PtSlab {
  /** Inclusive lower bound of gross (monthly, or half-yearly for half-yearly states). */
  from: number;
  /** Inclusive upper bound, or null for "and above". */
  to: number | null;
  amount: number;
  /** Amount for February where the state charges a different amount. */
  febAmount?: number;
}

export interface PtState {
  code: string;
  name: string;
  frequency: 'monthly' | 'half_yearly';
  /** Calendar months (1-12) in which half-yearly tax is deducted. */
  deductionMonths?: number[];
  slabs: PtSlab[];
  annualCap: number;
  /** Women with monthly gross up to this amount are exempt. */
  womenExemptUpTo?: number;
  confidence: Confidence;
  verifiedOn: string; // ISO date of last check against public sources
  sources: string[];
  notes: string;
}

export const PT_STATES: Record<string, PtState> = {
  MH: {
    code: 'MH',
    name: 'Maharashtra',
    frequency: 'monthly',
    slabs: [
      { from: 0, to: 7500, amount: 0 },
      { from: 7501, to: 10000, amount: 175 },
      { from: 10001, to: null, amount: 200, febAmount: 300 },
    ],
    annualCap: 2500,
    womenExemptUpTo: 25000,
    confidence: 'medium',
    verifiedOn: '2026-09-19',
    sources: ['kredily.com/professional-tax-slab', 'salarybox.in PT 2026-27 guide'],
    notes: 'Slabs cross-checked in two secondary sources. Women exemption up to Rs 25,000 is flagged "confirm current notification" by one source; confirm before go-live.',
  },
  KA: {
    code: 'KA',
    name: 'Karnataka',
    frequency: 'monthly',
    slabs: [
      { from: 0, to: 24999, amount: 0 },
      { from: 25000, to: null, amount: 200, febAmount: 300 },
    ],
    annualCap: 2500,
    confidence: 'medium',
    verifiedOn: '2026-09-19',
    sources: ['saachihrms.com Karnataka PT 2026', 'calcguru.in Karnataka PT', 'greythr.com Karnataka Amendment Act 2025 notice'],
    notes: 'Amendment Act 2025 (from 1 Apr 2025): Rs 200 a month, Rs 300 in February. One source says nil "up to" Rs 25,000, two say Rs 25,000 "and above" is taxed: the exact boundary at Rs 25,000 needs confirming. An aggregator page listing Rs 150 for Rs 25,001-41,666 contradicts the amendment and was disregarded.',
  },
  TN: {
    code: 'TN',
    name: 'Tamil Nadu',
    frequency: 'half_yearly',
    deductionMonths: [9, 3],
    slabs: [
      { from: 0, to: 21000, amount: 0 },
      { from: 21001, to: 30000, amount: 135 },
      { from: 30001, to: 45000, amount: 315 },
      { from: 45001, to: 60000, amount: 690 },
      { from: 60001, to: 75000, amount: 1025 },
      { from: 75001, to: null, amount: 1250 },
    ],
    annualCap: 2500,
    confidence: 'medium',
    verifiedOn: '2026-09-19',
    sources: ['kredily.com/professional-tax-slab'],
    notes: 'Half-yearly slab on half-year gross; paid by 30 Sep and 31 Mar. Single-source figures; confirm with Greater Chennai Corporation / local body notification.',
  },
  TG: {
    code: 'TG',
    name: 'Telangana',
    frequency: 'monthly',
    slabs: [
      { from: 0, to: 15000, amount: 0 },
      { from: 15001, to: 20000, amount: 150 },
      { from: 20001, to: null, amount: 200 },
    ],
    annualCap: 2400,
    confidence: 'medium',
    verifiedOn: '2026-09-19',
    sources: ['kredily.com/professional-tax-slab', 'salarybox.in PT 2026-27 guide'],
    notes: 'Two secondary sources agree.',
  },
  WB: {
    code: 'WB',
    name: 'West Bengal',
    frequency: 'monthly',
    slabs: [
      { from: 0, to: 10000, amount: 0 },
      { from: 10001, to: 15000, amount: 110 },
      { from: 15001, to: 25000, amount: 130 },
      { from: 25001, to: 40000, amount: 150 },
      { from: 40001, to: null, amount: 200 },
    ],
    annualCap: 2400,
    confidence: 'medium',
    verifiedOn: '2026-09-19',
    sources: ['kredily.com/professional-tax-slab', 'salarybox.in PT 2026-27 guide'],
    notes: 'Two secondary sources agree.',
  },
  GJ: {
    code: 'GJ',
    name: 'Gujarat',
    frequency: 'monthly',
    slabs: [
      { from: 0, to: 5999, amount: 0 },
      { from: 6000, to: 8999, amount: 80 },
      { from: 9000, to: 11999, amount: 150 },
      { from: 12000, to: null, amount: 200 },
    ],
    annualCap: 2400,
    confidence: 'medium',
    verifiedOn: '2026-09-19',
    sources: ['kredily.com/professional-tax-slab'],
    notes: 'Single-source figures; gender-based exemptions not modelled.',
  },
};

export interface PtInput {
  state: string;
  /** Gross earned in the month. */
  monthlyGross: number;
  /** Calendar month number 1-12. */
  calendarMonth: number;
  gender?: 'M' | 'F' | 'O';
  /** Half-year gross for half-yearly states. Defaults to 6 x monthlyGross. */
  halfYearGross?: number;
  /** Professional tax already deducted in this financial year (for cap enforcement). */
  ytdPt?: number;
}

export interface PtResult {
  amount: number;
  supported: boolean;
  frequency?: 'monthly' | 'half_yearly';
  note?: string;
}

function findSlab(slabs: PtSlab[], value: number): PtSlab | undefined {
  for (const s of slabs) {
    if (value >= s.from && (s.to === null || value <= s.to)) return s;
  }
  return undefined;
}

export function computePt(input: PtInput, table: Record<string, PtState> = PT_STATES): PtResult {
  const st = table[input.state];
  if (!st) return { amount: 0, supported: false, note: `Professional Tax for state "${input.state}" is not configured` };

  if (input.gender === 'F' && st.womenExemptUpTo !== undefined && input.monthlyGross <= st.womenExemptUpTo) {
    return { amount: 0, supported: true, frequency: st.frequency, note: 'Women exemption' };
  }

  let amount = 0;
  if (st.frequency === 'monthly') {
    const slab = findSlab(st.slabs, Math.round(input.monthlyGross));
    if (slab) amount = input.calendarMonth === 2 && slab.febAmount !== undefined ? slab.febAmount : slab.amount;
  } else {
    if (!st.deductionMonths || !st.deductionMonths.includes(input.calendarMonth)) {
      return { amount: 0, supported: true, frequency: st.frequency, note: 'Not a deduction month' };
    }
    const half = Math.round(input.halfYearGross ?? input.monthlyGross * 6);
    const slab = findSlab(st.slabs, half);
    if (slab) amount = slab.amount;
  }

  if (input.ytdPt !== undefined) amount = Math.max(0, Math.min(amount, st.annualCap - input.ytdPt));
  return { amount, supported: true, frequency: st.frequency };
}
