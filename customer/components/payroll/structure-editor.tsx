'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';
import { Icon } from '@/components/icon';
import { inr } from '@/lib/format';
import { saveSalaryStructure } from '@/app/actions/payroll';
import type { StructureRow } from '@/components/payroll/payroll-console';

/* One row in the editor. The shape is deliberately flatter than the engine's
   TemplateComponent -- a select and a number instead of a tagged union -- because
   that is what a form can hold. The server turns it back into a calc rule and
   validates it there, since the browser is not where correctness is decided. */
type Kind = 'pct_ctc' | 'pct_basic' | 'fixed' | 'balance';

type Line = {
  key: string;
  code: string;
  name: string;
  kind: Kind;
  value: number;
  wage: boolean;
  taxable: boolean;
  prorate: boolean;
  showInPayslip: boolean;
  isBasic: boolean;
};

const KINDS: { value: Kind; label: string }[] = [
  { value: 'pct_ctc', label: '% of CTC' },
  { value: 'pct_basic', label: '% of basic' },
  { value: 'fixed', label: 'Fixed ₹ a month' },
  { value: 'balance', label: 'Whatever is left' },
];

/* The components Indian SMBs actually use, with the wage treatment already
   right -- which is the part nobody should have to guess. Under the Code on
   Wages, HRA, conveyance, overtime, commission and bonus are excluded from
   "wages"; basic and dearness allowance are wages. Getting that wrong moves the
   PF and gratuity base, so the presets carry it. */
