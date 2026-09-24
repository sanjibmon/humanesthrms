'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { Avatar } from '@/components/shell';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm, type FieldDef } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import {
  invitePlatformUser,
  updatePlatformUser,
  setPlatformUserActive,
  deletePlatformUser,
} from '@/app/actions/platform';

export type StaffRow = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  /** E.164. Mandatory for every new platform user. */
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

const ROLES = [
  { value: 'super_admin', label: 'Super Admin — everything, including staff and statutory rules' },
  { value: 'sales', label: 'Sales — customers and module enablement' },
  { value: 'finance', label: 'Finance — licences and revenue' },
  { value: 'support', label: 'Support — customer access and audit logs' },
];

const ROLE_SHORT: Record<string, string> = {
  super_admin: 'Super Admin',
  sales: 'Sales',
  finance: 'Finance',
  support: 'Support',
};

export function UserConsole({
  rows,
  canWrite,
  myId,
}: {
  rows: StaffRow[];
  canWrite: boolean;
  myId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<
    { kind: 'invite' } | { kind: 'edit' | 'delete' | 'toggle'; row: StaffRow } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  const inviteFields: FieldDef[] = [
    { name: 'full_name', label: 'Full name', rules: [V.required('Full name')] },
    { name: 'email', label: 'Work email', type: 'email', rules: [V.required('Email'), V.email], half: true },
    {
      name: 'phone',
      label: 'Contact number',
      rules: [V.required('Contact number'), V.phone],
      placeholder: '98765 43210',
      hint: 'Required. Staff who can suspend an account or touch a payroll run have to be reachable.',
      half: true,
    },
    { name: 'role', label: 'Role', type: 'select', options: ROLES, rules: [V.required('Role')] },
  ];

  const columns: Column<StaffRow>[] = [
    {
      key: 'name',
      header: 'Person',
      sortable: true,
      value: (r) => `${r.full_name} ${r.email}`,
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.full_name} slate={!r.is_active} />
          <span>
            <b className="block font-semibold text-ink">
              {r.full_name}
              {r.id === myId ? <span className="ml-1.5 text-[11px] font-normal text-slate-muted">you</span> : null}
            </b>
            <span className="block text-[11px] text-slate-muted">{r.email}</span>
            <span className="block text-[11px] text-slate-muted">
              {r.phone ?? <b className="font-semibold text-amber-text">no contact number</b>}
            </span>
          </span>
        </div>
      ),
    },
    { key: 'role', header: 'Role', sortable: true, value: (r) => r.role, cell: (r) => <span className="badge bg-brand-soft text-brand-dark">{ROLE_SHORT[r.role] ?? r.role}</span> },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      value: (r) => (r.is_active ? 'active' : 'inactive'),
      cell: (r) => (
        <span className={`badge ${r.is_active ? 'bg-leaf-soft text-leaf-text' : 'bg-slate-line2 text-slate-muted'}`}>
          {r.is_active ? 'active' : 'inactive'}
        </span>
      ),
    },
    { key: 'last', header: 'Last sign-in', sortable: true, hideBelow: 'md', value: (r) => r.last_login_at ?? '', cell: (r) => (r.last_login_at ? dateLabel(r.last_login_at) : 'Never') },
    { key: 'created', header: 'Added', sortable: true, hideBelow: 'lg', value: (r) => r.created_at, cell: (r) => dateLabel(r.created_at) },
  ];

  async function flip(r: StaffRow) {
    setBusy(true);
    const res = await setPlatformUserActive(r.id, !r.is_active);
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Updated') : res.error, !res.ok);
    if (res.ok) {
      close();
      router.refresh();
    }
  }

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        searchPlaceholder="Search staff by name or email…"
        empty={{
          icon: 'users',
          title: 'No platform staff yet',
          body: 'The first super admin is seeded directly in the database. Everyone after that is invited from here.',
          action: canWrite ? (
            <button className="btn btn-primary" onClick={() => setOpen({ kind: 'invite' })}>
              <Icon name="userplus" size={16} />
              Invite Staff
            </button>
          ) : undefined,
        }}
        toolbar={
          canWrite ? (
            <button className="btn btn-primary" onClick={() => setOpen({ kind: 'invite' })}>
              <Icon name="userplus" size={16} />
              Invite Staff
            </button>
          ) : null
        }
        rowActions={(r) =>
          canWrite ? (
            <>
              <button className="btn btn-sm" onClick={() => setOpen({ kind: 'edit', row: r })}>
                Edit
              </button>
              <button className="btn btn-sm" onClick={() => setOpen({ kind: 'toggle', row: r })} disabled={r.id === myId}>
                {r.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => setOpen({ kind: 'delete', row: r })} disabled={r.id === myId}>
                Delete
              </button>
            </>
          ) : null
        }
      />

      {open?.kind === 'invite' ? (
        <Modal title="Invite platform staff" sub="They get an email, set a password, then enrol an authenticator." onClose={close}>
          <RecordForm
            fields={inviteFields}
            initial={{ role: 'support' }}
            action={invitePlatformUser}
            submitLabel="Send invitation"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'edit' ? (
        <Modal title={`Edit ${open.row.full_name}`} sub={open.row.email} onClose={close}>
          <RecordForm
            fields={[
              { name: 'full_name', label: 'Full name', rules: [V.required('Full name')] },
              {
                name: 'phone',
                label: 'Contact number',
                rules: [V.required('Contact number'), V.phone],
                placeholder: '98765 43210',
                hint: 'Stored as +91… so it is ready for SMS and WhatsApp.',
              },
              { name: 'role', label: 'Role', type: 'select', options: ROLES, rules: [V.required('Role')] },
            ]}
            initial={{ full_name: open.row.full_name, phone: open.row.phone ?? '', role: open.row.role }}
            action={(v) => updatePlatformUser({ ...v, id: open.row.id })}
            submitLabel="Save changes"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'toggle' ? (
        <ConfirmModal
          title={open.row.is_active ? `Deactivate ${open.row.full_name}?` : `Reactivate ${open.row.full_name}?`}
          danger={open.row.is_active}
          busy={busy}
          confirmLabel={open.row.is_active ? 'Deactivate' : 'Reactivate'}
          onClose={close}
          onConfirm={() => flip(open.row)}
          body={
            open.row.is_active ? (
              <>
                Their sign-in stops working immediately and every permission check fails. The account
                and its audit history stay. The last active super admin cannot be deactivated.
              </>
            ) : (
              <>They can sign in again with the same role and the authenticator they already enrolled.</>
            )
          }
        />
      ) : null}

      {open?.kind === 'delete' ? (
        <Modal title={`Delete ${open.row.full_name}`} sub="Removes the platform role and the sign-in itself." onClose={close}>
          <RecordForm
            fields={[
              { name: 'confirm_email', label: 'Type their email to confirm', rules: [V.required('Confirmation')], placeholder: open.row.email },
            ]}
            action={(v) => deletePlatformUser({ ...v, id: open.row.id })}
            submitLabel="Delete permanently"
            onDone={close}
            onCancel={close}
            note={
              <div className="flex gap-2.5 rounded-xl bg-red-50 px-3.5 py-3 text-[12px] leading-relaxed text-red-700">
                <span className="mt-0.5 shrink-0">
                  <Icon name="alert" size={16} />
                </span>
                <span>
                  Deactivating is almost always the better choice — it stops access while keeping the
                  trail of what this person did. Deleting cannot be undone.
                </span>
              </div>
            }
          />
        </Modal>
      ) : null}
    </>
  );
}
