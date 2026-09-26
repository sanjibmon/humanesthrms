'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { Avatar } from '@/components/shell';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm, type FieldDef } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { dateLabel, inr } from '@/lib/format';
import * as V from '@/lib/validate';
import {
  toggleOrgModule,
  syncModulesToPlan,
  updateLicense,
  inviteOrgOwnerAction,
  setMemberEnabled,
  setOrgMemberRole,
  setOrgMemberEmployee,
  resendOrgMemberActivation,
  deleteOrgMember,
  setOrgMemberPhone,
} from '@/app/actions/customers';

export type ModuleRow = {
  code: string;
  name: string;
  description: string;
  is_core: boolean;
  is_beta: boolean;
  depends_on: string[];
  sort_order: number;
  enabled: boolean;
  in_plan: boolean;
};

export type MemberRow = {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  employee_name: string | null;
  /** Null for an orphaned membership whose sign-in was already deleted. */
  email: string | null;
  /** E.164. Mandatory for owner / hr_admin / payroll_admin. */
  phone: string | null;
  created_at: string;
  /** Set when this login is also an employee of the organisation. */
  employee_id: string | null;
  invited_at: string | null;
  /** When they set a password. Null means the invitation is still outstanding. */
  activated_at: string | null;
  last_sign_in_at: string | null;
};

/** A thin employee row, only enough to choose one in the link picker. */
export type EmployeeChoice = {
  id: string;
  employee_code: string;
  full_name: string;
  work_email: string | null;
  status: string;
  has_login: boolean;
};

export type LicenseInfo = {
  plan_code: string;
  seats_total: number;
  seats_used: number;
  billing_cycle: string;
  grace_days: number;
  block_over_allocation: boolean;
  custom_price_per_seat_paise: number | null;
  next_billing_at: string | null;
};

/** Roles the database requires a contact number for — mirrors app.require_phone. */
const ADMIN_ROLES = ['owner', 'hr_admin', 'payroll_admin'];

/** The same words the customer portal uses, so support and customer agree. */
const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  hr_admin: 'HR Admin',
  payroll_admin: 'Payroll Admin',
  finance_approver: 'Finance Approver',
  manager: 'Manager',
  recruiter: 'Recruiter',
  auditor: 'Auditor',
  employee: 'Employee',
};
const roleLabel = (r: string) => ROLE_LABELS[r] ?? r.replace(/_/g, ' ');

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'hr_admin', label: 'HR Admin' },
  { value: 'payroll_admin', label: 'Payroll Admin' },
  { value: 'finance_approver', label: 'Finance Approver' },
  { value: 'manager', label: 'Manager' },
  { value: 'recruiter', label: 'Recruiter' },
  { value: 'auditor', label: 'Auditor' },
];

