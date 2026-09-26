/**
 * Statutory file formats.
 *
 * Each builder takes the payload app.filing_data returns and produces the text
 * the portal actually accepts. The formats are positional and unforgiving — a
 * missing field is not an empty column, it is a rejected upload — so every
 * builder also returns a list of problems rather than silently emitting a file
 * that will bounce.
 *
 * Amounts are whole rupees throughout. Every one of these portals rounds, and
 * uploading paise is a common reason for a rejected return.
 */

export type FilingRow = {
  employeeId: string;
  code: string;
  name: string;
  doj: string | null;
  exitDate: string | null;
  uan: string | null;
  esiIp: string | null;
  panLast4: string | null;
  pan: string | null;
  regime: string;
  state: string | null;
  months: MonthRow[];
};

export type MonthRow = {
  month: string;
  paidDays: number;
  lopDays: number;
  gross: number;
  net: number;
  pfEmployee: number;
  esiEmployee: number;
  pt: number;
  tds: number;
  pf: { pfWages?: number; epsWages?: number; edliWages?: number; employee?: number; eps?: number; epf?: number; employerTotal?: number } | null;
  esi: { applicable?: boolean; employee?: number; employer?: number; wages?: number } | null;
  lwf: { employee?: number; employer?: number; due?: boolean } | null;
  taxAnnual: Record<string, unknown> | null;
  earnings: { code: string; name: string; amount: number }[] | null;
  deductions: { code: string; name: string; amount: number }[] | null;
  employer: { code: string; name: string; amount: number }[] | null;
  ytd: Record<string, number> | null;
};

export type FilingData = {
  type: string;
  period: string;
  months: string[];
  fyStart: number;
  panRevealed?: boolean;
  org: { name: string; pan: string | null; tan: string | null; gstin: string | null };
  entity: { id: string; name: string; pan: string | null; tan: string | null; pfCode: string | null; esiCode: string | null; state: string | null } | null;
  totals: Record<string, number>;
  rows: FilingRow[];
};

export type BuiltFile = {
  filename: string;
  mime: string;
  content: string;
  /** Things that will get the upload rejected, named per employee. */
  problems: string[];
  /** Things worth knowing that will not block the upload. */
  notes: string[];
  rowCount: number;
};

const rupees = (n: unknown) => Math.round(Number(n ?? 0));
const nz = (n: unknown) => Number(n ?? 0);

/** Sums one field across every month in the period. */
const across = (r: FilingRow, pick: (m: MonthRow) => number) =>
  r.months.reduce((a, m) => a + Number(pick(m) || 0), 0);

/* ------------------------------------------------------------------- EPFO */

/**
 * The EPFO electronic challan-cum-return.
 *
 * One line per member, eleven fields, `#~#` between them. NCP days are days of
 * non-contributory service — loss of pay — and the portal cross-checks the
 * contribution against the wages, so both have to come from the same run.
 */
