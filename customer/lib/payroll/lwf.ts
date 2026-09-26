// Labour Welfare Fund. Small fixed amounts, deducted in specific months.
//
// CONFIDENCE NOTE: these figures come from secondary compliance blogs and change often. They are
// stored as editable data with a verification flag. Do not go live for a state without confirming
// against the state Labour Welfare Board notification.

import type { Confidence } from './pt';

export interface LwfState {
  code: string;
  name: string;
  /** Calendar months (1-12) in which the contribution is deducted. */
  months: number[];
  employee: number;
  employer: number;
  confidence: Confidence;
  verifiedOn: string;
  notes: string;
}

export const LWF_STATES: Record<string, LwfState> = {
  MH: { code: 'MH', name: 'Maharashtra', months: [6, 12], employee: 25, employer: 75, confidence: 'medium', verifiedOn: '2026-09-19', notes: 'Half-yearly (Jun, Dec). Lower wage slabs not modelled. Confirm.' },
  KA: { code: 'KA', name: 'Karnataka', months: [12], employee: 50, employer: 100, confidence: 'low', verifiedOn: '2026-09-19', notes: 'Annual (Dec). One source only; applicability reportedly widened to 10+ employees from 7 Jan 2026. Confirm amounts.' },
  TN: { code: 'TN', name: 'Tamil Nadu', months: [12], employee: 10, employer: 20, confidence: 'low', verifiedOn: '2026-09-19', notes: 'Annual (Dec). One source only. Confirm amounts.' },
  TG: { code: 'TG', name: 'Telangana', months: [12], employee: 2, employer: 5, confidence: 'medium', verifiedOn: '2026-09-19', notes: 'Annual (Dec).' },
  WB: { code: 'WB', name: 'West Bengal', months: [6, 12], employee: 3, employer: 30, confidence: 'low', verifiedOn: '2026-09-19', notes: 'Half-yearly (Jun, Dec). Employer share is unusually high in the single source; confirm before use.' },
  GJ: { code: 'GJ', name: 'Gujarat', months: [6, 12], employee: 6, employer: 12, confidence: 'medium', verifiedOn: '2026-09-19', notes: 'Half-yearly (Jun, Dec).' },
};

export interface LwfResult {
  employee: number;
  employer: number;
  supported: boolean;
  due: boolean;
}

export function computeLwf(state: string, calendarMonth: number, table: Record<string, LwfState> = LWF_STATES): LwfResult {
  const st = table[state];
  if (!st) return { employee: 0, employer: 0, supported: false, due: false };
  if (!st.months.includes(calendarMonth)) return { employee: 0, employer: 0, supported: true, due: false };
  return { employee: st.employee, employer: st.employer, supported: true, due: true };
}
