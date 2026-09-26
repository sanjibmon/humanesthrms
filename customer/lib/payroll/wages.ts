// "Wages" under the Code on Wages, 2019 (in force from 21 Nov 2025) and the 50% rule.
//
// Wages = all remuneration MINUS a list of excluded payments (HRA, conveyance, bonus, overtime,
// commission, employer PF/pension, gratuity, retrenchment compensation...). If the excluded
// payments exceed 50% of total remuneration, the excess is added back to wages. Wages drive PF,
// gratuity, bonus and leave-encashment bases.

import { sum } from './util';

export type WageTreatment = 'wage' | 'excluded';

export interface WageLine {
  code: string;
  amount: number;
  treatment: WageTreatment;
}

export interface WageResult {
  totalRemuneration: number;
  excluded: number;
  /** Portion of excluded payments added back because they exceeded the cap. */
  addBack: number;
  wages: number;
  /** True when the 50% rule changed the outcome. */
  ruleTriggered: boolean;
}

export type WageDefinition = 'labour_code' | 'legacy_basic_da';

/**
 * @param lines            Every remuneration line (paid or accrued for the period).
 * @param capPct           Excluded cap as a fraction of total remuneration (0.5 under the Code).
 * @param definition       'labour_code' applies the 50% rule. 'legacy_basic_da' uses only lines flagged 'wage'
 *                         with no add-back (the pre-Code Basic + DA reading, kept as an org-level switch).
 */
export function computeWages(lines: readonly WageLine[], capPct = 0.5, definition: WageDefinition = 'labour_code'): WageResult {
  const total = sum(lines.map((l) => l.amount));
  const excluded = sum(lines.filter((l) => l.treatment === 'excluded').map((l) => l.amount));
  const wageLines = total - excluded;
  if (definition === 'legacy_basic_da') {
    return { totalRemuneration: total, excluded, addBack: 0, wages: wageLines, ruleTriggered: false };
  }
  const allowedExcluded = capPct * total;
  const addBack = Math.max(0, excluded - allowedExcluded);
  return {
    totalRemuneration: total,
    excluded,
    addBack,
    wages: wageLines + addBack,
    ruleTriggered: addBack > 0,
  };
}