export function buildEcr(d: FilingData): BuiltFile {
  const problems: string[] = [];
  const notes: string[] = [];
  const lines: string[] = [];

  if (!d.entity?.pfCode) {
    problems.push('The legal entity has no PF establishment code. Add it under Settings → Company before filing.');
  }

  for (const r of d.rows) {
    const pfWages = across(r, (m) => nz(m.pf?.pfWages));
    if (pfWages === 0 && across(r, (m) => nz(m.pfEmployee)) === 0) continue;

    if (!r.uan) {
      problems.push(`${r.name} (${r.code}) has no UAN. EPFO rejects a file with a blank UAN.`);
    } else if (!/^\d{12}$/.test(r.uan)) {
      problems.push(`${r.name} (${r.code}) has a UAN that is not 12 digits.`);
    }

    const gross = across(r, (m) => nz(m.gross));
    const epsWages = across(r, (m) => nz(m.pf?.epsWages));
    const edliWages = across(r, (m) => nz(m.pf?.edliWages));
    const employee = across(r, (m) => nz(m.pf?.employee ?? m.pfEmployee));
    const eps = across(r, (m) => nz(m.pf?.eps));
    const epf = across(r, (m) => nz(m.pf?.epf));
    const ncp = across(r, (m) => nz(m.lopDays));

    lines.push(
      [
        r.uan ?? '',
        r.name.toUpperCase(),
        rupees(gross),
        rupees(pfWages),
        rupees(epsWages),
        rupees(edliWages),
        rupees(employee),
        rupees(eps),
        rupees(epf),
        Math.round(ncp),
        0, // refund of advances: not tracked here
      ].join('#~#'),
    );
  }

  if (lines.length === 0) {
    problems.push('No employee has any provident fund contribution in this period. There is nothing to file.');
  }
  notes.push(
    'Amounts are whole rupees, as the portal requires. NCP days are the loss-of-pay days from the same run, so the wages and the contribution always reconcile.',
  );

  return {
    filename: `ECR_${d.entity?.pfCode ?? 'NOCODE'}_${d.period}.txt`,
    mime: 'text/plain',
    content: lines.join('\r\n'),
    problems,
    notes,
    rowCount: lines.length,
  };
}

/* -------------------------------------------------------------------- ESIC */

/**
 * The ESIC monthly contribution file: IP number, name, days, wages, and the
 * reason code, which is only used when somebody is left out of a month.
 */
export function buildEsiReturn(d: FilingData): BuiltFile {
  const problems: string[] = [];
  const notes: string[] = [];
  const out: string[] = ['IP Number,IP Name,No of Days,Total Monthly Wages,Reason Code,Last Working Day'];

  if (!d.entity?.esiCode) {
    problems.push('The legal entity has no ESI code. Add it under Settings → Company before filing.');
  }

  let covered = 0;
  for (const r of d.rows) {
    const esiWages = across(r, (m) => nz(m.esi?.wages));
    const anyApplicable = r.months.some((m) => m.esi?.applicable);
    if (!anyApplicable && esiWages === 0) continue;
    covered += 1;

    if (!r.esiIp) {
      problems.push(`${r.name} (${r.code}) is covered by ESI but has no insurance number on record.`);
    }

    const days = across(r, (m) => nz(m.paidDays));
    const exited = r.exitDate && d.months.some((mm) => String(r.exitDate).startsWith(mm));

    out.push(
      [
        r.esiIp ?? '',
        `"${r.name.replace(/"/g, '""')}"`,
        Math.round(days),
        rupees(esiWages),
        exited ? '2' : '',
        exited ? String(r.exitDate) : '',
      ].join(','),
    );
  }

  if (covered === 0) {
    notes.push(
      'Nobody in this period is covered by ESI — every gross is above the wage ceiling, or coverage is switched off. A nil return may still be required.',
    );
  }
  notes.push(
    'Reason code 2 marks somebody who left during the month, with their last working day. Anyone who was never covered is left out of the file rather than filed at zero.',
  );

  return {
    filename: `ESI_${d.entity?.esiCode ?? 'NOCODE'}_${d.period}.csv`,
    mime: 'text/csv',
    content: out.join('\r\n'),
    problems,
    notes,
    rowCount: Math.max(0, out.length - 1),
  };
}

/* -------------------------------------------------- professional tax (state) */

/** A state-wise professional tax statement: who, how much, and the total. */
export function buildPtStatement(d: FilingData, stateCode?: string): BuiltFile {
  const notes: string[] = [];
  const rows = stateCode ? d.rows.filter((r) => r.state === stateCode) : d.rows;
  const out: string[] = ['Employee code,Name,State,Month,Gross,Professional tax'];
  let total = 0;

  for (const r of rows) {
    for (const m of r.months) {
      if (!nz(m.pt)) continue;
      total += nz(m.pt);
      out.push(
        [r.code, `"${r.name.replace(/"/g, '""')}"`, r.state ?? '', m.month, rupees(m.gross), rupees(m.pt)].join(','),
      );
    }
  }
  out.push(['', 'TOTAL', stateCode ?? '', d.period, '', rupees(total)].join(','));

  notes.push(
    'Professional tax is a state tax and the return, the form and the due date differ by state. This is the working the return is built from, not the state form itself.',
  );
  if (!stateCode) {
    notes.push('Every state is in this file. Most states want a separate return per state.');
  }

  return {
    filename: `PT_${stateCode ?? 'ALL'}_${d.period}.csv`,
    mime: 'text/csv',
    content: out.join('\r\n'),
    problems: [],
    notes,
    rowCount: Math.max(0, out.length - 2),
  };
}

