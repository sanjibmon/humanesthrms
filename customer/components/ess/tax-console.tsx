'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { Kpi } from '@/components/shell';
import { Icon } from '@/components/icon';
import { inr } from '@/lib/format';
import * as V from '@/lib/validate';
import { SECTIONS, sectionLabel, sectionShort, cappedValue, fyLabel } from '@/lib/tax-sections';
import {
  setDeclarationRegime, saveDeclarationItem, deleteDeclarationItem, submitDeclaration,
} from '@/app/actions/tax';
import type { RegimeComparison } from '@/app/actions/tax';

export type ItemRow = {
  id: string;
  section: string;
  description: string | null;
  declared_amount: number;
  verified_amount: number | null;
  city: string | null;
  status: string;
};

export type DeclRow = {
  id: string;
  fy_start: number;
  regime: string;
  status: string;
  submitted_at: string | null;
  verified_at: string | null;
};

const STATUS_NOTE: Record<string, string> = {
  draft: 'Not submitted yet, so none of this is reducing your tax.',
  submitted: 'Submitted. Your declared figures are already reducing the tax in your payslip; payroll will check the proofs later.',
  verified: 'Checked by payroll. The verified figures are what your tax is now computed on.',
  locked: 'Locked for the year — Form 16 has been issued on these figures.',
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-line2 text-slate-muted',
  submitted: 'bg-amber-bg text-amber-text',
  verified: 'bg-leaf-soft text-leaf-text',
  locked: 'bg-brand-soft text-brand-dark',
};

const ITEM_CLASS: Record<string, string> = {
  pending: 'bg-slate-line2 text-slate-muted',
  accepted: 'bg-leaf-soft text-leaf-text',
  rejected: 'bg-red-50 text-red-700',
};

