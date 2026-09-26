'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { EmptyState, Avatar } from '@/components/shell';
import { Icon } from '@/components/icon';
import { inr, dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import { sectionLabel, sectionShort, cappedValue, fyLabel } from '@/lib/tax-sections';
import {
  verifyDeclarationItem, verifyDeclaration, lockDeclaration, savePriorEmployerIncome,
} from '@/app/actions/tax';

export type VItem = {
  id: string;
  section: string;
  description: string | null;
  declared_amount: number;
  verified_amount: number | null;
  city: string | null;
  status: string;
};

export type VDecl = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  fy_start: number;
  regime: string;
  status: string;
  submitted_at: string | null;
  verified_at: string | null;
  statutory_regime: string | null;
  items: VItem[];
  prior: { income: number; tds: number } | null;
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-line2 text-slate-muted',
  submitted: 'bg-amber-bg text-amber-text',
  verified: 'bg-leaf-soft text-leaf-text',
  locked: 'bg-brand-soft text-brand-dark',
};

export function TaxVerification({
  declarations,
  employees,
  fyStart,
  canVerify,
}: {
  declarations: VDecl[];
  employees: { value: string; label: string }[];
  fyStart: number;
  canVerify: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState('submitted');
  const [modal, setModal] = useState<{ kind: string; decl?: VDecl; item?: VItem } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setModal(null);

  const shown = useMemo(
    () => (filter ? declarations.filter((d) => d.status === filter) : declarations),
    [declarations, filter],
  );

  const waiting = declarations.filter((d) => d.status === 'submitted').length;

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Done') : (res.error ?? 'Failed'), !res.ok);
    if (res.ok) {
      close();
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card">
        <div className="mb-3.5 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm">Tax declarations · {fyLabel(fyStart)}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
              A submitted declaration already reduces tax at its <b>declared</b> figure — that is
              deliberate, so nobody waits until January for relief they are entitled to in April.
              Verifying replaces each declared figure with the proved one, and the difference is
              spread over the months that are left rather than taken in one go.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="max-w-[170px]"
              value={filter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)}
            >
              <option value="">Every status</option>
              <option value="submitted">Waiting on you</option>
              <option value="draft">Not submitted</option>
              <option value="verified">Verified</option>
              <option value="locked">Locked</option>
            </select>
            {canVerify ? (
              <button className="btn btn-sm" onClick={() => setModal({ kind: 'prior' })}>
                <Icon name="plus" size={14} />
                Previous employer
              </button>
            ) : null}
          </div>
        </div>

        {declarations.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="Nobody has declared anything yet"
            body="Until somebody submits a declaration, every payslip in the organisation is taxed as though no employee has a single deduction. Point people at My Tax."
          />
        ) : shown.length === 0 ? (
          <p className="text-[13px] text-slate-muted">
            {filter === 'submitted' ? 'Nothing waiting on you.' : 'None with that status.'}
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-line2">
            {shown.map((d) => {
              const pending = d.items.filter((i) => i.status === 'pending').length;
              const declared = d.items.filter((i) => i.status !== 'rejected').reduce((a, i) => a + Number(i.declared_amount), 0);
              const isOpen = openId === d.id;
              return (
                <div key={d.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar name={d.employee_name} />
                    <div className="min-w-0 flex-1">
                      <b className="block text-[13px] font-semibold text-ink">{d.employee_name}</b>
                      <span className="block text-[11px] text-slate-muted">
                        {d.employee_code} · {d.regime} regime · {inr(declared)} declared
                        {d.items.length ? ` across ${d.items.length} item${d.items.length === 1 ? '' : 's'}` : ''}
                        {d.submitted_at ? ` · submitted ${dateLabel(d.submitted_at)}` : ''}
                      </span>
                    </div>
                    {pending ? (
                      <span className="badge bg-amber-bg text-amber-text">{pending} to check</span>
                    ) : null}
                    <span className={`badge ${STATUS_CLASS[d.status] ?? ''}`}>{d.status}</span>
                    <button className="btn btn-sm" onClick={() => setOpenId(isOpen ? null : d.id)}>
                      {isOpen ? 'Close' : 'Open'}
                    </button>
                  </div>

                  {isOpen ? (
                    <div className="mt-3 rounded-xl bg-slate-surface p-3">
                      {d.statutory_regime && d.statutory_regime !== d.regime ? (
                        <p className="mb-3 rounded-lg bg-amber-bg px-3 py-2 text-xs leading-relaxed text-amber-text">
                          They asked for the <b>{d.regime}</b> regime but payroll is still taxing
                          them on <b>{d.statutory_regime}</b>. Verifying this declaration switches it
                          over.
                        </p>
                      ) : null}

                      {d.items.length === 0 ? (
                        <p className="text-[13px] text-slate-muted">Nothing declared.</p>
                      ) : (
                        <div className="flex flex-col divide-y divide-slate-line">
                          {d.items.map((i) => {
                            const cap = cappedValue(i.section, Number(i.declared_amount));
                            return (
                              <div key={i.id} className="flex flex-wrap items-start gap-3 py-2">
                                <div className="min-w-0 flex-1">
                                  <b className="block text-[12px] font-semibold text-ink">
                                    {sectionLabel(i.section)}
                                  </b>
                                  <span className="block text-[11px] text-slate-muted">
                                    {i.description ? `${i.description} · ` : ''}
                                    {i.city ? `${i.city} · ` : ''}
                                    {cap.capped ? `capped at ${inr(cap.cap)}` : 'no cap on this section'}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <div className="text-[12px] font-semibold tabular-nums text-ink">
                                    {inr(Number(i.declared_amount))}
                                  </div>
                                  {i.status === 'accepted' ? (
                                    <div className="text-[11px] text-leaf-text">
                                      verified {inr(Number(i.verified_amount ?? 0))}
                                    </div>
                                  ) : null}
                                </div>
                                {canVerify && d.status !== 'locked' ? (
                                  <button
                                    className={`btn btn-sm ${i.status === 'pending' ? 'btn-primary' : ''}`}
                                    onClick={() => setModal({ kind: 'item', decl: d, item: i })}
                                  >
                                    {i.status === 'pending' ? 'Check' : 'Change'}
                                  </button>
                                ) : (
                                  <span className="badge">{i.status}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {d.prior ? (
                        <p className="mt-3 text-[11px] text-slate-muted">
                          Previous employer this year: {inr(d.prior.income)} salary,{' '}
                          {inr(d.prior.tds)} tax already deducted.
                        </p>
                      ) : null}

                      {canVerify ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {d.status === 'submitted' ? (
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={busy || pending > 0}
                              title={pending ? 'Check every item first' : undefined}
                              onClick={() => setModal({ kind: 'verify', decl: d })}
                            >
                              <Icon name="checkcircle" size={14} />
                              Mark verified
                            </button>
                          ) : null}
                          {d.status === 'verified' ? (
                            <button
                              className="btn btn-sm"
                              disabled={busy}
                              onClick={() => setModal({ kind: 'lock', decl: d })}
                            >
                              <Icon name="lock" size={14} />
                              Lock for the year
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {waiting && filter !== 'submitted' ? (
        <p className="text-xs text-slate-muted">
          {waiting} declaration{waiting === 1 ? '' : 's'} still waiting on a check.
        </p>
      ) : null}

      {/* ------------------------------------------------------------ modals */}
      {modal?.kind === 'item' && modal.item ? (
        <Modal
          title={`${sectionShort(modal.item.section)} · ${modal.decl?.employee_name}`}
          sub={`Declared ${inr(Number(modal.item.declared_amount))} for ${fyLabel(modal.decl?.fy_start ?? fyStart)}`}
          onClose={close}
        >
          <RecordForm
            fields={[
              {
                name: 'decision',
                label: 'Does the proof support it?',
                type: 'select',
                options: [
                  { value: 'accepted', label: 'Accept — at the amount the proof supports' },
                  { value: 'rejected', label: 'Reject — no acceptable proof' },
                ],
                rules: [V.required('Decision')],
              },
              {
                name: 'verified_amount',
                label: 'Verified amount',
                type: 'number',
                rules: [V.nonNegative('Verified amount')],
                hint: 'Enter what the proof actually supports, which may be less than declared. Zero is a valid answer and says somebody looked.',
                showWhen: { field: 'decision', in: ['accepted'] },
              },
              {
                name: 'description',
                label: 'Note',
                hint: 'The employee sees this.',
                placeholder: 'Receipts for three quarters only',
              },
            ]}
            initial={{
              decision: modal.item.status === 'rejected' ? 'rejected' : 'accepted',
              verified_amount: String(modal.item.verified_amount ?? modal.item.declared_amount ?? ''),
              description: modal.item.description ?? '',
            }}
            action={(vals: Values) => verifyDeclarationItem({ ...vals, id: modal.item!.id })}
            submitLabel="Save decision"
            onDone={close}
            onCancel={close}
            note={
              <span>
                Rejecting is not the same as verifying at zero. A rejected item is excluded outright;
                zero says it was examined and found to be worth nothing. Both end at zero tax relief,
                but only one is a record of a decision.
              </span>
            }
          />
        </Modal>
      ) : null}

      {modal?.kind === 'verify' && modal.decl ? (
        <ConfirmModal
          title={`Verify ${modal.decl.employee_name}'s declaration`}
          body={
            <>
              Payroll will use the verified figures from the next computation onward, and their tax
              regime will be set to <b>{modal.decl.regime}</b>. If the verified total came out lower
              than what was declared, the shortfall is recovered over the remaining months of the
              year rather than in a single payslip.
            </>
          }
          confirmLabel="Mark verified"
          busy={busy}
          onConfirm={() =>
            run(() =>
              verifyDeclaration({
                id: modal.decl!.id,
                employee_id: modal.decl!.employee_id,
                regime: modal.decl!.regime,
              }),
            )
          }
          onClose={close}
        />
      ) : null}

      {modal?.kind === 'lock' && modal.decl ? (
        <ConfirmModal
          title="Lock the year"
          danger
          body={
            <>
              Lock once Form 16 has been issued on these figures. After this neither the employee nor
              payroll can change anything for {fyLabel(modal.decl.fy_start)}.
            </>
          }
          confirmLabel="Lock"
          busy={busy}
          onConfirm={() => run(() => lockDeclaration(modal.decl!.id))}
          onClose={close}
        />
      ) : null}

      {modal?.kind === 'prior' ? (
        <Modal
          title="Previous employer income"
          sub="From the employee's Form 12B — added to the year so tax is not under-deducted"
          onClose={close}
        >
          <RecordForm
            fields={[
              {
                name: 'employee_id',
                label: 'Employee',
                type: 'select',
                options: employees,
                rules: [V.required('Employee')],
              },
              { name: 'fy_start', label: 'Financial year starting', type: 'number', rules: [V.required('Year')], half: true },
              { name: 'income', label: 'Salary from the previous employer', type: 'number', rules: [V.required('Salary'), V.nonNegative('Salary')], half: true },
              { name: 'tds', label: 'Tax already deducted there', type: 'number', rules: [V.required('Tax'), V.nonNegative('Tax')], half: true },
            ]}
            initial={{ fy_start: String(fyStart) }}
            action={savePriorEmployerIncome}
            submitLabel="Save"
            onDone={close}
            onCancel={close}
            note={
              <span>
                Without this, somebody who joined mid-year is taxed as though the year started on
                their joining date — which under-deducts, and lands them with a bill at filing time.
              </span>
            }
          />
        </Modal>
      ) : null}
    </div>
  );
}