/* --------------------------------------------------------------- TDS 24Q */

/**
 * Form 24Q Annexure I: the deductee-wise breakup for a quarter. This is the
 * working that the return-preparation utility consumes, not the FVU file
 * itself, which needs a challan identification number the bank issues after
 * payment and cannot be produced before the tax is actually paid.
 */
export function build24Q(d: FilingData): BuiltFile {
  const problems: string[] = [];
  const notes: string[] = [];
  const out: string[] = [
    'Employee code,Name,PAN,Section,Month,Amount paid,TDS deducted,TDS deposited',
  ];

  if (!d.entity?.tan && !d.org.tan) {
    problems.push('No TAN on the legal entity or the organisation. A TDS return cannot be filed without it.');
  }

  let anyTds = 0;
  for (const r of d.rows) {
    const pan = r.pan ?? (r.panLast4 ? `XXXXX${r.panLast4}` : '');
    if (!pan) {
      problems.push(`${r.name} (${r.code}) has no PAN. Tax on a deductee without a PAN is deducted at the higher rate under section 206AA.`);
    }
    for (const m of r.months) {
      if (!nz(m.tds) && !nz(m.gross)) continue;
      anyTds += nz(m.tds);
      out.push(
        [
          r.code,
          `"${r.name.replace(/"/g, '""')}"`,
          pan,
          '192',
          m.month,
          rupees(m.gross),
          rupees(m.tds),
          rupees(m.tds),
        ].join(','),
      );
    }
  }

  if (!d.panRevealed) {
    problems.push(
      'PANs are masked in this file because your role does not include permission to reveal them. Somebody with that permission has to export it before it can be filed.',
    );
  }
  if (anyTds === 0) {
    notes.push('No tax was deducted from anybody in this quarter. A nil return is still required.');
  }
  notes.push(
    'The challan identification number the bank issues on payment is not in this file, because it does not exist until the tax is paid. Add it in the return-preparation utility.',
  );

  return {
    filename: `24Q_${d.period}.csv`,
    mime: 'text/csv',
    content: out.join('\r\n'),
    problems,
    notes,
    rowCount: Math.max(0, out.length - 1),
  };
}

/* -------------------------------------------------------------- Form 16 B */

/**
 * Form 16 Part B, one section per employee, as readable text.
 *
 * Part A — the TRACES-generated part with the challan details — is downloaded
 * from the portal and cannot be produced here. This is Part B: the salary
 * breakup, the exemptions, the deductions and the tax, which the employer
 * prepares.
 */
