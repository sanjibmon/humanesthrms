import type { Declarations } from '@/lib/payroll/tds';

/**
 * The declaration vocabulary, shared by the employee's form, the verification
 * screen and the regime comparison.
 *
 * It is not a free-text list: tax_declaration_items_section_check allows
 * exactly these ten values, and app.payroll_inputs maps each one to the key the
 * engine expects. Adding a section here without adding it in both those places
 * produces a deduction that quietly does nothing.
 */
export const SECTIONS = [
  {
    value: '80c',
    short: '80C',
    label: '80C — PPF, ELSS, life insurance, tuition fees, home loan principal',
    cap: 150000,
    oldRegimeOnly: true,
  },
  {
    value: '80ccd1b',
    short: '80CCD(1B)',
    label: '80CCD(1B) — NPS, your own contribution',
    cap: 50000,
    oldRegimeOnly: true,
  },
  {
    value: 'employer_nps',
    short: '80CCD(2)',
    label: '80CCD(2) — NPS paid by your employer',
    cap: 0,
    oldRegimeOnly: false,
  },
  { value: '80d', short: '80D', label: '80D — health insurance premium', cap: 100000, oldRegimeOnly: true },
  { value: '80e', short: '80E', label: '80E — interest on an education loan', cap: 0, oldRegimeOnly: true },
  {
    value: 'home_loan_interest',
    short: '24(b)',
    label: 'Section 24(b) — home loan interest, self-occupied',
    cap: 200000,
    oldRegimeOnly: true,
  },
  {
    value: 'other_chapter_via',
    short: 'Other VI-A',
    label: 'Other Chapter VI-A — 80G, 80TTA and the rest',
    cap: 0,
    oldRegimeOnly: true,
  },
  { value: 'rent', short: 'Rent', label: 'House rent paid, for the HRA exemption', cap: 0, oldRegimeOnly: true },
  { value: 'lta', short: 'LTA', label: 'Leave travel actually spent', cap: 0, oldRegimeOnly: true },
  {
    value: 'other_income',
    short: 'Other income',
    label: 'Income from other sources — bank interest and so on',
    cap: 0,
    oldRegimeOnly: false,
  },
] as const;

export type SectionKey = (typeof SECTIONS)[number]['value'];

export const sectionOf = (key: string) => SECTIONS.find((s) => s.value === key);
export const sectionLabel = (key: string) => sectionOf(key)?.label ?? key;
export const sectionShort = (key: string) => sectionOf(key)?.short ?? key;

/** The financial year that contains a date: April to March. */
export function fyStartOf(d: Date = new Date()): number {
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

export const fyLabel = (fyStart: number) => `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;

export type DeclItem = {
  section: string;
  declared_amount: number | string | null;
  verified_amount?: number | string | null;
  status: string;
  city?: string | null;
};

/**
 * Turns declaration rows into the engine's Declarations, using exactly the rule
 * app.payroll_inputs uses: rejected items are excluded, everything else counts
 * at its verified amount when there is one and its declared amount otherwise.
 *
 * Keeping the two identical is the whole point. A comparison screen that
 * applied a different rule from the payslip would be worse than no comparison.
 */
export function itemsToDeclarations(items: DeclItem[]): Declarations {
  const key: Record<string, keyof Declarations> = {
    '80c': 'c80',
    '80ccd1b': 'c80ccd1b',
    employer_nps: 'employerNps',
    '80d': 'c80d',
    '80e': 'c80e',
    home_loan_interest: 'homeLoanInterest',
    other_chapter_via: 'otherChapterVIA',
    rent: 'rentPaidAnnual',
    lta: 'ltaExempt',
    other_income: 'otherIncome',
  };

  const out: Declarations = {};
  for (const i of items) {
    if (i.status === 'rejected') continue;
    const k = key[i.section];
    if (!k) continue;
    const amount = Number(i.verified_amount ?? i.declared_amount ?? 0);
    const bucket = out as unknown as Record<string, number>;
    bucket[k] = Number(bucket[k] ?? 0) + amount;
    if (i.section === 'rent' && i.city) out.cityForHra = i.city;
  }
  return out;
}

/** What an item is actually worth once the cap is applied — shown as a hint. */
export function cappedValue(section: string, amount: number): { capped: boolean; value: number; cap: number } {
  const cap = sectionOf(section)?.cap ?? 0;
  if (!cap || amount <= cap) return { capped: false, value: amount, cap };
  return { capped: true, value: cap, cap };
}
