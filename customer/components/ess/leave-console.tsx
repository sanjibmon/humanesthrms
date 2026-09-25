'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm, type FieldDef, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';
import { dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import { applyLeave, cancelLeave } from '@/app/actions/ess';

export type LeaveTypeRow = {
  id: string;
  code: string;
  name: string;
  is_paid: boolean;
  half_day_allowed: boolean;
  days_per_year: number | null;
  doc_required_after_days: number | null;
};

export type BalanceRow = {
  leave_type_id: string;
  balance: number;
  credited: number;
  debited: number;
};

export type LeaveRequestRow = {
  id: string;
  request_no: string | null;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  half_day: string;
  days: number;
  reason: string | null;
  status: string;
  applied_at: string;
  decided_at: string | null;
};

const STATUS_CLASS: Record<string, string> = {
  approved: 'bg-leaf-soft text-leaf-text',
  pending: 'bg-amber-bg text-amber-text',
  rejected: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-line2 text-slate-muted',
};

export function LeaveConsole({
  types,
  balances,
  requests,
  canApply,
}: {
  types: LeaveTypeRow[];
  balances: BalanceRow[];
  requests: LeaveRequestRow[];
  canApply: boolean;
}) {
  const router = useRouter();
  const [apply, setApply] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequestRow | null>(null);
  const [busy, setBusy] = useState(false);

  const byType = new Map(types.map((t) => [t.id, t]));
  const balanceOf = (id: string) => balances.find((b) => b.leave_type_id === id);

  async function doCancel(row: LeaveRequestRow) {
    setBusy(true);
    const res = await cancelLeave(row.id);
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Cancelled') : res.error, !res.ok);
    if (res.ok) {
      setCancelling(null);
      router.refresh();
    }
  }

  const applyFields: FieldDef[] = [
    {
      name: 'leave_type_id',
      label: 'Leave type',
      type: 'select',
      options: types.map((t) => {
        const b = balanceOf(t.id);
        const bal = b ? ` — ${b.balance} left` : t.is_paid ? '' : ' — unpaid';
        return { value: t.id, label: `${t.name} (${t.code})${bal}` };
      }),
      rules: [V.required('Leave type')],
    },
    { name: 'from_date', label: 'From', type: 'date', rules: [V.required('Start date')], half: true },
    { name: 'to_date', label: 'To', type: 'date', mirrorFrom: 'from_date', rules: [V.required('End date')], half: true },
    {
      name: 'half_day',
      label: 'Half day',
      type: 'select',
      options: [
        { value: 'none', label: 'Full day' },
        { value: 'first', label: 'First half' },
        { value: 'second', label: 'Second half' },
      ],
      hint: 'Only for a single date, and only where the leave type allows it.',
      half: true,
    },
    {
      name: 'reason',
      label: 'Reason',
      type: 'textarea',
      hint: 'Your approver reads this. Some leave types need a supporting document past a few days.',
    },
    {
      name: 'document_path',
      label: 'Supporting document reference',
      hint: 'Optional for short leave. Required by longer sick leave — put the document reference here after uploading it.',
    },
  ];

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {types.filter((t) => t.is_paid).map((t) => {
          const b = balanceOf(t.id);
          return (
            <div key={t.id} className="card">
              <span className="lbl">{t.name}</span>
              <p className="mt-1 text-2xl font-bold text-ink">{b ? b.balance : '—'}</p>
              <p className="mt-0.5 text-[11px] text-slate-muted">
                {b
                  ? `${b.credited} credited · ${b.debited} used`
                  : t.days_per_year
                    ? `${t.days_per_year} a year, not yet credited`
                    : 'No balance configured'}
              </p>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="mb-3.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm">My leave</h3>
            <p className="mt-0.5 text-xs text-slate-muted">
              Weekly offs and holidays are excluded from the day count automatically.
            </p>
          </div>
          {canApply ? (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setApply(true)}
              disabled={types.length === 0}
            >
              <Icon name="plus" size={14} />
              Apply for leave
            </button>
          ) : null}
        </div>

        {types.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-6 text-center text-[13px] text-slate-muted">
            No leave types have been set up for your organisation yet. HR configures these — casual,
            sick, earned and so on — before anybody can apply.
          </p>
        ) : requests.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No leave applied for"
            body="Your applications appear here with their approval chain, so you can see who is holding one up."
          />
        ) : (
          <div className="flex flex-col divide-y divide-slate-line2">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <b className="block text-[13px] font-semibold text-ink">
                    {byType.get(r.leave_type_id)?.name ?? 'Leave'} · {r.days} day(s)
                    {r.half_day !== 'none' ? ` (${r.half_day} half)` : ''}
                  </b>
                  <span className="block text-[11px] text-slate-muted">
                    {dateLabel(r.from_date)} to {dateLabel(r.to_date)}
                    {r.request_no ? ` · ${r.request_no}` : ''} · applied {dateLabel(r.applied_at)}
                  </span>
                  {r.reason ? (
                    <span className="block truncate text-[11px] text-slate-body">{r.reason}</span>
                  ) : null}
                </div>
                <span className={`badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status}</span>
                {['pending', 'approved'].includes(r.status) ? (
                  <button className="btn btn-sm" onClick={() => setCancelling(r)} disabled={busy}>
                    Cancel
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {apply ? (
        <Modal title="Apply for leave" sub="Checked against your balance before it goes anywhere" onClose={() => setApply(false)}>
          <RecordForm
            fields={applyFields}
            initial={{ half_day: 'none' }}
            action={applyLeave}
            submitLabel="Apply"
            onDone={() => setApply(false)}
            onCancel={() => setApply(false)}
          />
        </Modal>
      ) : null}

      {cancelling ? (
        <ConfirmModal
          title="Cancel this leave?"
          danger
          busy={busy}
          confirmLabel="Cancel leave"
          onClose={() => setCancelling(null)}
          onConfirm={() => doCancel(cancelling)}
          body={
            cancelling.status === 'approved' ? (
              <>
                This leave is already approved. Cancelling returns {cancelling.days} day(s) to your
                balance and removes the leave marking from your attendance, unless payroll has
                already locked those days.
              </>
            ) : (
              <>The request is withdrawn before anybody decides on it.</>
            )
          }
        />
      ) : null}
    </>
  );
}
