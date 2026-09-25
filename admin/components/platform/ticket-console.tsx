'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { RecordForm, type FieldDef } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import { saveTicket, setTicketStatus, deleteTicket } from '@/app/actions/platform';

export type TicketRow = {
  id: string;
  ticket_no: string | null;
  subject: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  org_id: string | null;
  org_name: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  created_at: string;
  resolved_at: string | null;
};

/* The database constrains all three of these. Anything outside the lists below
   comes back as a CHECK violation, so the form offers exactly what is allowed. */
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
];
const CATEGORIES = [
  { value: 'technical', label: 'Technical' },
  { value: 'billing', label: 'Billing' },
  { value: 'feature_request', label: 'Feature request' },
];

const PRIORITY_CLASS: Record<string, string> = {
  high: 'bg-red-50 text-red-700',
  medium: 'bg-amber-bg text-amber-text',
  low: 'bg-slate-line2 text-slate-muted',
};
const STATUS_CLASS: Record<string, string> = {
  open: 'bg-brand-soft text-brand-dark',
  in_progress: 'bg-amber-bg text-amber-text',
  resolved: 'bg-leaf-soft text-leaf-text',
};

export function TicketConsole({
  rows,
  customers,
  staff,
  canWrite,
}: {
  rows: TicketRow[];
  customers: { id: string; name: string }[];
  staff: { id: string; full_name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{ kind: 'new' } | { kind: 'edit' | 'delete'; row: TicketRow } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const close = () => setOpen(null);

  const fields: FieldDef[] = [
    { name: 'subject', label: 'Subject', rules: [V.required('Subject'), V.maxLen(160)] },
    { name: 'org_id', label: 'Customer', type: 'select', options: customers.map((c) => ({ value: c.id, label: c.name })), hint: 'Leave blank for an internal ticket.', half: true },
    { name: 'category', label: 'Category', type: 'select', options: CATEGORIES, half: true },
    { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, rules: [V.required('Priority')], half: true },
    { name: 'status', label: 'Status', type: 'select', options: STATUSES, rules: [V.required('Status')], half: true },
    { name: 'assigned_to', label: 'Assigned to', type: 'select', options: staff.map((s) => ({ value: s.id, label: s.full_name })), half: true },
    { name: 'description', label: 'Detail', type: 'textarea' },
  ];

  async function advance(r: TicketRow, status: string) {
    setPending(r.id);
    const res = await setTicketStatus(r.id, status);
    setPending(null);
    toast(res.ok ? (res.message ?? 'Updated') : res.error, !res.ok);
    if (res.ok) router.refresh();
  }

  const columns: Column<TicketRow>[] = [
    {
      key: 'subject',
      header: 'Ticket',
      sortable: true,
      value: (r) => `${r.subject} ${r.org_name ?? ''} ${r.category}`,
      cell: (r) => (
        <span>
          <b className="block font-semibold text-ink">{r.subject}</b>
          <span className="text-[11px] text-slate-muted">
            {r.ticket_no ? `${r.ticket_no} · ` : ''}
            {r.org_name ?? 'Internal'} · {r.category.replace('_', ' ')}
          </span>
        </span>
      ),
    },
    { key: 'priority', header: 'Priority', sortable: true, value: (r) => r.priority, cell: (r) => <span className={`badge ${PRIORITY_CLASS[r.priority] ?? ''}`}>{r.priority}</span> },
    { key: 'status', header: 'Status', sortable: true, value: (r) => r.status, cell: (r) => <span className={`badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status.replace('_', ' ')}</span> },
    { key: 'assignee', header: 'Owner', sortable: true, hideBelow: 'md', value: (r) => r.assignee_name ?? '', cell: (r) => r.assignee_name ?? 'Unassigned' },
    { key: 'created', header: 'Raised', sortable: true, hideBelow: 'lg', value: (r) => r.created_at, cell: (r) => dateLabel(r.created_at) },
  ];

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        searchPlaceholder="Search tickets by subject, customer or category…"
        empty={{
          icon: 'lifebuoy',
          title: 'No tickets yet',
          body: 'Raise one here, or let them arrive from customers once the in-product helpdesk is wired to this queue.',
          action: canWrite ? (
            <button className="btn btn-primary" onClick={() => setOpen({ kind: 'new' })}>
              <Icon name="plus" size={16} />
              Raise Ticket
            </button>
          ) : undefined,
        }}
        toolbar={
          canWrite ? (
            <button className="btn btn-primary" onClick={() => setOpen({ kind: 'new' })}>
              <Icon name="plus" size={16} />
              Raise Ticket
            </button>
          ) : null
        }
        rowActions={(r) =>
          canWrite ? (
            <>
              <button className="btn btn-sm" onClick={() => setOpen({ kind: 'edit', row: r })}>
                Open
              </button>
              {r.status === 'open' ? (
                <button className="btn btn-sm" disabled={pending === r.id} onClick={() => advance(r, 'in_progress')}>
                  Start
                </button>
              ) : null}
              {r.status !== 'resolved' ? (
                <button className="btn btn-sm btn-primary" disabled={pending === r.id} onClick={() => advance(r, 'resolved')}>
                  Resolve
                </button>
              ) : (
                <button className="btn btn-sm" disabled={pending === r.id} onClick={() => advance(r, 'open')}>
                  Reopen
                </button>
              )}
              <button className="btn btn-sm btn-danger" onClick={() => setOpen({ kind: 'delete', row: r })}>
                Delete
              </button>
            </>
          ) : null
        }
      />

      {open?.kind === 'new' ? (
        <Modal title="Raise a ticket" wide onClose={close}>
          <RecordForm
            fields={fields}
            initial={{ priority: 'medium', status: 'open', category: 'technical' }}
            action={saveTicket}
            submitLabel="Raise ticket"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'edit' ? (
        <Modal title={open.row.subject} sub={`${open.row.org_name ?? 'Internal'} · raised ${dateLabel(open.row.created_at)}`} wide onClose={close}>
          <RecordForm
            fields={fields}
            initial={{
              subject: open.row.subject,
              org_id: open.row.org_id ?? '',
              category: open.row.category,
              priority: open.row.priority,
              status: open.row.status,
              assigned_to: open.row.assigned_to ?? '',
              description: open.row.description ?? '',
            }}
            action={(v) => saveTicket({ ...v, id: open.row.id })}
            submitLabel="Save ticket"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'delete' ? (
        <Modal title="Delete this ticket" sub={open.row.subject} onClose={close}>
          <RecordForm
            fields={[{ name: 'x', label: 'Type DELETE to confirm', rules: [V.required('Confirmation')], placeholder: 'DELETE' }]}
            action={(v) =>
              String(v.x).trim().toUpperCase() === 'DELETE'
                ? deleteTicket({ id: open.row.id })
                : Promise.resolve({ ok: false as const, error: 'Type DELETE exactly.', field: 'x' })
            }
            submitLabel="Delete ticket"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}
    </>
  );
}