export function TaxConsole({
  decl,
  items,
  comparison,
  prior,
  statutoryRegime,
}: {
  decl: DeclRow;
  items: ItemRow[];
  comparison: RegimeComparison;
  prior: { income: number; tds: number } | null;
  statutoryRegime: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{ kind: string; item?: ItemRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  const editable = decl.status === 'draft' || decl.status === 'submitted';
  const isOld = decl.regime === 'old';

  const declaredTotal = useMemo(
    () => items.filter((i) => i.status !== 'rejected').reduce((a, i) => a + Number(i.declared_amount), 0),
    [items],
  );
  const verifiedTotal = useMemo(
    () => items.filter((i) => i.status === 'accepted').reduce((a, i) => a + Number(i.verified_amount ?? 0), 0),
    [items],
  );

  /* Sections that do nothing under the chosen regime, but have a figure in
     them. Worth saying out loud rather than letting somebody wonder why their
     tax did not move. */
  const inert = useMemo(
    () =>
      items.filter(
        (i) => !isOld && (SECTIONS.find((s) => s.value === i.section)?.oldRegimeOnly ?? false),
      ),
    [items, isOld],
  );

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

  const itemFields = (item?: ItemRow) => [
    {
      name: 'section',
      label: 'What are you claiming?',
      type: 'select' as const,
      options: SECTIONS.map((s) => ({ value: s.value, label: s.label })),
      rules: [V.required('Section')],
      disabled: !!item,
    },
    {
      name: 'declared_amount',
      label: 'Amount for the whole year',
      type: 'number' as const,
      rules: [V.required('Amount'), V.nonNegative('Amount')],
      hint: 'The figure for the full financial year, not per month.',
      half: true,
    },
    {
      name: 'city',
      label: 'City you rent in',
      placeholder: 'Mumbai',
      hint: 'The exemption is higher in the metros, so this changes the figure.',
      half: true,
      showWhen: { field: 'section', in: ['rent'] },
    },
    { name: 'description', label: 'Note', placeholder: 'LIC policy 1234, HDFC ELSS…' },
  ];

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Declared" value={inr(declaredTotal)} foot={`for ${fyLabel(decl.fy_start)}`} rupee accent="brand" />
        <Kpi label="Verified" value={inr(verifiedTotal)} foot={verifiedTotal ? 'proofs accepted' : 'nothing checked yet'} rupee accent="leaf" />
        <Kpi
          label="Regime"
          value={isOld ? 'Old' : 'New'}
          foot={comparison.ok ? (comparison.better === decl.regime ? 'the cheaper one for you' : 'not the cheaper one') : 'deductions apply only on old'}
          icon="shieldcheck"
          accent={comparison.ok && comparison.better !== decl.regime ? 'amber' : 'slate'}
        />
        <Kpi label="Items" value={items.length} foot={`${items.filter((i) => i.status === 'pending').length} awaiting a check`} icon="file" accent="slate" />
      </div>

      {/* --------------------------------------------------------- status */}
      <div className="card mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <b className="text-[15px] text-ink">Financial year {fyLabel(decl.fy_start)}</b>
              <span className={`badge ${STATUS_CLASS[decl.status] ?? ''}`}>{decl.status}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-muted">{STATUS_NOTE[decl.status]}</p>
          </div>
          {editable ? (
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => setOpen({ kind: 'regime' })}>
                Change regime
              </button>
              {decl.status === 'draft' ? (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy || items.length === 0}
                  onClick={() => setOpen({ kind: 'submit' })}
                >
                  Submit declaration
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {statutoryRegime && statutoryRegime !== decl.regime ? (
          <p className="mt-3 rounded-xl bg-amber-bg px-3 py-2 text-xs leading-relaxed text-amber-text">
            Your payslips are still being taxed under the <b>{statutoryRegime}</b> regime. Payroll
            switches that over when they verify this declaration, so the change will show up then,
            not immediately.
          </p>
        ) : null}
      </div>

      {/* ----------------------------------------------------- comparison */}
      <div className="card mb-5">
        <h3 className="mb-1 text-sm">Which regime costs you less?</h3>
        {comparison.ok ? (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(['old', 'new'] as const).map((r) => {
                const tax = r === 'old' ? comparison.oldTax : comparison.newTax;
                const chosen = decl.regime === r;
                const best = comparison.better === r;
                return (
                  <div
                    key={r}
                    className={`rounded-xl border p-3.5 ${best ? 'border-leaf bg-leaf-soft' : 'border-slate-line bg-white'}`}
                  >
                    <div className="flex items-center gap-2">
                      <b className="text-[13px] font-semibold text-ink">
                        {r === 'old' ? 'Old regime' : 'New regime'}
                      </b>
                      {best ? <span className="badge bg-leaf-soft text-leaf-text">cheaper</span> : null}
                      {chosen ? <span className="badge">you chose this</span> : null}
                    </div>
                    <div className="mt-1.5 text-[22px] font-bold tabular-nums text-ink">{inr(tax)}</div>
                    <div className="text-[11px] text-slate-muted">tax for the year</div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-muted">
              {comparison.saving > 0 ? (
                <>
                  The {comparison.better} regime saves you <b>{inr(comparison.saving)}</b> on these
                  figures.{' '}
                </>
              ) : (
                <>Both regimes come out the same on these figures. </>
              )}
              {comparison.basis} Declaring more under the old regime will move this, so come back
              after you have added everything.
            </p>
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-slate-muted">{comparison.reason}</p>
        )}
      </div>

      {/* ---------------------------------------------------------- items */}
      <div className="card">
        <div className="mb-3.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm">What you are claiming</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
              Declare for the whole financial year. Your employee provident fund is added
              automatically under 80C, so do not enter it here.
            </p>
          </div>
          {editable ? (
            <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'item' })}>
              <Icon name="plus" size={14} />
              Add
            </button>
          ) : null}
        </div>

        {inert.length ? (
          <p className="mb-3 rounded-xl bg-amber-bg px-3 py-2 text-xs leading-relaxed text-amber-text">
            {inert.length === 1 ? 'One of these' : `${inert.length} of these`} only reduces tax under
            the <b>old</b> regime, and you are on the new one — so {inert.length === 1 ? 'it is' : 'they are'}{' '}
            currently doing nothing. The comparison above shows what switching would cost or save.
          </p>
        ) : null}

        {items.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-6 text-center text-[13px] leading-relaxed text-slate-muted">
            Nothing declared. If you pay rent, have a life insurance policy, a home loan or health
            insurance, this is where it goes.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-line2">
            {items.map((i) => {
              const cap = cappedValue(i.section, Number(i.declared_amount));
              return (
                <div key={i.id} className="flex flex-wrap items-start gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px] font-semibold text-ink">{sectionLabel(i.section)}</b>
                    <span className="block text-[11px] text-slate-muted">
                      {i.description ? `${i.description} · ` : ''}
                      {i.city ? `${i.city} · ` : ''}
                      {cap.capped ? (
                        <span className="text-amber-text">
                          capped at {inr(cap.cap)} — anything above that does not reduce tax
                        </span>
                      ) : (
                        'declared for the year'
                      )}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-semibold tabular-nums text-ink">
                      {inr(Number(i.declared_amount))}
                    </div>
                    {i.status === 'accepted' && Number(i.verified_amount) !== Number(i.declared_amount) ? (
                      <div className="text-[11px] text-amber-text">
                        verified at {inr(Number(i.verified_amount ?? 0))}
                      </div>
                    ) : null}
                  </div>
                  <span className={`badge ${ITEM_CLASS[i.status] ?? ''}`}>{i.status}</span>
                  {editable ? (
                    <div className="flex gap-2">
                      <button className="btn btn-sm" onClick={() => setOpen({ kind: 'item', item: i })}>
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy}
                        onClick={() => run(() => deleteDeclarationItem(i.id))}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {prior ? (
        <div className="card mt-5">
          <h3 className="mb-1 text-sm">Income from a previous employer this year</h3>
          <p className="mb-3 text-xs leading-relaxed text-slate-muted">
            Recorded by payroll from your Form 12B. It is added to your income for the year, and the
            tax already deducted there is credited, so you are not taxed twice.
          </p>
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <div className="lbl">Salary</div>
              <div className="mt-0.5 font-semibold tabular-nums text-ink">{inr(prior.income)}</div>
            </div>
            <div>
              <div className="lbl">Tax already deducted</div>
              <div className="mt-0.5 font-semibold tabular-nums text-ink">{inr(prior.tds)}</div>
            </div>
          </dl>
        </div>
      ) : null}

      {/* --------------------------------------------------------- modals */}
      {open?.kind === 'item' ? (
        <Modal
          title={open.item ? `Edit ${sectionShort(open.item.section)}` : 'Add a declaration'}
          sub={`Financial year ${fyLabel(decl.fy_start)}`}
          onClose={close}
        >
          <RecordForm
            fields={itemFields(open.item)}
            initial={{
              section: open.item?.section ?? '80c',
              declared_amount: String(open.item?.declared_amount ?? ''),
              city: open.item?.city ?? '',
              description: open.item?.description ?? '',
            }}
            action={(vals: Values) =>
              saveDeclarationItem({ ...vals, id: open.item?.id ?? '', declaration_id: decl.id })
            }
            submitLabel="Save"
            onDone={close}
            onCancel={close}
            note={
              open.item?.status === 'accepted' ? (
                <span>
                  This one has already been checked. Changing the figure withdraws that approval and
                  payroll will look at it again.
                </span>
              ) : undefined
            }
          />
        </Modal>
      ) : null}

      {open?.kind === 'regime' ? (
        <Modal title="Choose your tax regime" sub="You can change it until payroll verifies the year" onClose={close}>
          <RecordForm
            fields={[
              {
                name: 'regime',
                label: 'Regime',
                type: 'select',
                options: [
                  { value: 'new', label: 'New regime — lower rates, almost no deductions' },
                  { value: 'old', label: 'Old regime — higher rates, but 80C, HRA, home loan and the rest count' },
                ],
                rules: [V.required('Regime')],
                hint:
                  comparison.ok
                    ? `On your current figures the ${comparison.better} regime costs ${inr(Math.min(comparison.oldTax, comparison.newTax))} against ${inr(Math.max(comparison.oldTax, comparison.newTax))}.`
                    : 'Declare what you can first — the comparison needs figures to work with.',
              },
            ]}
            initial={{ regime: decl.regime }}
            action={(vals: Values) => setDeclarationRegime({ ...vals, id: decl.id })}
            submitLabel="Save regime"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'submit' ? (
        <ConfirmModal
          title="Submit your declaration"
          body={
            <>
              Your declared figures start reducing the tax in your next payslip straight away — you
              do not have to wait for the proofs to be checked. You can still add and change items
              until payroll verifies the year, and if a proof falls short later, the difference is
              recovered over the remaining months rather than all at once.
            </>
          }
          confirmLabel="Submit"
          busy={busy}
          onConfirm={() => run(() => submitDeclaration(decl.id))}
          onClose={close}
        />
      ) : null}
    </>
  );
}
