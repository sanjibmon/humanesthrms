'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { RecordForm, type FieldDef, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { EmptyState, Kpi } from '@/components/shell';
import { Icon } from '@/components/icon';
import { dateLabel, inr, inrShort } from '@/lib/format';
import * as V from '@/lib/validate';
import { createPayRun, saveSalaryStructure, approveCompensation } from '@/app/actions/payroll';
import { TaxVerification, type VDecl } from '@/components/payroll/tax-verification';

export type RunRow = {
  id: string;
  period_month: string;
  run_type: string;
  status: string;
  entity_id: string | null;
  entity_name: string | null;
  totals: Record<string, number> | null;
  computed_at: string | null;
  approved_at: string | null;
  locked_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export type StructureRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  template: { components?: { code: string; name: string; calc: Record<string, unknown> }[]; ctcIncludesEmployerCosts?: boolean } | null;
};

export type DraftCompRow = {
  id: string;
  employee_name: string;
  annual_ctc: number;
  effective_from: string;
  grade: string | null;
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-line2 text-slate-muted',
  computed: 'bg-amber-bg text-amber-text',
  approved: 'bg-brand-soft text-brand-dark',
  locked: 'bg-leaf-soft text-leaf-text',
  paid: 'bg-leaf-soft text-leaf-text',
};

/** The month before the current one — payroll is almost always run in arrears. */
function defaultMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

const TABS = ['Runs', 'Salary structures', 'Pending compensation', 'Tax declarations'] as const;
type Tab = (typeof TABS)[number];

