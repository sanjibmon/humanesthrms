'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { Kpi, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';
import { inr, inrShort, dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import {
  computePayRun, approvePayRun, lockPayRun, markPayRunPaid,
  publishPayslips, reopenPayRun, savePayAdjustment, deletePayAdjustment, bankAdvice,
} from '@/app/actions/payroll';

/* The slice of the engine's EmployeePayroll the payslip view needs. Kept
   structural rather than imported so a payload written by an older engine
   version still renders instead of throwing. */
type Line = { code: string; name: string; amount: number };
type Payload = {
  earnings?: Line[];
  reimbursements?: Line[];
  deductions?: Line[];
  employerContributions?: Line[];
  warnings?: string[];
  pf?: { employee?: number; employer?: number; eps?: number; epf?: number } | null;
  esi?: { employee?: number; employer?: number } | null;
  tds?: { monthly?: number; annualTax?: number; regime?: string } | null;
  wages?: { wages?: number; floorApplied?: boolean } | null;
};

export type ItemRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  paid_days: number;
  lop_days: number;
  gross: number;
  total_deductions: number;
  net: number;
  employer_cost: number;
  pf_employee: number;
  esi_employee: number;
  pt: number;
  tds: number;
  hold: boolean;
  hold_reason: string | null;
  payload: Payload | null;
};

export type AdjRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  kind: string;
  description: string | null;
  amount: number;
  status: string;
};

export type RunHeader = {
  id: string;
  period_month: string;
  run_type: string;
  status: string;
  entity_name: string | null;
  totals: Record<string, number> | null;
  engine_version: string | null;
  computed_at: string | null;
  approved_at: string | null;
  locked_at: string | null;
  paid_at: string | null;
  published_count: number;
};

const ADJ_KINDS = [
  { value: 'bonus', label: 'Bonus — taxable, excluded from wages' },
  { value: 'incentive', label: 'Incentive or commission' },
  { value: 'arrears', label: 'Arrears of wages' },
  { value: 'reimbursement', label: 'Reimbursement — not taxable' },
  { value: 'overtime_hours', label: 'Overtime hours — the engine prices them' },
  { value: 'deduction', label: 'Other deduction' },
];