export function ModulePanel({
  orgId,
  modules,
  canEdit,
  canSync,
}: {
  orgId: string;
  modules: ModuleRow[];
  canEdit: boolean;
  canSync: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function flip(m: ModuleRow) {
    if (!canEdit || m.is_core) return;
    setPending(m.code);
    const res = await toggleOrgModule(orgId, m.code, !m.enabled);
    setPending(null);
    toast(res.ok ? (res.message ?? 'Updated') : res.error, !res.ok);
    if (res.ok) router.refresh();
  }

  async function resync() {
    setPending('__sync');
    const res = await syncModulesToPlan(orgId);
    setPending(null);
    toast(res.ok ? (res.message ?? 'Synced') : res.error, !res.ok);
    if (res.ok) router.refresh();
  }

  return (
    <div className="card">
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm">Modules</h3>
          <p className="mt-0.5 text-xs text-slate-muted">
            {modules.filter((m) => m.enabled).length} of {modules.length} enabled. Dependencies are
            enforced by the database, so a module cannot be switched on before what it needs.
          </p>
        </div>
        {canSync ? (
          <button className="btn btn-sm" onClick={resync} disabled={pending !== null}>
            <Icon name="check" size={14} />
            Re-sync to plan
          </button>
        ) : null}
      </div>

      <div className="grid gap-2.5 md:grid-cols-2">
        {modules.map((m) => (
          <div
            key={m.code}
            className={`flex items-start gap-3 rounded-xl border p-3 transition ${
              m.enabled ? 'border-brand-soft bg-brand-softer' : 'border-slate-line bg-white'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <b className="text-[13px] text-ink">{m.name}</b>
                {m.is_core ? (
                  <span className="badge bg-amber-bg text-amber-text">
                    <Icon name="lock" size={10} />
                    Core
                  </span>
                ) : null}
                {m.is_beta ? <span className="badge bg-amber-bg text-amber-text">Beta</span> : null}
                {!m.in_plan ? <span className="badge">Outside plan</span> : null}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-muted">{m.description}</p>
              {m.depends_on?.length ? (
                <p className="mt-1 text-[10px] text-slate-faint">Needs {m.depends_on.join(', ')}</p>
              ) : null}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={m.enabled}
              aria-label={`${m.enabled ? 'Disable' : 'Enable'} ${m.name}`}
              data-on={m.enabled}
              className="switch mt-0.5 disabled:opacity-40"
              disabled={!canEdit || m.is_core || pending !== null}
              onClick={() => flip(m)}
            >
              <i />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LicensePanel({
  orgId,
  license,
  plans,
  canEdit,
}: {
  orgId: string;
  license: LicenseInfo | null;
  plans: { code: string; name: string; price_per_seat_paise: number; max_seats: number | null }[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!license) {
    return (
      <div className="card">
        <h3 className="mb-2 text-sm">Licence</h3>
        <p className="text-[13px] text-slate-muted">This organisation has no licence row yet.</p>
      </div>
    );
  }

  const plan = plans.find((p) => p.code === license.plan_code);
  const perSeat = license.custom_price_per_seat_paise ?? plan?.price_per_seat_paise ?? 0;
  const pct = license.seats_total ? Math.round((license.seats_used / license.seats_total) * 100) : 0;

  const fields: FieldDef[] = [
    { name: 'plan', label: 'Plan', type: 'select', options: plans.map((p) => ({ value: p.code, label: p.name })), rules: [V.required('Plan')], half: true },
    { name: 'seats_total', label: 'Licensed seats', type: 'number', rules: [V.required('Seats'), V.positiveInt('Seats')], half: true },
    { name: 'billing_cycle', label: 'Billing cycle', type: 'select', options: [{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }], half: true },
    { name: 'next_billing_at', label: 'Next billing date', type: 'date', half: true },
    { name: 'custom_price', label: 'Negotiated price per seat', type: 'number', rules: [V.nonNegative('Price')], hint: 'In rupees. Leave blank to use the plan price.', half: true },
    { name: 'grace_days', label: 'Grace days', type: 'number', rules: [V.nonNegative('Grace days')], half: true },
    { name: 'block_over_allocation', label: 'Block adding employees beyond the seat count', type: 'switch', hint: 'On by default. Turn off only for a customer you have agreed to let overrun.' },
  ];

  return (
    <div className="card">
      <div className="mb-3.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm">Licence</h3>
          <p className="mt-0.5 text-xs text-slate-muted">{plan?.name ?? license.plan_code}</p>
        </div>
        {canEdit ? (
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Edit licence
          </button>
        ) : null}
      </div>

      <div className="mb-3.5">
        <div className="mb-1.5 flex justify-between text-xs">
          <span className="text-slate-muted">Seats in use</span>
          <span className="font-semibold tabular-nums text-ink">
            {license.seats_used}/{license.seats_total} · {pct}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-line">
          <i
            className={`block h-full rounded-full ${pct > 90 ? 'bg-red-500' : 'bg-brand-grad-wide'}`}
            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
          />
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2 text-[13px]">
        <dt className="text-xs text-slate-muted">Price per seat</dt>
        <dd className="font-medium tabular-nums text-ink">
          {inr(perSeat / 100)}
          {license.custom_price_per_seat_paise !== null ? (
            <span className="ml-1.5 text-[11px] text-amber-text">negotiated</span>
          ) : null}
        </dd>
        <dt className="text-xs text-slate-muted">Billing</dt>
        <dd className="font-medium text-ink">{license.billing_cycle}</dd>
        <dt className="text-xs text-slate-muted">Next billing</dt>
        <dd className="font-medium text-ink">{dateLabel(license.next_billing_at)}</dd>
        <dt className="text-xs text-slate-muted">Over-allocation</dt>
        <dd className="font-medium text-ink">
          {license.block_over_allocation ? 'Blocked at the seat limit' : 'Allowed to overrun'}
        </dd>
      </dl>

      {open ? (
        <Modal title="Edit licence" sub="Seat limits are enforced by a database trigger, not just here." onClose={() => setOpen(false)}>
          <RecordForm
            fields={fields}
            initial={{
              plan: license.plan_code,
              seats_total: String(license.seats_total),
              billing_cycle: license.billing_cycle,
              next_billing_at: license.next_billing_at ?? '',
              custom_price:
                license.custom_price_per_seat_paise === null
                  ? ''
                  : String(license.custom_price_per_seat_paise / 100),
              grace_days: String(license.grace_days),
              block_over_allocation: license.block_over_allocation,
            }}
            action={(v) => updateLicense({ ...v, org_id: orgId })}
            submitLabel="Save licence"
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </Modal>
      ) : null}
    </div>
  );
}

export function MemberPanel({
  orgId,
  members,
  employees,
  canEdit,
}: {
  orgId: string;
  members: MemberRow[];
  employees: EmployeeChoice[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [invite, setInvite] = useState(false);
  const [target, setTarget] = useState<MemberRow | null>(null);
  const [doomed, setDoomed] = useState<MemberRow | null>(null);
  const [editPhone, setEditPhone] = useState<MemberRow | null>(null);
  const [editRole, setEditRole] = useState<MemberRow | null>(null);
  const [linking, setLinking] = useState<MemberRow | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Updated') : (res.error ?? 'Failed'), !res.ok);
    if (res.ok) router.refresh();
    return res.ok;
  }

  async function flip(m: MemberRow) {
    if (await run(() => setMemberEnabled(m.id, !m.is_active))) setTarget(null);
  }

  async function purge(m: MemberRow) {
    if (await run(() => deleteOrgMember(m.id, orgId))) {
      setDoomed(null);
      setTyped('');
    }
  }

  /* What has to be typed before the delete button unlocks. Orphaned rows have
     no address left to type, so they fall back to the word itself. */
  const phrase = doomed?.email ?? 'DELETE';
  const armed = typed.trim().toLowerCase() === phrase.toLowerCase();

  /* Two populations, two questions. Of an employer login you ask what it may
     do; of an employee login you ask whether the person ever activated it.
     Somebody who is both appears once, under employer, with a badge -- they are
     one login with two portals, not two accounts. */
  const employerLogins = members.filter((m) => m.role !== 'employee');
  const employeeLogins = members.filter((m) => m.role === 'employee');

  function row(m: MemberRow) {
    const dual = m.role !== 'employee' && Boolean(m.employee_id);
    const activated = Boolean(m.activated_at);
    const stamp = activated
      ? `active since ${dateLabel(m.activated_at as string)}`
      : `invited ${dateLabel(m.invited_at ?? m.created_at)}`;

    return (
      <div key={m.id} className="flex flex-wrap items-center gap-2 py-2.5">
        <Avatar name={m.employee_name ?? m.email ?? m.role} slate={!m.is_active} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13px] font-semibold text-ink">
            {m.employee_name ?? m.email ?? 'Invited user'}
          </b>
          <span className="block truncate text-[11px] text-slate-muted">
            {roleLabel(m.role)}
            {m.employee_name && m.email ? ` · ${m.email}` : ''}
            {m.phone ? ` · ${m.phone}` : ''} · {stamp}
          </span>
        </div>

        {dual ? (
          <span
            className="badge"
            title="Holds an employer role and is also on the payroll. One login: the employer portal and self service, with a view switch in the header."
          >
            employer + employee
          </span>
        ) : null}
        {activated || !m.email ? null : <span className="badge">never activated</span>}
        {m.is_active ? null : <span className="badge">disabled</span>}
        {m.email ? null : <span className="badge">no sign-in</span>}
        {m.phone || !ADMIN_ROLES.includes(m.role) ? null : (
          <span className="badge">no contact number</span>
        )}

        {canEdit ? (
          <>
            <button className="btn btn-sm" onClick={() => setEditRole(m)} disabled={busy}>
              Role
            </button>
            <button className="btn btn-sm" onClick={() => setEditPhone(m)} disabled={busy}>
              {m.phone ? 'Number' : 'Add number'}
            </button>
            {m.role === 'employee' ? null : (
              <button className="btn btn-sm" onClick={() => setLinking(m)} disabled={busy}>
                {m.employee_id ? 'Employee record' : 'Link employee'}
              </button>
            )}
            <button
              className="btn btn-sm"
              disabled={busy || !m.email || !m.is_active}
              title={!m.email ? 'No sign-in behind this row.' : m.is_active ? undefined : 'Enable the login first.'}
              onClick={() => run(() => resendOrgMemberActivation(m.id, orgId))}
            >
              Resend link
            </button>
            <button className="btn btn-sm" onClick={() => setTarget(m)} disabled={busy}>
              {m.is_active ? 'Disable' : 'Enable'}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                setTyped('');
                setDoomed(m);
              }}
              disabled={busy}
            >
              Delete
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-3.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm">Portal access</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
            Who can sign in to this organisation&rsquo;s portal, and as what. Everyone is forced
            through authenticator enrolment on first sign-in.
          </p>
        </div>
        {canEdit ? (
          <button className="btn btn-sm btn-primary" onClick={() => setInvite(true)}>
            <Icon name="userplus" size={14} />
            Invite
          </button>
        ) : null}
      </div>

      {members.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-6 text-center text-[13px] text-slate-muted">
          Nobody can sign in yet. Invite the owner to start them off.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <section>
            <div className="mb-1 flex items-baseline gap-2">
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-slate-muted">
                Employer logins
              </h4>
              <span className="text-[11px] text-slate-faint">{employerLogins.length}</span>
            </div>
            {employerLogins.length === 0 ? (
              <p className="py-2 text-[13px] text-slate-muted">
                Nobody administers this organisation yet.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-line2">
                {employerLogins.map(row)}
              </div>
            )}
          </section>

          <section>
            <div className="mb-1 flex items-baseline gap-2">
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-slate-muted">
                Employee logins
              </h4>
              <span className="text-[11px] text-slate-faint">{employeeLogins.length}</span>
            </div>
            <p className="mb-1 text-[11px] leading-relaxed text-slate-muted">
              Self service only. Their own payslips, leave and attendance — row level security keeps
              them to their own records, not the menu.
            </p>
            {employeeLogins.length === 0 ? (
              <p className="py-2 text-[13px] text-slate-muted">
                No employee has been invited to self service yet. Their HR admin does that from the
                Employees page in their own portal.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-line2">
                {employeeLogins.map(row)}
              </div>
            )}
          </section>
        </div>
      )}

      {invite ? (
        <Modal title="Invite someone to this portal" sub="They receive an email to set a password." onClose={() => setInvite(false)}>
          <RecordForm
            fields={[
              { name: 'email', label: 'Email', type: 'email', rules: [V.required('Email'), V.email] },
              { name: 'role', label: 'Role', type: 'select', options: ROLE_OPTIONS, rules: [V.required('Role')] },
              {
                name: 'phone',
                label: 'Contact number',
                rules: [V.required('Contact number'), V.phone],
                placeholder: '98765 43210',
                hint: 'Required for an owner, HR admin or payroll admin.',
              },
            ]}
            initial={{ role: 'owner' }}
            action={(v) => inviteOrgOwnerAction({ ...v, org_id: orgId })}
            submitLabel="Send invitation"
            onDone={() => setInvite(false)}
            onCancel={() => setInvite(false)}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-slate-muted">
            If this person is also on the payroll, nothing more is needed: when their employee
            record carries the same email address, the two are joined automatically and they get
            self service alongside their employer access.
          </p>
        </Modal>
      ) : null}

      {editRole ? (
        <Modal
          title="Change role"
          sub={editRole.employee_name ?? editRole.email ?? undefined}
          onClose={() => setEditRole(null)}
        >
          <RecordForm
            fields={[
              {
                name: 'role',
                label: 'Role',
                type: 'select',
                options: [...ROLE_OPTIONS, { value: 'employee', label: 'Employee (self service only)' }],
                rules: [V.required('Role')],
                hint: 'An owner, HR admin or payroll admin must have a contact number on file. Employee needs an employee record linked to the login.',
              },
            ]}
            initial={{ role: editRole.role }}
            action={(v) => setOrgMemberRole({ ...v, id: editRole.id, org_id: orgId })}
            submitLabel="Save role"
            onDone={() => setEditRole(null)}
            onCancel={() => setEditRole(null)}
          />
        </Modal>
      ) : null}

      {linking ? (
        <Modal
          title={linking.employee_id ? 'Employee record' : 'Link an employee record'}
          sub={linking.employee_name ?? linking.email ?? undefined}
          onClose={() => setLinking(null)}
        >
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-slate-body">
              A login and an employee record are two different things. The login decides what
              somebody may do in the employer portal; the employee record is what self service
              reads — payslips, leave balance, attendance. Joining them is what lets one person be
              both, with a view switch in their portal header.
            </p>
            <p className="text-[12px] leading-relaxed text-slate-muted">
              This happens automatically when the employee record carries the same email address as
              the login. Use this when the two addresses differ.
            </p>
            <RecordForm
              fields={[
                {
                  name: 'employee_id',
                  label: 'Employee record',
                  type: 'select',
                  options: [
                    { value: '', label: linking.employee_id ? '— unlink —' : '— none —' },
                    ...employees
                      .filter((e) => !e.has_login || e.id === linking.employee_id)
                      .map((e) => ({
                        value: e.id,
                        label: `${e.full_name} · ${e.employee_code}${e.work_email ? ` · ${e.work_email}` : ''}`,
                      })),
                  ],
                  hint: 'Only employees with no login of their own are listed — one record, one login.',
                },
              ]}
              initial={{ employee_id: linking.employee_id ?? '' }}
              action={(v) =>
                setOrgMemberEmployee(linking.id, String(v.employee_id ?? '') || null, orgId)
              }
              submitLabel="Save"
              onDone={() => setLinking(null)}
              onCancel={() => setLinking(null)}
            />
          </div>
        </Modal>
      ) : null}

      {target ? (
        <ConfirmModal
          title={target.is_active ? 'Disable this login?' : 'Enable this login?'}
          danger={target.is_active}
          busy={busy}
          confirmLabel={target.is_active ? 'Disable' : 'Enable'}
          onClose={() => setTarget(null)}
          onConfirm={() => flip(target)}
          body={
            target.is_active ? (
              <>
                They lose access at their next request. Nothing is deleted — the membership, the
                history and the authenticator all stay, and enabling it again restores everything.
                An organisation must keep at least one active owner, so the database refuses if this
                is the last one.
              </>
            ) : (
              <>They get access back immediately, with the same role and the same authenticator.</>
            )
          }
        />
      ) : null}

      {editPhone ? (
        <Modal
          title={editPhone.phone ? 'Change the contact number' : 'Add a contact number'}
          sub={editPhone.email ?? editPhone.employee_name ?? undefined}
          onClose={() => setEditPhone(null)}
        >
          <RecordForm
            fields={[
              {
                name: 'phone',
                label: 'Contact number',
                rules: [V.required('Contact number'), V.phone],
                placeholder: '98765 43210',
                hint: 'Stored as +91… so it is ready for SMS and WhatsApp.',
              },
            ]}
            initial={{ phone: editPhone.phone ?? '' }}
            action={(v) => setOrgMemberPhone({ ...v, id: editPhone.id, org_id: orgId })}
            submitLabel="Save number"
            onDone={() => setEditPhone(null)}
            onCancel={() => setEditPhone(null)}
          />
        </Modal>
      ) : null}

      {doomed ? (
        <ConfirmModal
          title="Delete this account permanently?"
          danger
          /* ConfirmModal disables its action button while `busy`, which is also
             how the typed confirmation gates it. */
          busy={busy || !armed}
          confirmLabel={busy ? 'Deleting…' : 'Delete permanently'}
          onClose={() => {
            setDoomed(null);
            setTyped('');
          }}
          onConfirm={() => purge(doomed)}
          body={
            <div className="flex flex-col gap-3">
              <p>
                This erases <b>{doomed.email ?? doomed.employee_name ?? 'this membership'}</b> from
                the database — their membership of this organisation, their notifications, their
                trusted devices
                {doomed.email ? ', their sign-in, and their authenticator enrolment' : ''}. It
                cannot be undone and there is no recycle bin.
              </p>
              {doomed.email ? (
                <p className="text-slate-muted">
                  Their employee record, payroll history and the security audit trail are kept —
                  those belong to the organisation, not to the login. The address becomes free to
                  invite again.
                </p>
              ) : (
                <p className="text-slate-muted">
                  This membership already has no sign-in behind it, so only the leftover row goes.
                </p>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold text-ink">
                  Type <code className="rounded bg-slate-line2 px-1.5 py-0.5">{phrase}</code> to
                  confirm
                </span>
                <input
                  type="text"
                  value={typed}
                  onChange={(e: { target: { value: string } }) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={phrase}
                />
              </label>
            </div>
          }
        />
      ) : null}
    </div>
  );
}