export function PayrollConsole({
  runs,
  structures,
  draftComp,
  entities,
  declarations,
  employees,
  fyStart,
  caps,
}: {
  runs: RunRow[];
  structures: StructureRow[];
  draftComp: DraftCompRow[];
  entities: { value: string; label: string }[];
  declarations: VDecl[];
  employees: { value: string; label: string }[];
  fyStart: number;
  caps: { run: boolean; config: boolean };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Runs');
  const [open, setOpen] = useState<{ kind: string; row?: StructureRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Done') : (res.error ?? 'Failed'), !res.ok);
    if (res.ok) router.refresh();
  }

  const lastPaid = runs.find((r) => r.status === 'paid' || r.status === 'locked');

  const structureFields: FieldDef[] = [
    { name: 'code', label: 'Code', transform: 'upper', rules: [V.required('Code'), V.maxLen(20)], placeholder: 'STD', half: true },
    { name: 'name', label: 'Name', rules: [V.required('Name')], placeholder: 'Standard structure', half: true },
    {
      name: 'basic_pct',
      label: 'Basic as a percentage of CTC',
      type: 'number',
      rules: [V.required('Basic percentage'), V.positiveInt('Basic percentage')],
      hint: 'The labour codes expect wages — basic and dearness allowance — to be at least half of total pay. Below 50% the structure is flagged and PF is computed on a floor anyway.',
      half: true,
    },
    {
      name: 'hra_pct',
      label: 'HRA as a percentage of basic',
      type: 'number',
      rules: [V.required('HRA percentage'), V.nonNegative('HRA percentage')],
      hint: '50% for the metros, 40% elsewhere, is the usual choice.',
      half: true,
    },
    { name: 'conveyance', label: 'Conveyance allowance, a month', type: 'number', rules: [V.nonNegative('Conveyance')], half: true },
    { name: 'medical', label: 'Medical allowance, a month', type: 'number', rules: [V.nonNegative('Medical')], half: true },
    {
      name: 'ctc_includes_employer_costs',
      label: 'CTC already includes the employer PF, ESI and gratuity cost',
      type: 'switch',
      hint: 'On is the Indian norm: gross is CTC minus the employer contributions. Off means those sit on top of CTC.',
    },
    { name: 'is_active', label: 'Active', type: 'switch' },
  ];

  return (
    <>
      {lastPaid?.totals ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label={`Net paid · ${lastPaid.period_month}`} value={inrShort(Number(lastPaid.totals.net ?? 0))} foot={`${lastPaid.totals.employees ?? 0} employees`} rupee accent="leaf" />
          <Kpi label="Gross" value={inrShort(Number(lastPaid.totals.gross ?? 0))} foot="before deductions" rupee accent="brand" />
          <Kpi label="Employer cost" value={inrShort(Number(lastPaid.totals.employerCost ?? 0))} foot="including PF, ESI, gratuity" rupee accent="amber" />
          <Kpi label="TDS" value={inrShort(Number(lastPaid.totals.tds ?? 0))} foot="deducted and payable" rupee accent="slate" />
        </div>
      ) : null}

      <div className="tabbar mb-5">
        {TABS.map((t) => {
          const badge =
            t === 'Pending compensation'
              ? draftComp.length
              : t === 'Tax declarations'
                ? declarations.filter((d) => d.status === 'submitted').length
                : 0;
          return (
            <button
              key={t}
              className={`nav-item ${tab === t ? 'bg-brand-soft font-semibold text-brand-dark' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
              {badge ? (
                <span className="ml-1.5 rounded-full bg-amber-bg px-1.5 text-[11px] font-semibold text-amber-text">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === 'Tax declarations' ? (
        <TaxVerification
          declarations={declarations}
          employees={employees}
          fyStart={fyStart}
          canVerify={caps.run}
        />
      ) : null}

      {tab === 'Runs' ? (
        <div className="card">
          <div className="mb-3.5 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">Pay runs</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
                A run moves draft → computed → approved → locked → paid. Locking freezes the
                attendance behind it and applies loan instalments; after that, corrections go in the
                next month as arrears.
              </p>
            </div>
            {caps.run ? (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setOpen({ kind: 'run' })}
                disabled={structures.length === 0}
              >
                <Icon name="plus" size={14} />
                New run
              </button>
            ) : null}
          </div>

          {structures.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-6 text-center text-[13px] leading-relaxed text-slate-muted">
              No salary structure exists yet. A structure decides how CTC splits into basic, HRA and
              allowances, so nothing can be computed without one. Create it on the next tab.
            </p>
          ) : runs.length === 0 ? (
            <EmptyState
              icon="file"
              title="No pay runs yet"
              body="Create a run for a month, compute it, and the register appears with every figure the payslip will carry."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                    <th className="p-2.5 font-semibold">Month</th>
                    <th className="p-2.5 font-semibold">Type</th>
                    <th className="p-2.5 text-right font-semibold">Employees</th>
                    <th className="p-2.5 text-right font-semibold">Gross</th>
                    <th className="p-2.5 text-right font-semibold">Net</th>
                    <th className="p-2.5 font-semibold">Status</th>
                    <th className="p-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-slate-line2 last:border-0 hover:bg-slate-surface">
                      <td className="p-2.5">
                        <Link href={`/payroll/${r.id}`} className="font-semibold text-ink hover:text-brand-dark">
                          {r.period_month}
                        </Link>
                        {r.entity_name ? (
                          <span className="block text-[11px] text-slate-muted">{r.entity_name}</span>
                        ) : null}
                      </td>
                      <td className="p-2.5 text-slate-muted">{r.run_type.replace(/_/g, ' ')}</td>
                      <td className="p-2.5 text-right">{r.totals?.employees ?? '—'}</td>
                      <td className="p-2.5 text-right">{r.totals ? inr(Number(r.totals.gross ?? 0)) : '—'}</td>
                      <td className="p-2.5 text-right font-semibold text-ink">
                        {r.totals ? inr(Number(r.totals.net ?? 0)) : '—'}
                      </td>
                      <td className="p-2.5">
                        <span className={`badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status}</span>
                      </td>
                      <td className="p-2.5 text-right">
                        <Link href={`/payroll/${r.id}`} className="btn btn-sm">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'Salary structures' ? (
        <div className="card">
          <div className="mb-3.5 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">Salary structures</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
                A structure turns an annual CTC into monthly components. The special allowance takes
                whatever is left, so the parts always reconcile to the whole exactly.
              </p>
            </div>
            {caps.config ? (
              <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'structure' })}>
                <Icon name="plus" size={14} />
                New structure
              </button>
            ) : null}
          </div>

          {structures.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-6 text-center text-[13px] text-slate-muted">
              None yet. Most organisations need exactly one to begin with.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-line2">
              {structures.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px] font-semibold text-ink">
                      {s.name} ({s.code}){s.is_active ? '' : ' · inactive'}
                    </b>
                    <span className="block text-[11px] text-slate-muted">
                      {(s.template?.components ?? []).map((c) => c.code).join(' · ') || 'no components'}
                      {s.template?.ctcIncludesEmployerCosts ? ' · CTC includes employer cost' : ''}
                    </span>
                  </div>
                  {caps.config ? (
                    <button className="btn btn-sm" onClick={() => setOpen({ kind: 'structure', row: s })}>
                      Edit
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'Pending compensation' ? (
        <div className="card">
          <h3 className="mb-1 text-sm">Compensation waiting for approval</h3>
          <p className="mb-3 text-xs leading-relaxed text-slate-muted">
            A revision is a draft until it is approved, and payroll only reads approved ones. Whoever
            raised a revision cannot approve it, and an approved one is immutable — a change is a new
            revision with a later effective date, so the salary history stays intact.
          </p>
          {draftComp.length === 0 ? (
            <p className="text-[13px] text-slate-muted">Nothing pending.</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-line2">
              {draftComp.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px] font-semibold text-ink">{c.employee_name}</b>
                    <span className="block text-[11px] text-slate-muted">
                      <span className="rupee">{inr(Number(c.annual_ctc))}</span> a year from{' '}
                      {dateLabel(c.effective_from)}
                      {c.grade ? ` · grade ${c.grade}` : ''}
                    </span>
                  </div>
                  {caps.config ? (
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() => run(() => approveCompensation(c.id))}
                    >
                      Approve
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {open?.kind === 'run' ? (
        <Modal title="New pay run" sub="Payroll is normally run for the month just finished" onClose={close}>
          <RecordForm
            fields={[
              {
                name: 'period_month',
                label: 'Month',
                type: 'month',
                rules: [V.required('Month'), V.periodMonth],
                hint: 'The month being paid for, not the month it is paid in.',
                half: true,
              },
              {
                name: 'run_type',
                label: 'Type',
                type: 'select',
                options: [
                  { value: 'regular', label: 'Regular monthly run' },
                  { value: 'off_cycle', label: 'Off cycle — a correction or a one-off payment' },
                  { value: 'arrears', label: 'Arrears' },
                ],
                half: true,
              },
              {
                name: 'entity_id',
                label: 'Legal entity',
                type: 'select',
                options: [{ value: '', label: 'All entities' }, ...entities],
                hint: 'Runs are usually per entity, because PF and TDS are filed per entity.',
              },
            ]}
            initial={{ period_month: defaultMonth(), run_type: 'regular' }}
            action={createPayRun}
            submitLabel="Create draft run"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'structure' ? (
        <Modal
          title={open.row ? 'Edit salary structure' : 'New salary structure'}
          sub="Percentages of CTC, not rupee amounts, so one structure serves every grade"
          wide
          onClose={close}
        >
          <RecordForm
            fields={structureFields}
            initial={{
              code: open.row?.code ?? 'STD',
              name: open.row?.name ?? 'Standard structure',
              basic_pct: String(pctOf(open.row, 'BASIC') ?? 50),
              hra_pct: String(pctOf(open.row, 'HRA') ?? 50),
              conveyance: String(fixedOf(open.row, 'CONV') ?? ''),
              medical: String(fixedOf(open.row, 'MED') ?? ''),
              ctc_includes_employer_costs: open.row?.template?.ctcIncludesEmployerCosts ?? true,
              is_active: open.row?.is_active ?? true,
            }}
            action={(vals: Values) => saveSalaryStructure({ ...vals, id: open.row?.id ?? '' })}
            submitLabel="Save structure"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}
    </>
  );
}

const pctOf = (s: StructureRow | undefined, code: string): number | undefined => {
  const c = s?.template?.components?.find((x) => x.code === code);
  const calc = c?.calc as { pct?: number } | undefined;
  return calc?.pct;
};

const fixedOf = (s: StructureRow | undefined, code: string): number | undefined => {
  const c = s?.template?.components?.find((x) => x.code === code);
  const calc = c?.calc as { amount?: number } | undefined;
  return calc?.amount;
};
