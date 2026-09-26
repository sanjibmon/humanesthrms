'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, ConfirmModal } from '@/components/ui/modal';
import { RecordForm, type FieldDef, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { Icon } from '@/components/icon';
import { dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import { STATES } from '@/components/employees/employee-console';
import {
  saveOrgPolicy,
  saveCompanyProfile,
  saveLegalEntity,
  saveLocation,
  saveLeaveType,
  saveHoliday,
  deleteHoliday,
  saveShift,
  setMemberRole,
  setMemberEnabled,
  setMemberPhone,
  resendActivation,
  setRolePermission,
  revokeTrustedDevice,
} from '@/app/actions/settings';

export type Org = {
  id: string;
  name: string;
  legal_name: string | null;
  industry: string | null;
  pan: string | null;
  tan: string | null;
  gstin: string | null;
  timezone: string;
  status: string;
};

export type Policy = {
  weekly_offs: number[] | null;
  leave_year_start_month: number;
  default_probation_days: number;
  selfie_mandatory: boolean;
  geofence_mandatory: boolean;
  allow_wfh: boolean;
  reject_mock_location: boolean;
  ip_restriction: boolean;
  wage_definition: string;
  esi_includes_overtime: boolean;
  payroll_day_basis: string;
  payroll_maker_checker: boolean;
  pf_on_actual_default: boolean;
} | null;

export type Row = Record<string, any>;

export type Caps = {
  settings: boolean;
  leave: boolean;
  attendance: boolean;
  members: boolean;
  audit: boolean;
};

const TABS = ['Company', 'Policy', 'Leave & holidays', 'Shifts', 'People & roles', 'Security'] as const;
type Tab = (typeof TABS)[number];

const DAYS = [
  ['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'],
  ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'],
];

const ROLE_WORDS: Record<string, string> = {
  owner: 'Owner',
  hr_admin: 'HR Admin',
  payroll_admin: 'Payroll Admin',
  finance_approver: 'Finance Approver',
  manager: 'Manager',
  recruiter: 'Recruiter',
  auditor: 'Auditor',
  employee: 'Employee',
};

const ROLES = ['owner', 'hr_admin', 'payroll_admin', 'finance_approver', 'manager', 'recruiter', 'auditor', 'employee'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((m, i) => ({ value: String(i + 1), label: m }));

export function SettingsConsole({
  org,
  policy,
  entities,
  locations,
  leaveTypes,
  holidays,
  shifts,
  members,
  rolePermissions,
  permissionCodes,
  devices,
  events,
  caps,
}: {
  org: Org | null;
  policy: Policy;
  entities: Row[];
  locations: Row[];
  leaveTypes: Row[];
  holidays: Row[];
  shifts: Row[];
  members: Row[];
  rolePermissions: { role: string; permission: string }[];
  permissionCodes: string[];
  devices: Row[];
  events: Row[];
  caps: Caps;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Company');
  const [open, setOpen] = useState<{ kind: string; row?: Row } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    toast(res.ok ? (res.message ?? 'Saved') : (res.error ?? 'Failed'), !res.ok);
    if (res.ok) router.refresh();
  }

  /* Two lists, because they are two different populations with two different
     questions attached. For an employer login you ask what it may do; for an
     employee login you ask whether the person ever managed to activate it.
     Somebody can hold both -- an owner who is also on the payroll -- and that
     login appears once, under Employer, carrying a badge rather than being
     duplicated into a list where the actions would not apply. */
  const employerLogins = members.filter((m) => m.role !== 'employee');
  const employeeLogins = members.filter((m) => m.role === 'employee');

  function loginRow(m: Row) {
    const dual = m.role !== 'employee' && Boolean(m.employee_id);
    const activated = Boolean(m.activated_at);
    const name = m.employee_name ?? m.email ?? 'Invited user';
    const bits = [ROLE_WORDS[m.role] ?? m.role.replace(/_/g, ' ')];
    if (m.employee_code) bits.push(m.employee_code);
    if (m.phone) bits.push(m.phone);
    bits.push(activated ? `active since ${dateLabel(m.activated_at)}` : `invited ${dateLabel(m.invited_at ?? m.created_at)}`);

    return (
      <div key={m.id} className="flex flex-wrap items-center gap-2.5 py-2.5">
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13px] font-semibold text-ink">
            {name}
            {m.is_self ? <span className="ml-1.5 text-[11px] font-normal text-slate-muted">(you)</span> : null}
          </b>
          <span className="block truncate text-[11px] text-slate-muted">
            {m.email ? `${m.email} · ` : ''}
            {bits.join(' · ')}
          </span>
        </div>

        {dual ? (
          <span className="badge" title="Holds an employer role and is also on the payroll. One password, two portals — the view switch in the header moves between them.">
            employer + employee
          </span>
        ) : null}
        {activated ? null : <span className="badge">never activated</span>}
        {m.is_active ? null : <span className="badge">disabled</span>}

        {caps.members ? (
          <>
            <button className="btn btn-sm" disabled={m.is_self} title={m.is_self ? 'Nobody changes their own role.' : undefined}
                    onClick={() => setOpen({ kind: 'role', row: m })}>
              Role
            </button>
            <button className="btn btn-sm" onClick={() => setOpen({ kind: 'member-phone', row: m })}>
              {m.phone ? 'Phone' : 'Add phone'}
            </button>
            <button className="btn btn-sm" disabled={busy || !m.is_active}
                    title={m.is_active ? undefined : 'Enable the login first.'}
                    onClick={() => run(() => resendActivation(m.id))}>
              Resend link
            </button>
            <button className="btn btn-sm" disabled={busy || m.is_self}
                    title={m.is_self ? 'You cannot disable your own login.' : undefined}
                    onClick={() => run(() => setMemberEnabled({ id: m.id, enabled: !m.is_active }))}>
              {m.is_active ? 'Disable' : 'Enable'}
            </button>
          </>
        ) : null}
      </div>
    );
  }

  const granted = new Set(rolePermissions.map((p) => `${p.role}|${p.permission}`));
  const offs = new Set(policy?.weekly_offs ?? [0]);

  return (
    <>
      <div className="tabbar mb-5">
        {TABS.map((t) => (
          <button
            key={t}
            className={`nav-item ${tab === t ? 'bg-brand-soft font-semibold text-brand-dark' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------ company */}
      {tab === 'Company' ? (
        <div className="flex flex-col gap-4">
          <Card
            title="Company details"
            note="Your commercial status, plan and seat count are set by HumaNest and cannot be edited here."
            action={caps.settings ? { label: 'Edit', onClick: () => setOpen({ kind: 'org' }) } : undefined}
            rows={[
              ['Name', org?.name],
              ['Registered legal name', org?.legal_name],
              ['Industry', org?.industry],
              ['PAN', org?.pan],
              ['TAN', org?.tan],
              ['GSTIN', org?.gstin],
              ['Timezone', org?.timezone],
              ['Account status', org?.status],
            ]}
          />

          <ListCard
            title="Legal entities"
            note="The entity an employee is filed under decides which PF and TAN codes their returns carry."
            empty="No entity yet. Most organisations need at least one before running payroll."
            action={caps.settings ? { label: 'Add entity', onClick: () => setOpen({ kind: 'entity' }) } : undefined}
            rows={entities.map((e) => ({
              id: e.id,
              title: e.name + (e.is_default ? ' · default' : ''),
              sub: [e.state_code, e.pan, e.pf_code ? `PF ${e.pf_code}` : null, e.esi_code ? `ESI ${e.esi_code}` : null]
                .filter(Boolean)
                .join(' · '),
              onEdit: caps.settings ? () => setOpen({ kind: 'entity', row: e }) : undefined,
            }))}
          />

          <ListCard
            title="Work locations"
            note="The state on a location drives professional tax and the labour welfare fund."
            empty="No locations yet."
            action={caps.settings ? { label: 'Add location', onClick: () => setOpen({ kind: 'location' }) } : undefined}
            rows={locations.map((l) => ({
              id: l.id,
              title: l.name + (l.is_active ? '' : ' · inactive'),
              sub: [l.city, l.state_code, `${l.geofence_radius_m}m geofence`].filter(Boolean).join(' · '),
              onEdit: caps.settings ? () => setOpen({ kind: 'location', row: l }) : undefined,
            }))}
          />
        </div>
      ) : null}

      {/* ------------------------------------------------------------- policy */}
      {tab === 'Policy' ? (
        <div className="card">
          <div className="mb-3.5 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">Working and payroll policy</h3>
              <p className="mt-0.5 text-xs text-slate-muted">
                These are read by the attendance engine and the payroll calculation, so a change
                here affects how days are counted from now on.
              </p>
            </div>
            {caps.settings ? (
              <button className="btn btn-sm btn-primary" onClick={() => setOpen({ kind: 'policy' })}>
                Edit policy
              </button>
            ) : null}
          </div>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item label="Weekly offs" value={DAYS.filter((_, i) => offs.has(i)).map((d) => d[1]).join(', ') || 'None'} />
            <Item label="Leave year starts" value={MONTHS[(policy?.leave_year_start_month ?? 4) - 1]?.label ?? '—'} />
            <Item
              label="Default probation"
              value={`${policy?.default_probation_days ?? 180} days`}
            />
            <Item label="Selfie on check-in" value={policy?.selfie_mandatory ? 'Required' : 'Not required'} />
            <Item label="Geofence" value={policy?.geofence_mandatory ? 'Enforced' : 'Not enforced'} />
            <Item label="Mock location" value={policy?.reject_mock_location ? 'Rejected' : 'Allowed'} />
            <Item label="Work from home" value={policy?.allow_wfh ? 'Allowed' : 'Not allowed'} />
            <Item label="IP restriction" value={policy?.ip_restriction ? 'On' : 'Off'} />
            <Item
              label="Wage definition"
              value={policy?.wage_definition === 'legacy_basic_da' ? 'Legacy basic + DA' : 'Labour codes'}
            />
            <Item
              label="Payroll day basis"
              value={
                policy?.payroll_day_basis === '26' ? '26 days' : policy?.payroll_day_basis === '30' ? '30 days' : 'Calendar days'
              }
            />
            <Item label="ESI includes overtime" value={policy?.esi_includes_overtime ? 'Yes' : 'No'} />
            <Item label="Maker–checker on payroll" value={policy?.payroll_maker_checker ? 'On' : 'Off'} />
            <Item label="PF on actual by default" value={policy?.pf_on_actual_default ? 'Yes' : 'Capped at the ceiling'} />
          </dl>
        </div>
      ) : null}

      {/* -------------------------------------------------- leave & holidays */}
      {tab === 'Leave & holidays' ? (
        <div className="flex flex-col gap-4">
          <ListCard
            title="Leave types"
            note="Nobody can apply for leave until at least one type exists. Probation, document thresholds and the approval depth are all set per type."
            empty="No leave types yet. Casual, sick and earned leave are the usual starting three."
            action={caps.leave ? { label: 'Add leave type', onClick: () => setOpen({ kind: 'leavetype' }) } : undefined}
            rows={leaveTypes.map((t) => ({
              id: t.id,
              title: `${t.name} (${t.code})${t.is_active ? '' : ' · inactive'}`,
              sub: [
                t.is_paid ? 'paid' : 'unpaid',
                t.days_per_year ? `${t.days_per_year} days a year` : null,
                t.half_day_allowed ? 'half days allowed' : null,
                t.probation_days ? `after ${t.probation_days} days of service` : null,
                `${t.approval_levels} approval level(s)`,
              ]
                .filter(Boolean)
                .join(' · '),
              onEdit: caps.leave ? () => setOpen({ kind: 'leavetype', row: t }) : undefined,
            }))}
          />

          <ListCard
            title="Holiday calendar"
            note="A holiday is excluded from the leave day count, so nobody spends leave on one."
            empty="No holidays added for this year."
            action={caps.leave ? { label: 'Add holiday', onClick: () => setOpen({ kind: 'holiday' }) } : undefined}
            rows={holidays.map((h) => ({
              id: h.id,
              title: h.name,
              sub: `${dateLabel(h.holiday_date)}${h.is_optional ? ' · optional' : ''}`,
              onDelete: caps.leave ? () => run(() => deleteHoliday(h.id)) : undefined,
            }))}
          />
        </div>
      ) : null}

      {/* ------------------------------------------------------------- shifts */}
      {tab === 'Shifts' ? (
        <ListCard
          title="Shifts"
          note="A shift sets the expected hours, the grace period before a day counts as late, and the minutes that make a half or full day."
          empty="No shifts yet. Without one, attendance cannot judge late arrivals or half days."
          action={caps.attendance ? { label: 'Add shift', onClick: () => setOpen({ kind: 'shift' }) } : undefined}
          rows={shifts.map((s) => ({
            id: s.id,
            title: `${s.name}${s.is_default ? ' · default' : ''}`,
            sub: `${s.start_time} to ${s.end_time} · ${s.grace_minutes}m grace · half day at ${s.half_day_minutes}m · full at ${s.full_day_minutes}m`,
            onEdit: caps.attendance ? () => setOpen({ kind: 'shift', row: s }) : undefined,
          }))}
        />
      ) : null}

      {/* -------------------------------------------------- people and roles */}
      {tab === 'People & roles' ? (
        <div className="flex flex-col gap-4">
          <LoginList
            title="Employer logins"
            note="People who administer the company: the owner, HR, payroll, finance, managers. Everybody here is forced through authenticator enrolment on first sign-in."
            empty="Nobody yet."
            rows={employerLogins}
            render={loginRow}
          />

          <LoginList
            title="Employee logins"
            note="Self service only. Each of these is tied to an employee record, and row level security keeps them to their own data — the menu is not what stops them."
            empty="No employee has been invited to self service yet. Invite them from the Employees page."
            rows={employeeLogins}
            render={loginRow}
          />

          <div className="card">
            <h3 className="mb-1 text-sm">What each role can do</h3>
            <p className="mb-3 text-xs leading-relaxed text-slate-muted">
              These are the grants the database itself reads on every request. The owner row is
              fixed — it holds everything — and changing any other row takes effect immediately.
              {caps.members ? '' : ' You can see this but not change it.'}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-slate-surface text-left text-[11px] uppercase tracking-wide text-slate-muted">
                    <th className="sticky left-0 z-10 bg-slate-surface p-2 font-semibold">Permission</th>
                    {ROLES.map((r) => (
                      <th key={r} className="p-2 text-center font-semibold">
                        {r.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permissionCodes.map((perm) => (
                    <tr key={perm} className="border-b border-slate-line2 last:border-0">
                      <td className="sticky left-0 z-10 bg-white p-2 font-mono text-[11px] text-slate-body">
                        {perm}
                      </td>
                      {ROLES.map((role) => {
                        const on = role === 'owner' || granted.has(`${role}|${perm}`);
                        const locked = role === 'owner' || !caps.members;
                        return (
                          <td key={role} className="p-2 text-center">
                            <button
                              className={`h-5 w-5 rounded-md border transition ${
                                on
                                  ? 'border-brand bg-brand-soft text-brand-dark'
                                  : 'border-slate-line bg-white text-slate-faint'
                              } ${locked ? 'cursor-not-allowed opacity-60' : 'hover:border-brand'}`}
                              disabled={locked || busy}
                              aria-label={`${on ? 'Revoke' : 'Grant'} ${perm} for ${role}`}
                              onClick={() => run(() => setRolePermission(role, perm, !on))}
                            >
                              {on ? '✓' : ''}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* ----------------------------------------------------------- security */}
      {tab === 'Security' ? (
        <div className="flex flex-col gap-4">
          <ListCard
            title="My trusted devices"
            note="Devices that have completed the authenticator step for this account. Revoking one forces a fresh challenge."
            empty="No device has been remembered yet."
            rows={devices.map((d) => ({
              id: d.id,
              title: d.label ?? 'Unnamed device',
              sub: `first seen ${dateLabel(d.first_seen)} · last used ${dateLabel(d.last_seen)}${
                d.revoked_at ? ` · revoked ${dateLabel(d.revoked_at)}` : ''
              }`,
              onDelete: d.revoked_at ? undefined : () => run(() => revokeTrustedDevice(d.id)),
              deleteLabel: 'Revoke',
            }))}
          />

          <div className="card">
            <h3 className="mb-1 text-sm">Security events</h3>
            <p className="mb-3 text-xs leading-relaxed text-slate-muted">
              {caps.audit
                ? 'Sign-ins, authenticator changes and permission failures across the organisation.'
                : 'Your own sign-ins and authenticator changes. The full organisation view needs the audit permission.'}
            </p>
            {events.length === 0 ? (
              <p className="text-[13px] text-slate-muted">Nothing recorded yet.</p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-line2">
                {events.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="badge">{e.event_type.replace(/[._]/g, ' ')}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-slate-muted">
                      {e.ip ?? ''} {e.user_agent ? `· ${String(e.user_agent).slice(0, 60)}` : ''}
                    </span>
                    <span className="text-[11px] text-slate-faint">{dateLabel(e.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="mb-1 text-sm">What is enforced regardless of settings</h3>
            <ul className="mt-2 flex flex-col gap-2 text-[13px] leading-relaxed text-slate-body">
              <li>
                <b className="text-ink">Multi-factor is mandatory.</b> Every account enrols an
                authenticator on first sign-in, and no protected page loads without it.
              </li>
              <li>
                <b className="text-ink">Row level security on every table.</b> A colleague cannot read
                another employee&rsquo;s record even by guessing an address — the database refuses,
                not the screen.
              </li>
              <li>
                <b className="text-ink">PAN and bank accounts are encrypted at rest</b>, with only the
                last four digits readable, and every reveal is written to a hash-chained audit log.
              </li>
              <li>
                <b className="text-ink">Aadhaar is stored as the last four digits only</b>, which is
                data minimisation under the DPDP Act rather than a setting to turn on.
              </li>
            </ul>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------- modals */}
      {open?.kind === 'org' ? (
        <Modal title="Company details" wide onClose={close}>
          <RecordForm
            fields={[
              { name: 'name', label: 'Company name', rules: [V.required('Name')] },
              { name: 'legal_name', label: 'Registered legal name' },
              { name: 'industry', label: 'Industry', half: true },
              { name: 'timezone', label: 'Timezone', half: true },
              { name: 'pan', label: 'PAN', transform: 'upper', rules: [V.pan], half: true },
              { name: 'tan', label: 'TAN', transform: 'upper', rules: [V.tan], half: true },
              { name: 'gstin', label: 'GSTIN', transform: 'upper', rules: [V.gstin] },
            ]}
            initial={{
              name: org?.name ?? '',
              legal_name: org?.legal_name ?? '',
              industry: org?.industry ?? '',
              timezone: org?.timezone ?? 'Asia/Kolkata',
              pan: org?.pan ?? '',
              tan: org?.tan ?? '',
              gstin: org?.gstin ?? '',
            }}
            action={saveCompanyProfile}
            submitLabel="Save"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'policy' ? (
        <Modal title="Working and payroll policy" wide onClose={close}>
          <RecordForm
            fields={[
              ...DAYS.map(([k, label], i) => ({
                name: `off_${k}`,
                label: `${label} is a weekly off`,
                type: 'switch' as const,
                step: 'Working week',
              })),
              {
                name: 'leave_year_start_month',
                label: 'Leave year starts in',
                type: 'select',
                options: MONTHS,
                step: 'Working week',
                hint: 'April matches the Indian financial year, which is what most balances are reckoned against.',
              },
              {
                name: 'default_probation_days',
                label: 'Default probation period, in days',
                type: 'number',
                step: 'Working week',
                rules: [V.required('Probation period'), V.positiveInt('Probation period')],
                hint: '180 days is the usual Indian default. It only prefills the field when HR adds somebody — each employee can be given a different period, and confirmation to permanent happens automatically on the day it ends.',
              },

              { name: 'selfie_mandatory', label: 'Selfie required on check-in', type: 'switch', step: 'Attendance' },
              { name: 'geofence_mandatory', label: 'Check-in must be inside a location geofence', type: 'switch', step: 'Attendance' },
              { name: 'reject_mock_location', label: 'Reject mock GPS locations', type: 'switch', step: 'Attendance' },
              { name: 'allow_wfh', label: 'Allow work from home', type: 'switch', step: 'Attendance' },
              { name: 'ip_restriction', label: 'Restrict check-in to allowed IP addresses', type: 'switch', step: 'Attendance' },

              {
                name: 'wage_definition',
                label: 'Wage definition',
                type: 'select',
                step: 'Payroll',
                options: [
                  { value: 'labour_code', label: 'Labour codes — wages at least half of total pay' },
                  { value: 'legacy_basic_da', label: 'Legacy — basic plus dearness allowance' },
                ],
                hint: 'Drives the PF and gratuity base.',
              },
              {
                name: 'payroll_day_basis',
                label: 'Per-day salary basis',
                type: 'select',
                step: 'Payroll',
                options: [
                  { value: 'calendar', label: 'Calendar days in the month' },
                  { value: '26', label: 'Fixed 26 days' },
                  { value: '30', label: 'Fixed 30 days' },
                ],
                half: true,
              },
              { name: 'esi_includes_overtime', label: 'Overtime counts towards ESI wages', type: 'switch', step: 'Payroll' },
              { name: 'pf_on_actual_default', label: 'New employees get PF on actual basic by default', type: 'switch', step: 'Payroll', hint: 'Off means PF is capped at the statutory ceiling.' },
              { name: 'payroll_maker_checker', label: 'Payroll needs a second person to approve', type: 'switch', step: 'Payroll' },
            ]}
            initial={{
              off_sun: offs.has(0), off_mon: offs.has(1), off_tue: offs.has(2), off_wed: offs.has(3),
              off_thu: offs.has(4), off_fri: offs.has(5), off_sat: offs.has(6),
              leave_year_start_month: String(policy?.leave_year_start_month ?? 4),
              default_probation_days: String(policy?.default_probation_days ?? 180),
              selfie_mandatory: policy?.selfie_mandatory ?? false,
              geofence_mandatory: policy?.geofence_mandatory ?? false,
              reject_mock_location: policy?.reject_mock_location ?? true,
              allow_wfh: policy?.allow_wfh ?? true,
              ip_restriction: policy?.ip_restriction ?? false,
              wage_definition: policy?.wage_definition ?? 'labour_code',
              payroll_day_basis: policy?.payroll_day_basis ?? 'calendar',
              esi_includes_overtime: policy?.esi_includes_overtime ?? false,
              pf_on_actual_default: policy?.pf_on_actual_default ?? false,
              payroll_maker_checker: policy?.payroll_maker_checker ?? true,
            }}
            action={saveOrgPolicy}
            submitLabel="Save policy"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'entity' ? (
        <Modal title={open.row ? 'Edit legal entity' : 'New legal entity'} wide onClose={close}>
          <RecordForm
            fields={[
              { name: 'name', label: 'Entity name', rules: [V.required('Name')] },
              { name: 'state_code', label: 'State', type: 'select', options: STATES, half: true },
              { name: 'pan', label: 'PAN', transform: 'upper', rules: [V.pan], half: true },
              { name: 'tan', label: 'TAN', transform: 'upper', rules: [V.tan], half: true },
              { name: 'gstin', label: 'GSTIN', transform: 'upper', rules: [V.gstin], half: true },
              { name: 'pf_code', label: 'PF establishment code', transform: 'upper', half: true },
              { name: 'esi_code', label: 'ESI code', transform: 'upper', half: true },
              { name: 'is_default', label: 'Use as the default entity', type: 'switch' },
            ]}
            initial={{
              name: open.row?.name ?? '', state_code: open.row?.state_code ?? '',
              pan: open.row?.pan ?? '', tan: open.row?.tan ?? '', gstin: open.row?.gstin ?? '',
              pf_code: open.row?.pf_code ?? '', esi_code: open.row?.esi_code ?? '',
              is_default: open.row?.is_default ?? false,
            }}
            action={(vals: Values) => saveLegalEntity({ ...vals, id: open.row?.id ?? '' })}
            submitLabel="Save"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'location' ? (
        <Modal title={open.row ? 'Edit location' : 'New work location'} onClose={close}>
          <RecordForm
            fields={[
              { name: 'name', label: 'Location name', rules: [V.required('Name')] },
              { name: 'city', label: 'City', half: true },
              { name: 'state_code', label: 'State', type: 'select', options: STATES, rules: [V.required('State')], half: true, hint: 'Sets professional tax and LWF.' },
              { name: 'address', label: 'Address', type: 'textarea' },
              { name: 'geofence_radius_m', label: 'Geofence radius (metres)', type: 'number', half: true },
              { name: 'is_active', label: 'Active', type: 'switch', half: true },
            ]}
            initial={{
              name: open.row?.name ?? '', city: open.row?.city ?? '', state_code: open.row?.state_code ?? '',
              address: open.row?.address ?? '', geofence_radius_m: String(open.row?.geofence_radius_m ?? 100),
              is_active: open.row?.is_active ?? true,
            }}
            action={(vals: Values) => saveLocation({ ...vals, id: open.row?.id ?? '' })}
            submitLabel="Save"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'leavetype' ? (
        <Modal title={open.row ? 'Edit leave type' : 'New leave type'} wide onClose={close}>
          <RecordForm
            fields={[
              { name: 'code', label: 'Code', transform: 'upper', rules: [V.required('Code'), V.maxLen(10)], placeholder: 'CL', half: true },
              { name: 'name', label: 'Name', rules: [V.required('Name')], placeholder: 'Casual Leave', half: true },
              { name: 'is_paid', label: 'Paid leave', type: 'switch' },
              { name: 'days_per_year', label: 'Days per year', type: 'number', rules: [V.nonNegative('Days')], half: true },
              {
                name: 'accrual', label: 'Credited', type: 'select', half: true,
                options: [
                  { value: 'annual', label: 'All at once, each leave year' },
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'quarterly', label: 'Quarterly' },
                ],
              },
              { name: 'half_day_allowed', label: 'Half days allowed', type: 'switch' },
              { name: 'carry_forward', label: 'Unused days carry forward', type: 'switch' },
              { name: 'carry_max', label: 'Maximum carried forward', type: 'number', showWhen: { field: 'carry_forward', in: ['true'] }, half: true },
              { name: 'allow_negative', label: 'Allow a negative balance', type: 'switch' },
              { name: 'probation_days', label: 'Available after this many days of service', type: 'number', rules: [V.nonNegative('Days')], half: true, hint: '0 means from day one.' },
              { name: 'doc_required_after_days', label: 'Document required beyond this many days', type: 'number', half: true, hint: 'Typical for sick leave. Leave blank for never.' },
              { name: 'approval_levels', label: 'Approval levels', type: 'number', rules: [V.positiveInt('Levels')], half: true, hint: '1 is the manager, 2 adds HR, 3 adds the department head for long leave.' },
              { name: 'dept_head_after_days', label: 'Department head needed beyond this many days', type: 'number', showWhen: { field: 'approval_levels', in: ['3'] }, half: true },
              { name: 'auto_approve', label: 'Approve automatically', type: 'switch', hint: 'For things like comp off that need no decision.' },
              { name: 'is_active', label: 'Active', type: 'switch' },
            ]}
            initial={{
              code: open.row?.code ?? '', name: open.row?.name ?? '',
              is_paid: open.row?.is_paid ?? true,
              days_per_year: String(open.row?.days_per_year ?? ''),
              accrual: open.row?.accrual ?? 'annual',
              half_day_allowed: open.row?.half_day_allowed ?? true,
              carry_forward: open.row?.carry_forward ?? false,
              carry_max: String(open.row?.carry_max ?? ''),
              allow_negative: open.row?.allow_negative ?? false,
              probation_days: String(open.row?.probation_days ?? 0),
              doc_required_after_days: String(open.row?.doc_required_after_days ?? ''),
              approval_levels: String(open.row?.approval_levels ?? 1),
              dept_head_after_days: String(open.row?.dept_head_after_days ?? ''),
              auto_approve: open.row?.auto_approve ?? false,
              is_active: open.row?.is_active ?? true,
            }}
            action={(vals: Values) => saveLeaveType({ ...vals, id: open.row?.id ?? '' })}
            submitLabel="Save"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'holiday' ? (
        <Modal title="Add a holiday" onClose={close}>
          <RecordForm
            fields={[
              { name: 'holiday_date', label: 'Date', type: 'date', rules: [V.required('Date')], half: true },
              { name: 'name', label: 'Occasion', rules: [V.required('Name')], placeholder: 'Diwali', half: true },
              { name: 'is_optional', label: 'Optional / restricted holiday', type: 'switch' },
              {
                name: 'location_id', label: 'Only at one location', type: 'select',
                options: [{ value: '', label: 'All locations' }, ...locations.map((l) => ({ value: l.id, label: l.name }))],
                hint: 'Regional holidays differ by state, so a location-specific entry is often what you want.',
              },
            ]}
            action={saveHoliday}
            submitLabel="Add"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'shift' ? (
        <Modal title={open.row ? 'Edit shift' : 'New shift'} onClose={close}>
          <RecordForm
            fields={[
              { name: 'name', label: 'Shift name', rules: [V.required('Name')], placeholder: 'General shift' },
              { name: 'start_time', label: 'Starts', rules: [V.required('Start')], placeholder: '09:30', half: true },
              { name: 'end_time', label: 'Ends', rules: [V.required('End')], placeholder: '18:30', half: true },
              { name: 'grace_minutes', label: 'Grace before late (minutes)', type: 'number', half: true },
              { name: 'half_day_minutes', label: 'Minutes for a half day', type: 'number', half: true },
              { name: 'full_day_minutes', label: 'Minutes for a full day', type: 'number', half: true },
              { name: 'is_default', label: 'Default shift for new employees', type: 'switch' },
            ]}
            initial={{
              name: open.row?.name ?? '',
              start_time: open.row?.start_time ?? '09:30',
              end_time: open.row?.end_time ?? '18:30',
              grace_minutes: String(open.row?.grace_minutes ?? 10),
              half_day_minutes: String(open.row?.half_day_minutes ?? 240),
              full_day_minutes: String(open.row?.full_day_minutes ?? 480),
              is_default: open.row?.is_default ?? false,
            }}
            action={(vals: Values) => saveShift({ ...vals, id: open.row?.id ?? '' })}
            submitLabel="Save"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'role' ? (
        <Modal
          title="Change role"
          sub={open.row?.employee_name ?? open.row?.email ?? undefined}
          onClose={close}
        >
          <RecordForm
            fields={[
              {
                name: 'role',
                label: 'Role',
                type: 'select',
                options: ROLES.map((r) => ({ value: r, label: ROLE_WORDS[r] ?? r })),
                rules: [V.required('Role')],
                hint: 'What each role can do is set on the permission grid below this list. Employee means self service only, so it needs an employee record behind the login; any administrator role needs a contact number on file.',
              },
            ]}
            initial={{ role: open.row?.role ?? 'employee' }}
            action={(vals: Values) => setMemberRole({ ...vals, id: open.row?.id ?? '' })}
            submitLabel="Save role"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'member-phone' ? (
        <Modal
          title="Contact number"
          sub={open.row?.employee_name ?? open.row?.email ?? undefined}
          onClose={close}
        >
          <RecordForm
            fields={[
              {
                name: 'phone',
                label: 'Mobile number',
                rules: [V.required('Mobile number'), V.phone],
                hint: 'International form, for example +919876543210. Every administrator role has to have one — it is the second channel when an account is locked out.',
              },
            ]}
            initial={{ phone: open.row?.phone ?? '' }}
            action={(vals: Values) => setMemberPhone({ ...vals, id: open.row?.id ?? '' })}
            submitLabel="Save number"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}
    </>
  );
}

/** A card holding one population of logins. */
function LoginList({
  title,
  note,
  empty,
  rows,
  render,
}: {
  title: string;
  note: string;
  empty: string;
  rows: Row[];
  render: (row: Row) => React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="text-sm">{title}</h3>
        <span className="text-[11px] text-slate-muted">{rows.length}</span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-muted">{note}</p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-slate-muted">{empty}</p>
      ) : (
        <div className="flex flex-col divide-y divide-slate-line2">{rows.map(render)}</div>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="lbl">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-ink">{value ?? <span className="text-slate-faint">—</span>}</dd>
    </div>
  );
}

function Card({
  title,
  note,
  rows,
  action,
}: {
  title: string;
  note?: string;
  rows: [string, React.ReactNode][];
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="card">
      <div className="mb-3.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm">{title}</h3>
          {note ? <p className="mt-0.5 text-xs text-slate-muted">{note}</p> : null}
        </div>
        {action ? (
          <button className="btn btn-sm" onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <Item key={label} label={label} value={value} />
        ))}
      </dl>
    </div>
  );
}

function ListCard({
  title,
  note,
  empty,
  rows,
  action,
}: {
  title: string;
  note?: string;
  empty: string;
  rows: {
    id: string;
    title: string;
    sub: string;
    onEdit?: () => void;
    onDelete?: () => void;
    deleteLabel?: string;
  }[];
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="card">
      <div className="mb-3.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm">{title}</h3>
          {note ? <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">{note}</p> : null}
        </div>
        {action ? (
          <button className="btn btn-sm btn-primary" onClick={action.onClick}>
            <Icon name="plus" size={14} />
            {action.label}
          </button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-5 text-center text-[13px] text-slate-muted">
          {empty}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-slate-line2">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[13px] font-semibold text-ink">{r.title}</b>
                <span className="block truncate text-[11px] text-slate-muted">{r.sub}</span>
              </div>
              {r.onEdit ? (
                <button className="btn btn-sm" onClick={r.onEdit}>
                  Edit
                </button>
              ) : null}
              {r.onDelete ? (
                <button className="btn btn-sm btn-danger" onClick={r.onDelete}>
                  {r.deleteLabel ?? 'Remove'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