const PRESETS: Omit<Line, 'key'>[] = [
  { code: 'DA', name: 'Dearness Allowance', kind: 'pct_basic', value: 0, wage: true, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'HRA', name: 'House Rent Allowance', kind: 'pct_basic', value: 50, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'CONV', name: 'Conveyance Allowance', kind: 'fixed', value: 1600, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'MED', name: 'Medical Allowance', kind: 'fixed', value: 1250, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'LTA', name: 'Leave Travel Allowance', kind: 'pct_basic', value: 8.33, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'EDU', name: 'Children Education Allowance', kind: 'fixed', value: 200, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'CCA', name: 'City Compensatory Allowance', kind: 'fixed', value: 0, wage: true, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'FOOD', name: 'Food Allowance', kind: 'fixed', value: 0, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'TEL', name: 'Telephone & Internet', kind: 'fixed', value: 0, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'BOOKS', name: 'Books & Periodicals', kind: 'fixed', value: 0, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'SHIFT', name: 'Shift Allowance', kind: 'fixed', value: 0, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  { code: 'SPECIAL', name: 'Special Allowance', kind: 'balance', value: 0, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
];

const uid = () => Math.random().toString(36).slice(2, 9);

/** A new structure starts where most Indian SMBs start, not empty. */
function starter(): Line[] {
  return [
    { key: uid(), code: 'BASIC', name: 'Basic', kind: 'pct_ctc', value: 50, wage: true, taxable: true, prorate: true, showInPayslip: true, isBasic: true },
    { key: uid(), code: 'HRA', name: 'House Rent Allowance', kind: 'pct_basic', value: 50, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
    { key: uid(), code: 'CONV', name: 'Conveyance Allowance', kind: 'fixed', value: 1600, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
    { key: uid(), code: 'MED', name: 'Medical Allowance', kind: 'fixed', value: 1250, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
    { key: uid(), code: 'SPECIAL', name: 'Special Allowance', kind: 'balance', value: 0, wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false },
  ];
}

/** Reads an existing structure's template back into editor rows. */
function fromRow(row: StructureRow): Line[] {
  const comps = row.template?.components ?? [];
  if (comps.length === 0) return starter();
  return comps.map((c: any) => ({
    key: uid(),
    code: String(c.code ?? ''),
    name: String(c.name ?? ''),
    kind: (c.calc?.type ?? 'fixed') as Kind,
    value: Number(c.calc?.pct ?? c.calc?.amount ?? 0),
    wage: c.treatment === 'wage',
    taxable: c.taxable !== false,
    prorate: c.prorate !== false,
    showInPayslip: c.showInPayslip !== false,
    isBasic: Boolean(c.isBasic),
  }));
}

export function StructureEditor({
  row,
  onDone,
  onCancel,
}: {
  row?: StructureRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(row?.code ?? 'STD');
  const [name, setName] = useState(row?.name ?? 'Standard structure');
  const [inclusive, setInclusive] = useState(row?.template?.ctcIncludesEmployerCosts ?? true);
  const [active, setActive] = useState(row?.is_active ?? true);
  const [lines, setLines] = useState<Line[]>(() => (row ? fromRow(row) : starter()));
  const [sampleCtc, setSampleCtc] = useState(600000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(key: string, change: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));
  }

  /* Only one basic and only one balancing component can exist, so choosing one
     clears the other. Letting the form hold an impossible state and rejecting it
     on save would be a worse way to teach the same rule. */
  function setBasic(key: string) {
    setLines((ls) => ls.map((l) => ({ ...l, isBasic: l.key === key })));
  }
  function setKind(key: string, kind: Kind) {
    setLines((ls) =>
      ls.map((l) =>
        l.key === key
          ? { ...l, kind }
          : kind === 'balance' && l.kind === 'balance'
            ? { ...l, kind: 'fixed', value: 0 }
            : l,
      ),
    );
  }

  function addPreset(codeToAdd: string) {
    const p = PRESETS.find((x) => x.code === codeToAdd);
    if (!p) return;
    if (lines.some((l) => l.code.toUpperCase() === p.code)) {
      return setError(`${p.name} is already in this structure.`);
    }
    setError(null);
    const line = { ...p, key: uid() };
    /* Inserted before the balancing component, because reading a structure that
       ends in "whatever is left" is how anybody checks it. */
    setLines((ls) => {
      const at = ls.findIndex((l) => l.kind === 'balance');
      if (line.kind === 'balance' || at < 0) return [...ls, line];
      return [...ls.slice(0, at), line, ...ls.slice(at)];
    });
  }

  /* A preview of the monthly split. It computes exactly what the engine does for
     the components themselves; what it cannot know is the employer PF, ESI and
     gratuity that come out of CTC first, so it says so rather than pretending.
     The pay run remains the authority. */
  const preview = useMemo(() => {
    const monthly = Math.round(sampleCtc / 12);
    const basicLine = lines.find((l) => l.isBasic);
    const basic =
      basicLine?.kind === 'pct_ctc'
        ? Math.round((monthly * basicLine.value) / 100)
        : basicLine?.kind === 'fixed'
          ? basicLine.value
          : 0;

    const amounts = new Map<string, number>();
    let fixedSum = 0;
    for (const l of lines) {
      if (l.kind === 'balance') continue;
      const amt =
        l.kind === 'pct_ctc'
          ? Math.round((monthly * l.value) / 100)
          : l.kind === 'pct_basic'
            ? Math.round((basic * l.value) / 100)
            : Math.round(l.value);
      amounts.set(l.key, amt);
      fixedSum += amt;
    }
    const balanceLine = lines.find((l) => l.kind === 'balance');
    if (balanceLine) amounts.set(balanceLine.key, Math.max(0, monthly - fixedSum));

    const gross = lines.reduce((t, l) => t + (amounts.get(l.key) ?? 0), 0);
    const wages = lines.reduce((t, l) => t + (l.wage ? (amounts.get(l.key) ?? 0) : 0), 0);
    return {
      monthly,
      amounts,
      gross,
      basicShare: monthly > 0 ? basic / monthly : 0,
      wageShare: gross > 0 ? wages / gross : 0,
      overspent: fixedSum > monthly,
    };
  }, [lines, sampleCtc]);

  async function submit() {
    setError(null);
    setBusy(true);
    const res = await saveSalaryStructure({
      id: row?.id ?? '',
      code,
      name,
      ctc_includes_employer_costs: inclusive,
      is_active: active,
      components: JSON.stringify(
        lines.map((l) => ({
          code: l.code,
          name: l.name,
          kind: l.kind,
          value: l.value,
          wage: l.wage,
          taxable: l.taxable,
          prorate: l.prorate,
          showInPayslip: l.showInPayslip,
          isBasic: l.isBasic,
        })),
      ),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? 'That could not be saved.');
    toast(res.message ?? 'Saved');
    router.refresh();
    onDone();
  }

  const unused = PRESETS.filter((p) => !lines.some((l) => l.code.toUpperCase() === p.code));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span className="lbl">Code</span>
          <input
            value={code}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.toUpperCase())}
            placeholder="STD"
            maxLength={20}
          />
          <span className="hint">Short, and unique in this organisation.</span>
        </label>
        <label className="field">
          <span className="lbl">Name</span>
          <input
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="Standard structure"
          />
          <span className="hint">What HR will pick from a list on a compensation revision.</span>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-[12px]">
          <thead>
            <tr className="bg-slate-surface text-left text-[11px] uppercase tracking-wide text-slate-muted">
              <th className="p-2 font-semibold">Code</th>
              <th className="p-2 font-semibold">Name on the payslip</th>
              <th className="p-2 font-semibold">How it is calculated</th>
              <th className="p-2 text-right font-semibold">Value</th>
              <th className="p-2 text-center font-semibold" title="Counts towards wages under the Code on Wages, which drives PF, gratuity and bonus.">
                Wages
              </th>
              <th className="p-2 text-center font-semibold" title="Included in taxable income.">Taxable</th>
              <th className="p-2 text-center font-semibold" title="Reduced for unpaid days.">Pro-rate</th>
              <th className="p-2 text-center font-semibold">Basic</th>
              <th className="p-2 text-right font-semibold">At {inr(sampleCtc)}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-slate-line2 last:border-0">
                <td className="p-1.5">
                  <input
                    className="w-[84px] text-[12px]"
                    value={l.code}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      patch(l.key, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })
                    }
                  />
                </td>
                <td className="p-1.5">
                  <input
                    className="w-full min-w-[150px] text-[12px]"
                    value={l.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch(l.key, { name: e.target.value })}
                  />
                </td>
                <td className="p-1.5">
                  <select
                    className="text-[12px]"
                    value={l.kind}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setKind(l.key, e.target.value as Kind)}
                  >
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-1.5 text-right">
                  {l.kind === 'balance' ? (
                    <span className="text-slate-faint">—</span>
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      className="w-[92px] text-right text-[12px]"
                      value={String(l.value)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        patch(l.key, { value: Number(e.target.value) })
                      }
                    />
                  )}
                </td>
                <Tick on={l.wage} onToggle={() => patch(l.key, { wage: !l.wage })} label={`${l.code} counts as wages`} />
                <Tick on={l.taxable} onToggle={() => patch(l.key, { taxable: !l.taxable })} label={`${l.code} is taxable`} />
                <Tick on={l.prorate} onToggle={() => patch(l.key, { prorate: !l.prorate })} label={`${l.code} is pro-rated`} />
                <td className="p-1.5 text-center">
                  <input
                    type="radio"
                    name="basic-component"
                    checked={l.isBasic}
                    onChange={() => setBasic(l.key)}
                    aria-label={`${l.code} is the basic component`}
                    className="h-4 w-4 accent-brand"
                  />
                </td>
                <td className="p-1.5 text-right font-mono text-[11px] text-slate-body">
                  {inr(preview.amounts.get(l.key) ?? 0)}
                </td>
                <td className="p-1.5 text-right">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={lines.length <= 2}
                    title={lines.length <= 2 ? 'A structure needs a basic and a balancing component.' : 'Remove'}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            setLines((ls) => {
              const line: Line = {
                key: uid(), code: '', name: '', kind: 'fixed', value: 0,
                wage: false, taxable: true, prorate: true, showInPayslip: true, isBasic: false,
              };
              const at = ls.findIndex((x) => x.kind === 'balance');
              return at < 0 ? [...ls, line] : [...ls.slice(0, at), line, ...ls.slice(at)];
            })
          }
        >
          <Icon name="plus" size={13} />
          Add a component
        </button>

        {unused.length > 0 ? (
          <select
            className="max-w-[260px] text-[12px]"
            value=""
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              if (e.target.value) addPreset(e.target.value);
            }}
          >
            <option value="">Add a standard one…</option>
            {unused.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}

        <label className="ml-auto flex items-center gap-2 text-[12px] text-slate-muted">
          Preview at an annual CTC of
          <input
            type="number"
            step="10000"
            className="w-[120px] text-right text-[12px]"
            value={String(sampleCtc)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSampleCtc(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      <div className="rounded-xl bg-slate-surface px-3.5 py-3 text-[12px] leading-relaxed text-slate-body">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>
            Monthly CTC <b className="text-ink">{inr(preview.monthly)}</b>
          </span>
          <span>
            Components add to <b className="text-ink">{inr(preview.gross)}</b>
          </span>
          <span>
            Basic is <b className={preview.basicShare < 0.4 ? 'text-amber-text' : 'text-ink'}>
              {Math.round(preview.basicShare * 100)}%
            </b>{' '}
            of CTC
          </span>
          <span>
            Wages are <b className={preview.wageShare < 0.5 ? 'text-amber-text' : 'text-ink'}>
              {Math.round(preview.wageShare * 100)}%
            </b>{' '}
            of pay
          </span>
        </div>
        {preview.overspent ? (
          <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-amber-text">
            The components already add up to more than the monthly CTC at this figure, so the
            balancing component is zero and the structure does not reconcile. Fixed amounts are what
            usually cause this — they do not shrink with the salary, so a structure that works at
            ₹12,00,000 can overspend at ₹3,00,000. Lower the fixed amounts, or use a percentage.
          </p>
        ) : null}
        <p className="mt-1.5 text-[11px] text-slate-muted">
          {inclusive
            ? 'Employer PF, ESI and gratuity come out of CTC before this split, so the real figures are a little lower than the preview. The pay run computes them exactly.'
            : 'Employer PF, ESI and gratuity sit on top of CTC, so this split is the full gross.'}
          {preview.wageShare < 0.5
            ? ' Under the Code on Wages the excluded part cannot exceed half of total pay — the engine adds the excess back to wages, which raises PF and gratuity.'
            : ''}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Switch on={inclusive} onToggle={() => setInclusive((x) => !x)}
          label="CTC already includes the employer PF, ESI and gratuity cost"
          hint="On is the Indian norm: gross is CTC minus the employer contributions. Off means those sit on top of CTC." />
        <Switch on={active} onToggle={() => setActive((x) => !x)}
          label="Active"
          hint="An inactive structure stays on the compensation it is already used for, and disappears from the list for new revisions." />
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save structure'}
        </button>
      </div>
    </div>
  );
}

function Tick({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <td className="p-1.5 text-center">
      <input
        type="checkbox"
        checked={on}
        onChange={onToggle}
        aria-label={label}
        className="h-4 w-4 accent-brand"
      />
    </td>
  );
}

function Switch({ on, onToggle, label, hint }: { on: boolean; onToggle: () => void; label: string; hint: string }) {
  return (
    <div>
      <label className="flex items-start gap-2.5 text-[13px] text-ink">
        <input type="checkbox" checked={on} onChange={onToggle} className="mt-0.5 h-4 w-4 accent-brand" />
        <span>{label}</span>
      </label>
      <span className="ml-6.5 block pl-[10px] text-[11px] leading-relaxed text-slate-muted">{hint}</span>
    </div>
  );
}