export function buildForm16(d: FilingData): BuiltFile {
  const problems: string[] = [];
  const notes: string[] = [];
  const fy = `${d.fyStart}-${String((d.fyStart + 1) % 100).padStart(2, '0')}`;
  const blocks: string[] = [];

  if (!d.panRevealed) {
    problems.push(
      'PANs are masked because your role does not include permission to reveal them. A Form 16 has to carry the full PAN.',
    );
  }

  for (const r of d.rows) {
    const gross = across(r, (m) => nz(m.gross));
    const tds = across(r, (m) => nz(m.tds));
    const pf = across(r, (m) => nz(m.pfEmployee));
    const pt = across(r, (m) => nz(m.pt));
    const last = r.months[r.months.length - 1];
    const ann = (last?.taxAnnual ?? {}) as Record<string, any>;

    if (r.months.length < 12) {
      notes.push(`${r.name} (${r.code}) has ${r.months.length} month(s) of pay in ${fy}, not twelve.`);
    }

    /* Line 1 has to be the same gross the tax was computed on, otherwise the
       certificate contradicts itself: lines 2 to 13 all derive from the annual
       computation. The actually-paid figure is shown beside it when the two
       differ, which happens when somebody joined or left mid-year. */
    const annualGross = nz(ann.grossSalary) || gross;
    const partial = Math.abs(annualGross - gross) > 1;

    const chapter = (ann.chapterVIA ?? {}) as Record<string, number>;
    const lines = [
      `FORM 16 — PART B`,
      `Financial year ${fy}   Assessment year ${d.fyStart + 1}-${String((d.fyStart + 2) % 100).padStart(2, '0')}`,
      ``,
      `Employer            ${d.entity?.name ?? d.org.name}`,
      `TAN                 ${d.entity?.tan ?? d.org.tan ?? '(not on record)'}`,
      `PAN of employer     ${d.entity?.pan ?? d.org.pan ?? '(not on record)'}`,
      ``,
      `Employee            ${r.name}  (${r.code})`,
      `PAN                 ${r.pan ?? (r.panLast4 ? `XXXXX${r.panLast4}` : '(not on record)')}`,
      `Tax regime          ${r.regime === 'old' ? 'Old regime' : 'New regime (section 115BAC)'}`,
      `Months paid         ${r.months.length}`,
      ``,
      `1  Gross salary                                    ${pad(annualGross)}`,
      ...(partial
        ? [`     of which paid by this employer                ${pad(gross)}`]
        : []),
      `2  Less: exemptions`,
      `     House rent allowance                          ${pad(ann.exemptions?.hra)}`,
      `     Leave travel                                  ${pad(ann.exemptions?.lta)}`,
      `3  Less: standard deduction                        ${pad(ann.standardDeduction)}`,
      `4  Less: tax on employment (professional tax)      ${pad(ann.professionalTaxDeduction ?? (r.regime === 'old' ? pt : 0))}`,
      `5  Less: interest on housing loan, section 24(b)   ${pad(ann.homeLoanInterest)}`,
      `6  Deductions under Chapter VI-A`,
      `     80C (includes provident fund ${fmt(pf)})`.padEnd(51) + pad(chapter.c80),
      `     80CCD(1B) — national pension scheme           ${pad(chapter.c80ccd1b)}`,
      `     80CCD(2) — employer contribution to NPS       ${pad(chapter.employerNps)}`,
      `     80D — health insurance                        ${pad(chapter.c80d)}`,
      `     80E — education loan interest                 ${pad(chapter.c80e)}`,
      `     Other Chapter VI-A                            ${pad(chapter.other)}`,
      `     Total Chapter VI-A                            ${pad(chapter.total)}`,
      ``,
      `7  Total taxable income                            ${pad(ann.taxableIncome)}`,
      `8  Tax on total income                             ${pad(ann.taxOnIncome)}`,
      `9  Less: rebate under section 87A                  ${pad(ann.rebate)}`,
      `10 Surcharge                                       ${pad(ann.surcharge)}`,
      `11 Less: marginal relief                           ${pad(ann.marginalRelief)}`,
      `12 Health and education cess                       ${pad(ann.cess)}`,
      `13 Total tax payable                               ${pad(ann.totalTax)}`,
      `14 Tax deducted at source                          ${pad(tds)}`,
      `15 Balance ${nz(ann.totalTax) - tds >= 0 ? 'payable' : 'refundable'}${' '.repeat(34)}${pad(Math.abs(nz(ann.totalTax) - tds))}`,
      ``,
      `Part A, with the challan and deposit details, is downloaded from TRACES.`,
      `This is Part B, which the employer prepares.`,
      ''.padEnd(72, '-'),
      '',
    ];
    blocks.push(lines.join('\n'));
  }

  if (blocks.length === 0) {
    problems.push('No locked or paid pay run exists for this financial year, so there is nothing to certify.');
  }
  notes.push(
    'Figures come from the annual computation stored on the last pay run of the year, not from a fresh calculation, so a Form 16 matches the payslips it summarises.',
  );

  return {
    filename: `Form16_PartB_FY${fy}.txt`,
    mime: 'text/plain',
    content: blocks.join('\n'),
    problems,
    notes,
    rowCount: blocks.length,
  };
}

