'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icon';
import { Avatar } from '@/components/shell';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm, type FieldDef } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { dateLabel, daysLeft, inr } from '@/lib/format';
import * as V from '@/lib/validate';
import {
  createCustomer,
  updateCustomer,
  extendTrial,
  convertCustomer,
  deleteCustomer,
  setCustomerStatus,
} from '@/app/actions/customers';

export type PlanRow = { code: string; name: string; price_per_seat_paise: number; max_seats: number | null };

export type CustomerRow = {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string | null;
  status: string;
  industry: string | null;
  pan: string | null;
  tan: string | null;
  gstin: string | null;
  trial_ends_at: string | null;
  trial_extended_count: number;
  created_at: string;
  seats_total: number;
  seats_used: number;
  plan_code: string | null;
  plan_name: string | null;
  price_per_seat_paise: number;
};

const STATUS_CLASS: Record<string, string> = {
  trial: 'bg-amber-bg text-amber-text',
  active: 'bg-leaf-soft text-leaf-text',
  suspended: 'bg-slate-line2 text-slate-muted',
  expired: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-line2 text-slate-faint',
};

const INDUSTRIES = [
  'Information Technology',
  'Manufacturing',
  'Financial Services',
  'Healthcare',
  'Retail and E-commerce',
  'Logistics',
  'Education',
  'Professional Services',
  'Construction',
  'Hospitality',
  'Other',
].map((x) => ({ value: x, label: x }));

function planOptions(plans: PlanRow[], includeTrial = true) {
  return plans
    .filter((p) => (includeTrial ? true : p.code !== 'trial'))
    .map((p) => ({
      value: p.code,
      label:
        p.code === 'trial'
          ? 'Trial — free, up to 50 seats'
          : `${p.name} — ${inr(p.price_per_seat_paise / 100)}/seat${p.max_seats ? `, up to ${p.max_seats}` : ', unlimited seats'}`,
    }));
}

