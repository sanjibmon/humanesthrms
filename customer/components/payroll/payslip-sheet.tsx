'use client';

import { inr, dateLabel } from '@/lib/format';

/**
 * A payslip, laid out to print.
 *
 * There is no PDF library here on purpose. The registry this project builds
 * against is closed, so adding one is not an option — and a browser printing to
 * PDF produces a better payslip anyway: it embeds the fonts, it picks up the
 * employee's own paper size, and it needs no server round trip. The print
 * stylesheet hides the application chrome so what comes out is the slip alone.
 */

export type SlipLine = { code: string; name: string; amount: number };

export type SlipData = {
  employee: {
    name: string;
    code: string;
    designation?: string | null;
    department?: string | null;
    location?: string | null;
    doj?: string | null;
    uan?: string | null;
    esiIp?: string | null;
    panLast4?: string | null;
    bankLast4?: string | null;
    bankName?: string | null;
  };
  employer: { name: string; address?: string | null; pan?: string | null };
  month: string;
  paidDays: number;
  totalDays: number;
  lopDays: number;
  earnings: SlipLine[];
  reimbursements: SlipLine[];
  deductions: SlipLine[];
  employerContributions: SlipLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  ytd?: Record<string, number> | null;
  publishedAt?: string | null;
};

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export function PayslipSheet({ slip }: { slip: SlipData }) {
  const e = slip.employee;
  const pairs = zip(slip.earnings.concat(slip.reimbursements), slip.deductions);

  return (
    <>
      <div className="mb-3 flex justify-end print:hidden">
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>

      <div className="payslip mx-auto max-w-[760px] rounded-2xl border border-slate-line bg-white p-7 text-[12px] leading-relaxed text-slate-body shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="mb-5 flex items-start justify-between gap-4 border-b-2 border-slate-line pb-4">
          <div>
            <h1 className="text-[17px] font-bold text-ink">{slip.employer.name}</h1>
            {slip.employer.address ? (
              <p className="mt-0.5 text-[11px] text-slate-muted">{slip.employer.address}</p>
            ) : null}
            {slip.employer.pan ? (
              <p className="text-[11px] text-slate-muted">PAN {slip.employer.pan}</p>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-slate-muted">Payslip</div>
            <div className="text-[15px] font-bold text-ink">{monthLabel(slip.month)}</div>
          </div>
        </header>

        <section className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
          <Fact label="Employee" value={e.name} />
          <Fact label="Code" value={e.code} />
          <Fact label="Date of joining" value={e.doj ? dateLabel(e.doj) : '—'} />
          {e.designation ? <Fact label="Designation" value={e.designation} /> : null}
          {e.department ? <Fact label="Department" value={e.department} /> : null}
          {e.location ? <Fact label="Location" value={e.location} /> : null}
          <Fact label="UAN" value={e.uan || '—'} />
          <Fact label="ESI number" value={e.esiIp || '—'} />
          <Fact label="PAN" value={e.panLast4 ? `XXXXX${e.panLast4}` : '—'} />
          <Fact label="Paid days" value={`${num(slip.paidDays)} of ${num(slip.totalDays)}`} />
          <Fact label="Loss of pay" value={slip.lopDays ? num(slip.lopDays) : 'none'} />
          <Fact
            label="Paid into"
            value={e.bankLast4 ? `${e.bankName ?? 'Bank'} ••••${e.bankLast4}` : '—'}
          />
        </section>

        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-surface text-left text-[10px] uppercase tracking-wide text-slate-muted">
              <th className="border border-slate-line p-2 font-semibold">Earnings</th>
              <th className="border border-slate-line p-2 text-right font-semibold">Amount</th>
              <th className="border border-slate-line p-2 font-semibold">Deductions</th>
              <th className="border border-slate-line p-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map(([a, b], i) => (
              <tr key={i}>
                <td className="border border-slate-line p-2">{a?.name ?? ''}</td>
                <td className="border border-slate-line p-2 text-right tabular-nums">
                  {a ? inr(a.amount) : ''}
                </td>
                <td className="border border-slate-line p-2">{b?.name ?? ''}</td>
                <td className="border border-slate-line p-2 text-right tabular-nums">
                  {b ? inr(b.amount) : ''}
                </td>
              </tr>
            ))}
            <tr className="bg-slate-surface font-semibold text-ink">
              <td className="border border-slate-line p-2">Gross earnings</td>
              <td className="border border-slate-line p-2 text-right tabular-nums">{inr(slip.gross)}</td>
              <td className="border border-slate-line p-2">Total deductions</td>
              <td className="border border-slate-line p-2 text-right tabular-nums">
                {inr(slip.totalDeductions)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex items-baseline justify-between rounded-xl bg-brand-soft px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-brand-dark">Net pay</div>
            <div className="text-[11px] text-slate-muted">{inWords(slip.net)}</div>
          </div>
          <div className="text-[22px] font-bold tabular-nums text-ink">{inr(slip.net)}</div>
        </div>

        {slip.employerContributions.length ? (
          <section className="mt-5">
            <h2 className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-muted">
              Paid by the employer, not deducted from you
            </h2>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {slip.employerContributions.map((c) => (
                <span key={c.code} className="text-[11px]">
                  {c.name} <b className="tabular-nums text-ink">{inr(c.amount)}</b>
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {slip.ytd ? (
          <section className="mt-4">
            <h2 className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-muted">
              Year to date, this financial year
            </h2>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
              <span>
                Taxable pay <b className="tabular-nums text-ink">{inr(slip.ytd.taxableGross)}</b>
              </span>
              <span>
                Provident fund <b className="tabular-nums text-ink">{inr(slip.ytd.employeePf)}</b>
              </span>
              <span>
                Professional tax <b className="tabular-nums text-ink">{inr(slip.ytd.pt)}</b>
              </span>
              <span>
                Tax deducted <b className="tabular-nums text-ink">{inr(slip.ytd.tds)}</b>
              </span>
            </div>
          </section>
        ) : null}

        <footer className="mt-6 border-t border-slate-line pt-3 text-[10px] leading-relaxed text-slate-muted">
          This is a computer-generated payslip and needs no signature.
          {slip.publishedAt ? ` Published ${dateLabel(slip.publishedAt)}.` : ''} Figures are taken
          from the locked pay run for {monthLabel(slip.month)}, so this slip cannot drift from what
          was actually paid.
        </footer>
      </div>

    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-slate-faint">{label}</div>
      <div className="font-semibold text-ink">{value}</div>
    </div>
  );
}

const num = (n: number) => (Number(n) % 1 ? Number(n).toFixed(1) : String(Number(n)));

function zip(a: SlipLine[], b: SlipLine[]): [SlipLine | undefined, SlipLine | undefined][] {
  const out: [SlipLine | undefined, SlipLine | undefined][] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) out.push([a[i], b[i]]);
  return out;
}

/* Indian payslips carry the amount in words, and an accounts department will
   ask for it if it is missing. Lakh and crore, not million. */
function inWords(n: number): string {
  const v = Math.round(Math.abs(Number(n) || 0));
  if (v === 0) return 'Rupees zero only';
  const ones = [
    '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen',
  ];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (x: number): string =>
    x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ''}`;
  const three = (x: number): string =>
    x >= 100 ? `${ones[Math.floor(x / 100)]} hundred${x % 100 ? ` ${two(x % 100)}` : ''}` : two(x);

  const crore = Math.floor(v / 10000000);
  const lakh = Math.floor((v % 10000000) / 100000);
  const thousand = Math.floor((v % 100000) / 1000);
  const rest = v % 1000;

  const parts = [
    crore ? `${three(crore)} crore` : '',
    lakh ? `${three(lakh)} lakh` : '',
    thousand ? `${three(thousand)} thousand` : '',
    rest ? three(rest) : '',
  ].filter(Boolean);

  const s = parts.join(' ');
  return `Rupees ${s.charAt(0).toUpperCase()}${s.slice(1)} only`;
}
