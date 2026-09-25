'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm, type FieldDef, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';
import { dateLabel, inr } from '@/lib/format';
import * as V from '@/lib/validate';
import {
  createExpenseClaim,
  addExpenseItem,
  deleteExpenseItem,
  submitExpenseClaim,
  deleteExpenseClaim,
} from '@/app/actions/ess';

export type ClaimRow = {
  id: string;
  claim_no: string | null;
  title: string | null;
  total: number;
  status: string;
  submitted_at: string | null;
  created_at: string;
};

export type ItemRow = {
  id: string;
  claim_id: string;
  expense_date: string;
  category: string;
  merchant: string | null;
  amount: number;
  gst_amount: number | null;
  description: string | null;
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-line2 text-slate-muted',
  submitted: 'bg-amber-bg text-amber-text',
  approved: 'bg-leaf-soft text-leaf-text',
  rejected: 'bg-red-50 text-red-700',
  paid: 'bg-brand-soft text-brand-dark',
};

const CATEGORIES = [
  'Travel', 'Accommodation', 'Meals', 'Fuel', 'Telephone & internet',
  'Office supplies', 'Client entertainment', 'Training', 'Medical', 'Other',
].map((c) => ({ value: c, label: c }));

export function ExpenseConsole({
  claims,
  items,
  canClaim,
}: {
  claims: ClaimRow[];
  items: ItemRow[];
  canClaim: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<ClaimRow | null>(null);
  const [submitting, setSubmitting] = useState<ClaimRow | null>(null);
  const [deleting, setDeleting] = useState<ClaimRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const itemsOf = (claimId: string) => items.filter((i) => i.claim_id === claimId);

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Done') : (res.error ?? 'Failed'), !res.ok);
    if (res.ok) {
      after?.();
      router.refresh();
    }
  }

  const itemFields: FieldDef[] = [
    { name: 'expense_date', label: 'Date', type: 'date', rules: [V.required('Date')], half: true },
    { name: 'category', label: 'Category', type: 'select', options: CATEGORIES, rules: [V.required('Category')], half: true },
    { name: 'merchant', label: 'Merchant', placeholder: 'Who you paid', half: true },
    { name: 'amount', label: 'Amount', type: 'number', rules: [V.required('Amount'), V.positiveInt('Amount')], hint: 'In rupees, including GST.', half: true },
    { name: 'gst_amount', label: 'GST within that amount', type: 'number', rules: [V.nonNegative('GST')], hint: 'Optional, but it is what makes the claim reclaimable.', half: true },
    { name: 'description', label: 'What it was for', type: 'textarea' },
  ];

  return (
    <>
      <div className="card">
        <div className="mb-3.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm">My expense claims</h3>
            <p className="mt-0.5 text-xs text-slate-muted">
              Build a claim as a draft, add the lines, then submit it. Once submitted it goes to your
              manager and then to finance, and the lines are frozen.
            </p>
          </div>
          {canClaim ? (
            <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} />
              New claim
            </button>
          ) : null}
        </div>

        {claims.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="No claims yet"
            body="Start a claim, add each expense as a line with its date, category and GST, then submit the lot in one go."
          />
        ) : (
          <div className="flex flex-col divide-y divide-slate-line2">
            {claims.map((c) => {
              const lines = itemsOf(c.id);
              const isOpen = expanded === c.id;
              return (
                <div key={c.id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <b className="block text-[13px] font-semibold text-ink">
                        {c.title ?? 'Untitled claim'} · <span className="rupee">{inr(Number(c.total ?? 0))}</span>
                      </b>
                      <span className="block text-[11px] text-slate-muted">
                        {c.claim_no ? `${c.claim_no} · ` : ''}
                        {lines.length} line(s) · created {dateLabel(c.created_at)}
                        {c.submitted_at ? ` · submitted ${dateLabel(c.submitted_at)}` : ''}
                      </span>
                    </div>
                    <span className={`badge ${STATUS_CLASS[c.status] ?? ''}`}>{c.status}</span>
                    <button className="btn btn-sm" onClick={() => setExpanded(isOpen ? null : c.id)}>
                      {isOpen ? 'Hide' : 'Lines'}
                    </button>
                    {c.status === 'draft' && canClaim ? (
                      <>
                        <button className="btn btn-sm" onClick={() => setAddingTo(c)} disabled={busy}>
                          Add line
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => setDeleting(c)} disabled={busy}>
                          Delete
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => setSubmitting(c)}
                          disabled={busy || lines.length === 0}
                        >
                          Submit
                        </button>
                      </>
                    ) : null}
                  </div>

                  {isOpen ? (
                    <div className="mt-2.5 rounded-xl bg-slate-surface p-3">
                      {lines.length === 0 ? (
                        <p className="text-[12px] text-slate-muted">No lines yet.</p>
                      ) : (
                        <div className="flex flex-col divide-y divide-slate-line">
                          {lines.map((i) => (
                            <div key={i.id} className="flex flex-wrap items-center gap-2.5 py-2 text-[12px]">
                              <span className="w-24 shrink-0 text-slate-muted">{dateLabel(i.expense_date)}</span>
                              <span className="font-semibold text-ink">{i.category}</span>
                              <span className="min-w-0 flex-1 truncate text-slate-body">
                                {i.merchant ?? ''}
                                {i.description ? ` — ${i.description}` : ''}
                              </span>
                              <span className="rupee font-semibold text-ink">{inr(Number(i.amount))}</span>
                              {i.gst_amount ? (
                                <span className="text-slate-muted">GST {inr(Number(i.gst_amount))}</span>
                              ) : null}
                              {c.status === 'draft' && canClaim ? (
                                <button
                                  className="btn btn-sm"
                                  disabled={busy}
                                  onClick={() => run(() => deleteExpenseItem(i.id))}
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {creating ? (
        <Modal title="New expense claim" sub="A draft you can add lines to" onClose={() => setCreating(false)}>
          <RecordForm
            fields={[
              {
                name: 'title',
                label: 'What is this claim for',
                rules: [V.required('A title')],
                placeholder: 'Client visit — Bengaluru, March',
                hint: 'One claim per trip or per month works best.',
              },
            ]}
            action={createExpenseClaim}
            submitLabel="Create draft"
            onDone={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      ) : null}

      {addingTo ? (
        <Modal title="Add an expense line" sub={addingTo.title ?? undefined} onClose={() => setAddingTo(null)}>
          <RecordForm
            fields={itemFields}
            initial={{ expense_date: new Date().toISOString().slice(0, 10) }}
            action={(vals: Values) => addExpenseItem({ ...vals, claim_id: addingTo.id })}
            submitLabel="Add line"
            onDone={() => setAddingTo(null)}
            onCancel={() => setAddingTo(null)}
          />
        </Modal>
      ) : null}

      {submitting ? (
        <ConfirmModal
          title="Submit this claim?"
          busy={busy}
          confirmLabel="Submit"
          onClose={() => setSubmitting(null)}
          onConfirm={() => run(() => submitExpenseClaim(submitting.id), () => setSubmitting(null))}
          body={
            <>
              {itemsOf(submitting.id).length} line(s) totalling{' '}
              <b>{inr(Number(submitting.total ?? 0))}</b>. Once submitted the lines are frozen and it
              goes to your manager, then to finance.
            </>
          }
        />
      ) : null}

      {deleting ? (
        <ConfirmModal
          title="Delete this draft?"
          danger
          busy={busy}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => run(() => deleteExpenseClaim(deleting.id), () => setDeleting(null))}
          body={<>The draft and its lines go. Nothing has been submitted, so nobody else sees this.</>}
        />
      ) : null}
    </>
  );
}