export function CustomerConsole({
  rows,
  plans,
  canWrite,
}: {
  rows: CustomerRow[];
  plans: PlanRow[];
  canWrite: boolean;
}) {
  const [open, setOpen] = useState<
    | { kind: 'create' }
    | { kind: 'edit' | 'extend' | 'convert' | 'delete'; row: CustomerRow }
    | { kind: 'status'; row: CustomerRow; to: 'suspended' | 'active' | 'expired' | 'cancelled' }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  const createFields: FieldDef[] = [
    { name: 'name', label: 'Company name', step: 'Company', rules: [V.required('Company name'), V.maxLen(120)], placeholder: 'Acme India' },
    { name: 'legal_name', label: 'Registered legal name', step: 'Company', hint: 'As it appears on the certificate of incorporation.' },
    { name: 'slug', label: 'Short name', step: 'Company', mirrorFrom: 'name', transform: 'slug', rules: [V.required('Short name'), V.slug], hint: 'Used in URLs and white-label subdomains. Lowercase, hyphens.', half: true },
    { name: 'industry', label: 'Industry', type: 'select', step: 'Company', options: INDUSTRIES, half: true },

    { name: 'status', label: 'Start as', type: 'select', step: 'Plan', options: [{ value: 'trial', label: 'Trial' }, { value: 'active', label: 'Paid — active immediately' }], rules: [V.required('Start as')], half: true },
    { name: 'trial_days', label: 'Trial length', type: 'select', step: 'Plan', options: [7, 14, 30].map((d) => ({ value: String(d), label: `${d} days` })), showWhen: { field: 'status', in: ['trial'] }, half: true },
    { name: 'plan', label: 'Plan', type: 'select', step: 'Plan', options: planOptions(plans), rules: [V.required('Plan')], half: true },
    { name: 'seats', label: 'Licensed seats', type: 'number', step: 'Plan', rules: [V.required('Seats'), V.positiveInt('Seats')], hint: 'Employees cannot exceed this without a licence change.', half: true },
    { name: 'billing_cycle', label: 'Billing cycle', type: 'select', step: 'Plan', options: [{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }], showWhen: { field: 'status', in: ['active'] }, half: true },

    { name: 'pan', label: 'PAN', step: 'Statutory', transform: 'upper', rules: [V.pan], placeholder: 'AAAAA1111A', half: true },
    { name: 'tan', label: 'TAN', step: 'Statutory', transform: 'upper', rules: [V.tan], placeholder: 'AAAA11111A', half: true },
    { name: 'gstin', label: 'GSTIN', step: 'Statutory', transform: 'upper', rules: [V.gstin], placeholder: '27AAAAA1111A1Z5' },

    { name: 'owner_email', label: 'Owner email', type: 'email', step: 'Owner', rules: [V.email], hint: 'They receive an invitation to set a password and enrol an authenticator.' },
    { name: 'owner_role', label: 'Their role', type: 'select', step: 'Owner', options: [
      { value: 'owner', label: 'Owner — full control of their organisation' },
      { value: 'hr_admin', label: 'HR Admin' },
      { value: 'payroll_admin', label: 'Payroll Admin' },
    ] },
  ];

  const editFields = (r: CustomerRow): FieldDef[] => [
    { name: 'id', label: 'id', type: 'text', disabled: true },
    { name: 'name', label: 'Company name', rules: [V.required('Company name'), V.maxLen(120)] },
    { name: 'legal_name', label: 'Registered legal name' },
    { name: 'slug', label: 'Short name', transform: 'slug', rules: [V.required('Short name'), V.slug], half: true },
    { name: 'industry', label: 'Industry', type: 'select', options: INDUSTRIES, half: true },
    { name: 'pan', label: 'PAN', transform: 'upper', rules: [V.pan], half: true },
    { name: 'tan', label: 'TAN', transform: 'upper', rules: [V.tan], half: true },
    { name: 'gstin', label: 'GSTIN', transform: 'upper', rules: [V.gstin] },
  ].filter((f) => f.name !== 'id') as FieldDef[];

  const columns: Column<CustomerRow>[] = [
    {
      key: 'name',
      header: 'Company',
      sortable: true,
      value: (r) => `${r.name} ${r.slug ?? ''} ${r.legal_name ?? ''}`,
      cell: (r) => (
        <Link href={`/customers/${r.id}`} className="flex items-center gap-2.5 hover:text-brand-dark">
          <Avatar name={r.name} />
          <span>
            <b className="block font-semibold text-ink">{r.name}</b>
            <span className="text-[11px] text-slate-muted">{r.slug ?? '—'}</span>
          </span>
        </Link>
      ),
    },
    { key: 'plan', header: 'Plan', sortable: true, value: (r) => r.plan_name ?? '', cell: (r) => <span className="badge">{r.plan_name ?? '—'}</span>, hideBelow: 'sm' },
    { key: 'seats', header: 'Seats', sortable: true, align: 'right', value: (r) => r.seats_total, cell: (r) => <span>{r.seats_used}/{r.seats_total}</span> },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      value: (r) => r.status,
      cell: (r) => {
        const d = r.status === 'trial' ? daysLeft(r.trial_ends_at) : null;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status}</span>
            {d !== null ? (
              <span className={`badge ${d < 3 ? 'bg-red-50 text-red-700' : d < 7 ? 'bg-amber-bg text-amber-text' : ''}`}>
                {d < 0 ? 'lapsed' : `${d}d left`}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'mrr',
      header: 'MRR',
      sortable: true,
      align: 'right',
      hideBelow: 'md',
      value: (r) => (r.status === 'active' ? (r.seats_total * r.price_per_seat_paise) / 100 : 0),
      cell: (r) => (r.status === 'active' ? inr((r.seats_total * r.price_per_seat_paise) / 100) : '—'),
    },
    { key: 'created', header: 'Created', sortable: true, hideBelow: 'lg', value: (r) => r.created_at, cell: (r) => dateLabel(r.created_at) },
  ];

  async function runStatus(row: CustomerRow, to: 'suspended' | 'active' | 'expired' | 'cancelled') {
    setBusy(true);
    const res = await setCustomerStatus(row.id, to);
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Updated') : res.error, !res.ok);
    if (res.ok) close();
  }

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        searchPlaceholder="Search by company, short name or legal name…"
        empty={{
          icon: 'building',
          title: 'No customers yet',
          body: 'Create your first customer. The organisation, its licence and its modules are set up in one step, and the owner is emailed an invitation.',
          action: canWrite ? (
            <button className="btn btn-primary" onClick={() => setOpen({ kind: 'create' })}>
              <Icon name="plus" size={16} />
              Add Customer
            </button>
          ) : undefined,
        }}
        toolbar={
          canWrite ? (
            <button className="btn btn-primary" onClick={() => setOpen({ kind: 'create' })}>
              <Icon name="plus" size={16} />
              Add Customer
            </button>
          ) : null
        }
        rowActions={(r) => (
          <>
            <Link href={`/customers/${r.id}`} className="btn btn-sm">
              Open
            </Link>
            {canWrite ? (
              <>
                <button className="btn btn-sm" onClick={() => setOpen({ kind: 'edit', row: r })}>
                  Edit
                </button>
                {r.status === 'trial' ? (
                  <>
                    <button className="btn btn-sm" onClick={() => setOpen({ kind: 'extend', row: r })}>
                      Extend
                    </button>
                    <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'convert', row: r })}>
                      Convert
                    </button>
                  </>
                ) : null}
                {r.status === 'active' ? (
                  <button className="btn btn-sm" onClick={() => setOpen({ kind: 'status', row: r, to: 'suspended' })}>
                    Suspend
                  </button>
                ) : null}
                {r.status === 'suspended' ? (
                  <button className="btn btn-sm" onClick={() => setOpen({ kind: 'status', row: r, to: 'active' })}>
                    Reactivate
                  </button>
                ) : null}
                <button className="btn btn-sm btn-danger" onClick={() => setOpen({ kind: 'delete', row: r })}>
                  Delete
                </button>
              </>
            ) : null}
          </>
        )}
      />

      {open?.kind === 'create' ? (
        <Modal
          title="Add Customer"
          sub="Creates the organisation, its licence and its modules in one transaction."
          wide
          onClose={close}
        >
          <RecordForm
            fields={createFields}
            initial={{ status: 'trial', trial_days: '14', plan: 'trial', seats: '25', billing_cycle: 'monthly', owner_role: 'owner' }}
            action={createCustomer}
            submitLabel="Create customer"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'edit' ? (
        <Modal title={`Edit ${open.row.name}`} sub="Commercial state is changed from the lifecycle actions, not here." wide onClose={close}>
          <RecordForm
            fields={editFields(open.row)}
            initial={{
              name: open.row.name,
              legal_name: open.row.legal_name ?? '',
              slug: open.row.slug ?? '',
              industry: open.row.industry ?? '',
              pan: open.row.pan ?? '',
              tan: open.row.tan ?? '',
              gstin: open.row.gstin ?? '',
            }}
            action={(v) => updateCustomer({ ...v, id: open.row.id })}
            submitLabel="Save changes"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'extend' ? (
        <Modal
          title={`Extend ${open.row.name}'s trial`}
          sub={`Currently ends ${dateLabel(open.row.trial_ends_at)} · extended ${open.row.trial_extended_count} time(s) already`}
          onClose={close}
        >
          <RecordForm
            fields={[
              { name: 'days', label: 'Extend by', type: 'select', options: [7, 14, 30].map((d) => ({ value: String(d), label: `${d} days` })), rules: [V.required('Length')] },
              { name: 'reason', label: 'Reason', type: 'textarea', hint: 'Recorded against the account for the sales history.' },
            ]}
            initial={{ days: '7' }}
            action={(v) => extendTrial({ ...v, id: open.row.id })}
            submitLabel="Extend trial"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'convert' ? (
        <Modal
          title={`Convert ${open.row.name} to a paid plan`}
          sub="Sets the account active, swaps the licence and re-syncs modules to the new plan."
          onClose={close}
        >
          <RecordForm
            fields={[
              { name: 'plan', label: 'Plan', type: 'select', options: planOptions(plans, false), rules: [V.required('Plan')] },
              { name: 'seats', label: 'Licensed seats', type: 'number', rules: [V.required('Seats'), V.positiveInt('Seats')], half: true },
              { name: 'billing_cycle', label: 'Billing cycle', type: 'select', options: [{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }], half: true },
            ]}
            initial={{ plan: 'growth', seats: String(Math.max(open.row.seats_used, open.row.seats_total)), billing_cycle: 'monthly' }}
            action={(v) => convertCustomer({ ...v, id: open.row.id })}
            submitLabel="Convert to paid"
            onDone={close}
            onCancel={close}
            note={
              <p className="rounded-xl bg-brand-soft px-3.5 py-3 text-[12px] leading-relaxed text-brand-dark">
                Downgrading disables any module the new plan does not grant, deepest dependency first.
                Core modules always stay on.
              </p>
            }
          />
        </Modal>
      ) : null}

      {open?.kind === 'status' ? (
        <ConfirmModal
          title={open.to === 'suspended' ? `Suspend ${open.row.name}?` : `Reactivate ${open.row.name}?`}
          danger={open.to === 'suspended'}
          busy={busy}
          confirmLabel={open.to === 'suspended' ? 'Suspend account' : 'Reactivate'}
          onClose={close}
          onConfirm={() => runStatus(open.row, open.to)}
          body={
            open.to === 'suspended' ? (
              <>
                Everyone at <b>{open.row.name}</b> will be locked out at their next request. Their data
                is untouched and reactivating restores access immediately.
              </>
            ) : (
              <>
                <b>{open.row.name}</b> gets access back straight away, on their existing licence and
                modules.
              </>
            )
          }
        />
      ) : null}

      {open?.kind === 'delete' ? (
        <Modal title={`Delete ${open.row.name}`} sub="This cannot be undone." onClose={close}>
          <RecordForm
            fields={[
              {
                name: 'confirm_name',
                label: 'Type the company name to confirm',
                rules: [V.required('Confirmation')],
                placeholder: open.row.name,
              },
            ]}
            action={(v) => deleteCustomer({ ...v, id: open.row.id })}
            submitLabel="Delete permanently"
            onDone={close}
            onCancel={close}
            note={
              <div className="flex gap-2.5 rounded-xl bg-red-50 px-3.5 py-3 text-[12px] leading-relaxed text-red-700">
                <span className="mt-0.5 shrink-0">
                  <Icon name="alert" size={16} />
                </span>
                <span>
                  Deletes the organisation and everything cascading from it — employees, pay runs,
                  leave, documents and audit rows. A customer with invoices cannot be deleted; cancel
                  the account instead so the billing history survives.
                </span>
              </div>
            }
          />
        </Modal>
      ) : null}
    </>
  );
}