/* ------------------------------------------------------------ challan aids */

/** The single figures somebody types into a PF, ESI or TDS challan. */
export function buildChallanSummary(d: FilingData): BuiltFile {
  const t = d.totals ?? {};
  const pfTotal = nz(t.pfEmployee) + nz(t.pfEmployer) + nz(t.edli) + nz(t.pfAdmin);
  const esiTotal = nz(t.esiEmployee) + nz(t.esiEmployer);

  const lines = [
    `Challan working — ${d.entity?.name ?? d.org.name} — ${d.period}`,
    ''.padEnd(60, '='),
    '',
    `Employees in the run                    ${fmt(t.employees)}`,
    `Gross paid                              ${fmt(t.gross)}`,
    '',
    'PROVIDENT FUND',
    `  A/c 1  employee share                 ${fmt(t.pfEmployee)}`,
    `  A/c 1  employer share                 ${fmt(nz(t.pfEmployer) - nz(t.eps))}`,
    `  A/c 10 pension (EPS)                  ${fmt(t.eps)}`,
    `  A/c 21 EDLI                           ${fmt(t.edli)}`,
    `  A/c 2  administration charges         ${fmt(t.pfAdmin)}`,
    `  Total to remit                        ${fmt(pfTotal)}`,
    '',
    'EMPLOYEES STATE INSURANCE',
    `  Employee share                        ${fmt(t.esiEmployee)}`,
    `  Employer share                        ${fmt(t.esiEmployer)}`,
    `  Total to remit                        ${fmt(esiTotal)}`,
    '',
    'PROFESSIONAL TAX',
    `  Deducted                              ${fmt(t.pt)}`,
    '',
    'LABOUR WELFARE FUND',
    `  Employee share                        ${fmt(t.lwfEmployee)}`,
    `  Employer share                        ${fmt(t.lwfEmployer)}`,
    '',
    'TAX DEDUCTED AT SOURCE',
    `  Section 192, salary                   ${fmt(t.tds)}`,
    '',
    'Every figure is the sum over pay runs that are locked or paid. A run that is',
    'only computed or approved is excluded, because it can still change.',
  ];

  return {
    filename: `Challan_working_${d.period}.txt`,
    mime: 'text/plain',
    content: lines.join('\n'),
    problems: [],
    notes: [],
    rowCount: Number(t.employees ?? 0),
  };
}

/* -------------------------------------------------------------------- misc */

function fmt(n: unknown): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(n ?? 0)));
}
function pad(n: unknown): string {
  return fmt(n).padStart(14, ' ');
}

export function buildFiling(type: string, d: FilingData, stateCode?: string): BuiltFile {
  switch (type) {
    case 'pf_ecr':
      return buildEcr(d);
    case 'esi_return':
      return buildEsiReturn(d);
    case 'pt_return':
      return buildPtStatement(d, stateCode);
    case 'tds_return':
      return build24Q(d);
    case 'form16':
      return buildForm16(d);
    default:
      return buildChallanSummary(d);
  }
}

export const FILING_LABEL: Record<string, string> = {
  pf_ecr: 'Provident fund — electronic challan-cum-return',
  pf_challan: 'Provident fund — challan',
  esi_return: 'ESI — monthly contribution return',
  esi_challan: 'ESI — challan',
  pt_return: 'Professional tax — return',
  lwf_return: 'Labour welfare fund — return',
  tds_challan: 'TDS — challan, section 192',
  tds_return: 'TDS — Form 24Q, quarterly',
  form16: 'Form 16 — Part B',
  annual_return: 'Annual return',
  other: 'Other',
};