export function RunDetail({
  run,
  items,
  adjustments,
  employees,
  caps,
}: {
  run: RunHeader;
  items: ItemRow[];
  adjustments: AdjRow[];
  employees: { value: string; label: string }[];
  caps: { run: boolean; approve: boolean; pay: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ kind: string; item?: ItemRow; adj?: AdjRow } | null>(null);
  const [notes, setNotes] = useState<{ warnings: { code: string; message: string }[]; skipped: { code: string; reason: string }[] } | null>(null);
  const [bank, setBank] = useState<{ filename: string; content: string; rows: number; problems: string[]; total: number } | null>(null);
  const close = () => setOpen(null);

  const editable = run.status === 'draft' || run.status === 'computed';
  const t = run.totals ?? {};

  async function act(fn: () => Promise<{ ok: boolean; message?: string; error?: string; data?: unknown }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Done') : (res.error ?? 'Failed'), !res.ok);
    if (res.ok) {
      const d = res.data as { warnings?: unknown[]; skipped?: unknown[] } | undefined;
      if (d?.warnings || d?.skipped) {
        setNotes({
          warnings: (d.warnings ?? []) as { code: string; message: string }[],
          skipped: (d.skipped ?? []) as { code: string; reason: string }[],
        });
      }
      close();
      router.refresh();
    }
  }

  /* A register the payroll team can hand to finance. Deliberately no bank
     account numbers: those are encrypted at rest and revealing them is its own
     audited action, not a side effect of downloading a spreadsheet. */
  const downloadRegister = () => {
    const head = ['Code', 'Employee', 'Paid days', 'LOP days', 'Gross', 'PF', 'ESI', 'PT', 'TDS', 'Total deductions', 'Net', 'Employer cost', 'On hold'];
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const body = items.map((i) => [
      i.employee_code, i.employee_name, i.paid_days, i.lop_days, i.gross,
      i.pf_employee, i.esi_employee, i.pt, i.tds, i.total_deductions, i.net, i.employer_cost,
      i.hold ? 'yes' : 'no',
    ].map(esc).join(','));
    const csv = [head.map(esc).join(','), ...body].join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-register-${run.period_month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  async function buildBankFile() {
    setBusy(true);
    const res = await bankAdvice(run.id);
    setBusy(false);
    if (!res.ok) {
      toast(res.error, true);
      return;
    }
    setBank(res);
  }

  function downloadBank() {
    if (!bank) return;
    const url = URL.createObjectURL(new Blob([bank.content], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = bank.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const held = useMemo(() => items.filter((i) => i.hold), [items]);
  const negative = useMemo(() => items.filter((i) => Number(i.net) < 0), [items]);

  return (
    <>
      {/* ---------------------------------------------------------- actions */}
      <div className="card mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-[15px] text-ink">{run.period_month}</b>
              <span className="badge">{run.run_type.replace(/_/g, ' ')}</span>
              <span className={`badge ${STATUS_CLASS[run.status] ?? ''}`}>{run.status}</span>
              {run.entity_name ? <span className="badge">{run.entity_name}</span> : null}
            </div>
            <p className="mt-1 text-xs text-slate-muted">
              {stamp(run)}
              {run.engine_version ? ` · engine ${run.engine_version}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {items.length ? (
              <button className="btn btn-sm" onClick={downloadRegister}>
                <Icon name="file" size={14} />
                Register CSV
              </button>
            ) : null}

            {(run.status === 'locked' || run.status === 'paid') && caps.pay ? (
              <button className="btn btn-sm" disabled={busy} onClick={buildBankFile}>
                <Icon name="card" size={14} />
                Bank file
              </button>
            ) : null}

            {editable && caps.run ? (
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => computePayRun(run.id))}>
                <Icon name="chart" size={14} />
                {run.status === 'draft' ? 'Compute' : 'Recompute'}
              </button>
            ) : null}

            {run.status === 'computed' && caps.approve ? (
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setOpen({ kind: 'approve' })}>
                <Icon name="checkcircle" size={14} />
                Approve
              </button>
            ) : null}

            {run.status === 'approved' && caps.approve ? (
              <>
                <button className="btn btn-sm" disabled={busy} onClick={() => setOpen({ kind: 'reopen' })}>
                  Reopen
                </button>
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setOpen({ kind: 'lock' })}>
                  <Icon name="lock" size={14} />
                  Lock
                </button>
              </>
            ) : null}

            {run.status === 'locked' && caps.pay ? (
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setOpen({ kind: 'paid' })}>
                Mark paid
              </button>
            ) : null}

            {(run.status === 'locked' || run.status === 'paid') && caps.run ? (
              <button className="btn btn-sm" disabled={busy} onClick={() => act(() => publishPayslips(run.id))}>
                <Icon name="receipt" size={14} />
                {run.published_count ? 'Republish payslips' : 'Publish payslips'}
              </button>
            ) : null}
          </div>
        </div>

        {run.published_count ? (
          <p className="mt-3 rounded-xl bg-leaf-soft px-3 py-2 text-xs text-leaf-text">
            {run.published_count} payslip(s) published — employees can see them under My Payroll.
          </p>
        ) : null}
      </div>

      {/* ----------------------------------------------------------- totals */}
      {items.length ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Net payable" value={inrShort(Number(t.net ?? sum(items, 'net')))} foot={`${items.length} employees`} rupee accent="brand" />
          <Kpi label="Gross" value={inrShort(Number(t.gross ?? sum(items, 'gross')))} foot="before deductions" rupee accent="slate" />
          <Kpi label="Statutory deductions" value={inrShort(sum(items, 'pf_employee') + sum(items, 'esi_employee') + sum(items, 'pt') + sum(items, 'tds'))} foot="PF, ESI, PT and TDS" rupee accent="amber" />
          <Kpi label="Employer cost" value={inrShort(Number(t.employerCost ?? sum(items, 'employer_cost')))} foot="CTC actually incurred" rupee accent="leaf" />
        </div>
      ) : null}

      {/* --------------------------------------------- warnings from compute */}
      {notes && (notes.warnings.length || notes.skipped.length) ? (
        <div className="card mb-5 border-l-[3px] border-l-amber-brand">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-amber-text"><Icon name="alert" size={16} /></span>
            <h3 className="text-sm">What the last computation flagged</h3>
            <button className="btn btn-sm ml-auto" onClick={() => setNotes(null)}>Dismiss</button>
          </div>
          {notes.skipped.length ? (
            <div className="mb-2">
              <b className="text-xs uppercase tracking-wide text-slate-muted">Skipped</b>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-[13px] text-slate-body">
                {notes.skipped.map((s, i) => (
                  <li key={i}><b>{s.code}</b> — {s.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {notes.warnings.length ? (
            <div>
              <b className="text-xs uppercase tracking-wide text-slate-muted">Warnings</b>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-[13px] text-slate-body">
                {notes.warnings.map((w, i) => (
                  <li key={i}><b>{w.code}</b> — {w.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {negative.length || held.length ? (
        <div className="card mb-5 border-l-[3px] border-l-amber-brand">
          <p className="text-[13px] leading-relaxed text-slate-body">
            {negative.length ? (
              <>
                <b>{negative.length} employee(s) have a negative net.</b> Approval will refuse the
                run until that is resolved — usually a recovery larger than the month's pay, which
                belongs spread across months instead.{' '}
              </>
            ) : null}
            {held.length ? <><b>{held.length} on hold</b> — held items are paid but not published.</> : null}
          </p>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- register */}
      <div className="card">
        <h3 className="mb-3 text-sm">Register</h3>
        {items.length === 0 ? (
          <EmptyState
            icon="chart"
            title="Not computed yet"
            body="Compute the run to see every employee's gross, statutory deductions and net for the month. Nothing is written to a payslip until the run is locked."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                  <th className="p-2.5 font-semibold">Employee</th>
                  <th className="p-2.5 text-right font-semibold">Paid</th>
                  <th className="p-2.5 text-right font-semibold">LOP</th>
                  <th className="p-2.5 text-right font-semibold">Gross</th>
                  <th className="hidden p-2.5 text-right font-semibold lg:table-cell">PF</th>
                  <th className="hidden p-2.5 text-right font-semibold lg:table-cell">ESI</th>
                  <th className="hidden p-2.5 text-right font-semibold lg:table-cell">PT</th>
                  <th className="hidden p-2.5 text-right font-semibold md:table-cell">TDS</th>
                  <th className="p-2.5 text-right font-semibold">Net</th>
                  <th className="p-2.5" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-slate-line2 last:border-0 hover:bg-slate-surface">
                    <td className="p-2.5">
                      <b className="block font-semibold text-ink">{i.employee_name}</b>
                      <span className="text-[11px] text-slate-muted">
                        {i.employee_code}
                        {i.hold ? ' · on hold' : ''}
                      </span>
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{n1(i.paid_days)}</td>
                    <td className="p-2.5 text-right tabular-nums">{Number(i.lop_days) ? n1(i.lop_days) : '—'}</td>
                    <td className="p-2.5 text-right tabular-nums">{inr(Number(i.gross))}</td>
                    <td className="hidden p-2.5 text-right tabular-nums lg:table-cell">{inr(Number(i.pf_employee))}</td>
                    <td className="hidden p-2.5 text-right tabular-nums lg:table-cell">{inr(Number(i.esi_employee))}</td>
                    <td className="hidden p-2.5 text-right tabular-nums lg:table-cell">{inr(Number(i.pt))}</td>
                    <td className="hidden p-2.5 text-right tabular-nums md:table-cell">{inr(Number(i.tds))}</td>
                    <td className={`p-2.5 text-right font-bold tabular-nums ${Number(i.net) < 0 ? 'text-red-600' : 'text-ink'}`}>
                      {inr(Number(i.net))}
                    </td>
                    <td className="p-2.5 text-right">
                      <button className="btn btn-sm" onClick={() => setOpen({ kind: 'slip', item: i })}>
                        Payslip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-line bg-slate-surface font-semibold">
                  <td className="p-2.5">Total</td>
                  <td className="p-2.5" />
                  <td className="p-2.5" />
                  <td className="p-2.5 text-right tabular-nums">{inr(sum(items, 'gross'))}</td>
                  <td className="hidden p-2.5 text-right tabular-nums lg:table-cell">{inr(sum(items, 'pf_employee'))}</td>
                  <td className="hidden p-2.5 text-right tabular-nums lg:table-cell">{inr(sum(items, 'esi_employee'))}</td>
                  <td className="hidden p-2.5 text-right tabular-nums lg:table-cell">{inr(sum(items, 'pt'))}</td>
                  <td className="hidden p-2.5 text-right tabular-nums md:table-cell">{inr(sum(items, 'tds'))}</td>
                  <td className="p-2.5 text-right tabular-nums">{inr(sum(items, 'net'))}</td>
                  <td className="p-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------- adjustments */}
      <div className="card mt-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm">One-off additions and deductions</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
              Applied to this month when the run is computed, and consumed when it is locked. A
              bonus is taxable but not wages; arrears count as wages, so they carry PF.
            </p>
          </div>
          {editable && caps.run ? (
            <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'adj' })}>
              <Icon name="plus" size={14} />
              Add
            </button>
          ) : null}
        </div>

        {adjustments.length === 0 ? (
          <p className="text-[13px] text-slate-muted">None for {run.period_month}.</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-line2">
            {adjustments.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <b className="block text-[13px] font-semibold text-ink">{a.employee_name}</b>
                  <span className="block text-[11px] text-slate-muted">
                    {a.kind.replace(/_/g, ' ')}
                    {a.description ? ` · ${a.description}` : ''} · {a.status}
                  </span>
                </div>
                <span className="text-[13px] font-semibold tabular-nums text-ink">{inr(Number(a.amount))}</span>
                {editable && caps.run && a.status === 'pending' ? (
                  <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => act(() => deletePayAdjustment(a.id))}>
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ modals */}
      {open?.kind === 'approve' ? (
        <ConfirmModal
          title="Approve this run"
          body={
            <>
              Approving confirms the figures for {run.period_month}. Whoever computed the run cannot
              approve it, and the run still has to be locked before payslips can be published.
            </>
          }
          confirmLabel="Approve"
          busy={busy}
          onConfirm={() => act(() => approvePayRun(run.id))}
          onClose={close}
        />
      ) : null}

      {open?.kind === 'lock' ? (
        <ConfirmModal
          title="Lock this run"
          danger
          body={
            <>
              Locking makes the figures final. The attendance behind them is frozen, loan instalments
              are posted, and the adjustments above are consumed. After this, a correction has to go
              in the next month as arrears or in an off-cycle run.
            </>
          }
          confirmLabel="Lock the run"
          busy={busy}
          onConfirm={() => act(() => lockPayRun(run.id))}
          onClose={close}
        />
      ) : null}

      {open?.kind === 'paid' ? (
        <ConfirmModal
          title="Mark as paid"
          body={<>Record that {inr(sum(items, 'net'))} has been disbursed for {run.period_month}.</>}
          confirmLabel="Mark paid"
          busy={busy}
          onConfirm={() => act(() => markPayRunPaid(run.id))}
          onClose={close}
        />
      ) : null}

      {open?.kind === 'reopen' ? (
        <Modal title="Reopen this run" sub="Audited — the reason is stored against the run" onClose={close}>
          <RecordForm
            fields={[{ name: 'reason', label: 'Why is it being reopened?', type: 'textarea', rules: [V.required('Reason'), V.minLen(5)] }]}
            initial={{ id: run.id, reason: '' }}
            action={(vals) => reopenPayRun({ ...vals, id: run.id })}
            submitLabel="Reopen"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'adj' ? (
        <Modal title="Add an adjustment" sub={`For ${run.period_month}`} onClose={close}>
          <RecordForm
            fields={[
              { name: 'employee_id', label: 'Employee', type: 'select', options: employees, rules: [V.required('Employee')] },
              { name: 'kind', label: 'Kind', type: 'select', options: ADJ_KINDS, rules: [V.required('Kind')], half: true },
              { name: 'amount', label: 'Amount', type: 'number', rules: [V.required('Amount'), V.nonNegative('Amount')], half: true },
              { name: 'description', label: 'Note', placeholder: 'Diwali bonus, Q2 incentive…' },
            ]}
            initial={{ period_month: run.period_month, kind: 'bonus' }}
            action={(vals) => savePayAdjustment({ ...vals, period_month: run.period_month })}
            submitLabel="Save adjustment"
            onDone={close}
            onCancel={close}
            note={
              <span>
                Recompute the run afterwards — an adjustment only reaches the register when the month
                is computed again.
              </span>
            }
          />
        </Modal>
      ) : null}

      {bank ? (
        <Modal
          title={bank.filename}
          sub={`${bank.rows} payment${bank.rows === 1 ? '' : 's'} · ${inr(bank.total)}`}
          wide
          onClose={() => setBank(null)}
          footer={
            <>
              <button className="btn" onClick={() => setBank(null)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={downloadBank}>
                <Icon name="card" size={14} />
                Download
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="rounded-xl bg-amber-bg px-3 py-2.5 text-[12px] leading-relaxed text-amber-text">
              This file carries full bank account numbers. Producing it has been recorded against
              your name and this run. Send it to the bank and delete your copy — it does not need to
              live in a downloads folder.
            </p>
            {bank.problems.length ? (
              <div>
                <b className="text-xs uppercase tracking-wide text-slate-muted">
                  Left out of the file
                </b>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-slate-body">
                  {bank.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-slate-muted">
                  Add their bank details on the employee page and build the file again, or pay them
                  separately.
                </p>
              </div>
            ) : (
              <p className="rounded-xl bg-leaf-soft px-3 py-2 text-[12px] text-leaf-text">
                Everybody who is due money has an account and an IFSC on record.
              </p>
            )}
          </div>
        </Modal>
      ) : null}

      {open?.kind === 'slip' && open.item ? (
        <Payslip item={open.item} month={run.period_month} onClose={close} />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ payslip */

function Payslip({ item, month, onClose }: { item: ItemRow; month: string; onClose: () => void }) {
  const p = item.payload ?? {};
  const section = (title: string, lines: Line[] | undefined) =>
    lines && lines.length ? (
      <div>
        <b className="text-xs uppercase tracking-wide text-slate-muted">{title}</b>
        <dl className="mt-1.5 flex flex-col gap-1 text-[13px]">
          {lines.map((l) => (
            <div key={l.code} className="flex items-baseline justify-between gap-4 border-b border-slate-line2 pb-1">
              <dt className="text-slate-body">{l.name}</dt>
              <dd className="font-medium tabular-nums text-ink">{inr(Number(l.amount))}</dd>
            </div>
          ))}
        </dl>
      </div>
    ) : null;

  return (
    <Modal title={item.employee_name} sub={`${item.employee_code} · ${month}`} wide onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-surface p-3 text-[13px] sm:grid-cols-4">
          <Fact label="Paid days" value={n1(item.paid_days)} />
          <Fact label="Loss of pay" value={Number(item.lop_days) ? n1(item.lop_days) : '—'} />
          <Fact label="Gross" value={inr(Number(item.gross))} />
          <Fact label="Net" value={inr(Number(item.net))} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {section('Earnings', p.earnings)}
          {section('Deductions', p.deductions)}
          {section('Reimbursements', p.reimbursements)}
          {section('Employer contributions', p.employerContributions)}
        </div>

        {p.tds ? (
          <p className="rounded-xl bg-brand-softer px-3 py-2 text-xs leading-relaxed text-slate-body">
            Tax is computed on the {p.tds.regime === 'new' ? 'new' : 'old'} regime, spread evenly over
            the remaining months of the financial year rather than deducted in a lump at the end.
            {p.tds.annualTax ? ` Annual liability ${inr(Number(p.tds.annualTax))}.` : ''}
          </p>
        ) : null}

        {p.wages?.floorApplied ? (
          <p className="rounded-xl bg-amber-bg px-3 py-2 text-xs leading-relaxed text-amber-text">
            The wage floor was applied: basic and dearness allowance came to less than half of total
            pay, so provident fund was computed on the floor rather than on the stated basic.
          </p>
        ) : null}

        {p.warnings?.length ? (
          <ul className="flex list-disc flex-col gap-1 rounded-xl bg-amber-bg px-3 py-2 pl-7 text-xs leading-relaxed text-amber-text">
            {p.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}

        {item.hold ? (
          <p className="rounded-xl bg-amber-bg px-3 py-2 text-xs text-amber-text">
            On hold{item.hold_reason ? `: ${item.hold_reason}` : ''}. Held items are excluded when
            payslips are published.
          </p>
        ) : null}

        <p className="text-[11px] text-slate-muted">
          Figures come from the stored computation for this run, not from a recalculation, so this is
          what the payslip will carry.{' '}
          <Link href={`/employees/${item.employee_id}`} className="font-semibold text-brand-dark">
            Open the employee record
          </Link>
        </p>
      </div>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="lbl">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

/* -------------------------------------------------------------------- utils */

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-line2 text-slate-muted',
  computed: 'bg-amber-bg text-amber-text',
  approved: 'bg-brand-soft text-brand-dark',
  locked: 'bg-leaf-soft text-leaf-text',
  paid: 'bg-leaf-soft text-leaf-text',
};

const sum = (rows: ItemRow[], key: keyof ItemRow) =>
  rows.reduce((a, r) => a + Number(r[key] ?? 0), 0);

const n1 = (n: number | string) => Number(n).toFixed(1).replace(/\.0$/, '');

function stamp(r: RunHeader): string {
  if (r.paid_at) return `Paid ${dateLabel(r.paid_at)}`;
  if (r.locked_at) return `Locked ${dateLabel(r.locked_at)}`;
  if (r.approved_at) return `Approved ${dateLabel(r.approved_at)}`;
  if (r.computed_at) return `Computed ${dateLabel(r.computed_at)}`;
  return 'Not computed yet';
}
