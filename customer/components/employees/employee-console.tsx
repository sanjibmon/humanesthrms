'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { RecordForm, type FieldDef, type Values } from '@/components/ui/form';
import { Avatar } from '@/components/shell';
import { Icon } from '@/components/icon';
import { toast } from '@/components/ui/toast';
import { dateLabel } from '@/lib/format';
import * as V from '@/lib/validate';
import {
  createEmployee,
  createDepartment,
  createDesignation,
  createLocation,
  setEmployeeStatus,
  inviteEmployee,
} from '@/app/actions/employees';

export type EmployeeRow = {
  id: string;
  employee_code: string;
  full_name: string;
  work_email: string | null;
  work_phone: string | null;
  doj: string;
  exit_date: string | null;
  status: string;
  employment_type: string;
  probation_days: number | null;
  probation_end_date: string | null;
  department_name: string | null;
  designation_name: string | null;
  location_name: string | null;
  location_state: string | null;
  manager_name: string | null;
};

export type Option = { value: string; label: string };

export type Masters = {
  departments: Option[];
  designations: Option[];
  locations: Option[];
  entities: Option[];
  managers: Option[];
};

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-leaf-soft text-leaf-text',
  onboarding: 'bg-brand-soft text-brand-dark',
  on_notice: 'bg-amber-bg text-amber-text',
  inactive: 'bg-slate-line2 text-slate-muted',
  exited: 'bg-slate-line2 text-slate-muted',
};

/* The vocabularies below are copied from the CHECK constraints on `employees`,
   so an invalid value is impossible to pick rather than rejected on save. */
const STATUS_OPTIONS: Option[] = [
  { value: 'onboarding', label: 'Onboarding — joining formalities in progress' },
  { value: 'active', label: 'Active' },
  { value: 'on_notice', label: 'On notice' },
  { value: 'inactive', label: 'Inactive — on long leave or suspended' },
  { value: 'exited', label: 'Exited' },
];

const EMPLOYMENT_TYPES: Option[] = [
  { value: 'probation', label: 'Probation' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'fixed_term', label: 'Fixed term' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
  { value: 'consultant', label: 'Consultant' },
];

const GENDERS: Option[] = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'O', label: 'Other' },
];

const MARITAL: Option[] = ['single', 'married', 'divorced', 'widowed', 'other'].map((v) => ({
  value: v,
  label: v[0].toUpperCase() + v.slice(1),
}));

const BLOOD: Option[] = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map((v) => ({
  value: v,
  label: v,
}));

/** The states HumaNest has professional tax and labour welfare fund rules for. */
export const STATES: Option[] = [
  ['MH', 'Maharashtra'], ['KA', 'Karnataka'], ['TN', 'Tamil Nadu'], ['TG', 'Telangana'],
  ['WB', 'West Bengal'], ['GJ', 'Gujarat'], ['DL', 'Delhi'], ['HR', 'Haryana'],
  ['UP', 'Uttar Pradesh'], ['RJ', 'Rajasthan'], ['KL', 'Kerala'], ['AP', 'Andhra Pradesh'],
  ['MP', 'Madhya Pradesh'], ['PB', 'Punjab'], ['OR', 'Odisha'], ['BR', 'Bihar'],
  ['AS', 'Assam'], ['JH', 'Jharkhand'], ['CG', 'Chhattisgarh'], ['UK', 'Uttarakhand'],
  ['HP', 'Himachal Pradesh'], ['GA', 'Goa'], ['JK', 'Jammu & Kashmir'], ['CH', 'Chandigarh'],
  ['PY', 'Puducherry'],
].map(([value, label]) => ({ value, label: `${label} (${value})` }));

const withBlank = (opts: Option[], blank = '— none —'): Option[] => [
  { value: '', label: blank },
  ...opts,
];

export function EmployeeConsole({
  rows,
  masters,
  nextCode,
  canWrite,
  canSettings,
  seats,
  defaultProbationDays,
  invitedIds,
}: {
  rows: EmployeeRow[];
  masters: Masters;
  nextCode: string;
  canWrite: boolean;
  canSettings: boolean;
  seats: { used: number; total: number } | null;
  defaultProbationDays: number;
  /** Employee ids that already have a login attached. */
  invitedIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<
    | { kind: 'add' }
    | { kind: 'status'; row: EmployeeRow }
    | { kind: 'master'; what: 'department' | 'designation' | 'location' }
    | null
  >(null);

  const close = () => setOpen(null);
  const [busy, setBusy] = useState<string | null>(null);
  const invited = useMemo(() => new Set(invitedIds), [invitedIds]);

  async function invite(r: EmployeeRow) {
    setBusy(r.id);
    const res = await inviteEmployee(r.id);
    setBusy(null);
    toast(res.ok ? (res.message ?? 'Invitation sent.') : res.error, !res.ok);
    if (res.ok) router.refresh();
  }
  const seatsLeft = seats ? seats.total - seats.used : null;
  const full = seatsLeft !== null && seatsLeft <= 0;

  /* One submission creates the directory row and the personal record together.
     Splitting it into "create, then go and fill in the rest" is how HR systems
     end up full of half-built profiles. */
  const addFields: FieldDef[] = [
    { name: 'employee_code', label: 'Employee code', step: 'Identity', rules: [V.required('Employee code')], hint: 'Appears on payslips and statutory filings. It cannot be reused once taken.', half: true },
    { name: 'full_name', label: 'Full name', step: 'Identity', rules: [V.required('Full name')], hint: 'As it appears on PAN, for TDS and Form 16.', half: true },
    { name: 'work_email', label: 'Work email', type: 'email', step: 'Identity', transform: 'lower', rules: [V.email], half: true },
    { name: 'work_phone', label: 'Work phone', step: 'Identity', rules: [V.phone], placeholder: '98765 43210', half: true },

    { name: 'doj', label: 'Date of joining', type: 'date', step: 'Employment', rules: [V.required('Date of joining')], half: true },
    { name: 'status', label: 'Status', type: 'select', step: 'Employment', options: STATUS_OPTIONS, rules: [V.required('Status')], half: true },
    { name: 'employment_type', label: 'Employment type', type: 'select', step: 'Employment', options: EMPLOYMENT_TYPES, rules: [V.required('Employment type')], half: true },
    { name: 'probation_days', label: 'Probation period, in days', type: 'number', step: 'Employment', showWhen: { field: 'employment_type', in: ['probation'] }, rules: [V.required('Probation period'), V.positiveInt('Probation period')], hint: `Days, not months — ${defaultProbationDays} is the usual Indian default. Confirmation happens automatically on the day it ends.`, half: true },
    { name: 'contract_end_date', label: 'Contract end date', type: 'date', step: 'Employment', showWhen: { field: 'employment_type', in: ['fixed_term'] }, rules: [V.required('Contract end date')], hint: 'The database will not accept a fixed-term record without one.', half: true },
    { name: 'department_id', label: 'Department', type: 'select', step: 'Employment', options: withBlank(masters.departments), half: true },
    { name: 'designation_id', label: 'Designation', type: 'select', step: 'Employment', options: withBlank(masters.designations), half: true },
    { name: 'location_id', label: 'Work location', type: 'select', step: 'Employment', options: withBlank(masters.locations), hint: 'Sets the state, which decides professional tax and LWF.', half: true },
    { name: 'entity_id', label: 'Legal entity', type: 'select', step: 'Employment', options: withBlank(masters.entities), hint: 'The entity whose PF and TAN codes this person is filed under.', half: true },
    { name: 'reporting_manager_id', label: 'Reporting manager', type: 'select', step: 'Employment', options: withBlank(masters.managers) },

    { name: 'dob', label: 'Date of birth', type: 'date', step: 'Personal', hint: 'Drives gratuity eligibility and retirement age.', half: true },
    { name: 'gender', label: 'Gender', type: 'select', step: 'Personal', options: withBlank(GENDERS, '— not stated —'), hint: 'Required in PF and ESI returns.', half: true },
    { name: 'marital_status', label: 'Marital status', type: 'select', step: 'Personal', options: withBlank(MARITAL, '— not stated —'), half: true },
    { name: 'blood_group', label: 'Blood group', type: 'select', step: 'Personal', options: withBlank(BLOOD, '— not stated —'), half: true },
    { name: 'personal_email', label: 'Personal email', type: 'email', step: 'Personal', transform: 'lower', rules: [V.email], hint: 'Used to reach them after the last working day.', half: true },
    { name: 'personal_phone', label: 'Personal phone', step: 'Personal', rules: [V.phone], placeholder: '98765 43210', half: true },
    { name: 'nationality', label: 'Nationality', step: 'Personal', half: true },

    { name: 'cur_line1', label: 'Current address', step: 'Address', placeholder: 'Flat, building, street' },
    { name: 'cur_line2', label: 'Area / landmark', step: 'Address' },
    { name: 'cur_city', label: 'City', step: 'Address', half: true },
    { name: 'cur_state', label: 'State', type: 'select', step: 'Address', options: withBlank(STATES), half: true },
    { name: 'cur_pin', label: 'PIN code', step: 'Address', rules: [V.pincode], half: true },
    { name: 'same_address', label: 'Permanent address is the same', type: 'switch', step: 'Address' },
    { name: 'per_line1', label: 'Permanent address', step: 'Address', showWhen: { field: 'same_address', in: ['false'] } },
    { name: 'per_city', label: 'City', step: 'Address', showWhen: { field: 'same_address', in: ['false'] }, half: true },
    { name: 'per_state', label: 'State', type: 'select', step: 'Address', options: withBlank(STATES), showWhen: { field: 'same_address', in: ['false'] }, half: true },
    { name: 'per_pin', label: 'PIN code', step: 'Address', rules: [V.pincode], showWhen: { field: 'same_address', in: ['false'] }, half: true },

    { name: 'emg_name', label: 'Emergency contact', step: 'Emergency', hint: 'Who to call. Required by most workplace safety policies.', half: true },
    { name: 'emg_relation', label: 'Relationship', step: 'Emergency', placeholder: 'Spouse, parent, sibling', half: true },
    { name: 'emg_phone', label: 'Their phone', step: 'Emergency', rules: [V.phone], placeholder: '98765 43210', half: true },
  ];

  const columns: Column<EmployeeRow>[] = [
    {
      key: 'name',
      header: 'Employee',
      sortable: true,
      value: (r) => `${r.full_name} ${r.employee_code} ${r.work_email ?? ''}`,
      cell: (r) => (
        <Link href={`/employees/${r.id}`} className="flex items-center gap-2.5 hover:text-brand-dark">
          <Avatar name={r.full_name} slate={r.status === 'exited' || r.status === 'inactive'} />
          <span className="min-w-0">
            <b className="block truncate font-semibold text-ink">{r.full_name}</b>
            <span className="block truncate text-[11px] text-slate-muted">
              {r.employee_code}
              {r.work_email ? ` · ${r.work_email}` : ''}
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: 'role',
      header: 'Designation',
      sortable: true,
      hideBelow: 'sm',
      value: (r) => `${r.designation_name ?? ''} ${r.department_name ?? ''}`,
      cell: (r) => (
        <span>
          <b className="block font-medium text-ink">{r.designation_name ?? '—'}</b>
          <span className="text-[11px] text-slate-muted">{r.department_name ?? 'No department'}</span>
        </span>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      sortable: true,
      hideBelow: 'md',
      value: (r) => r.location_name ?? '',
      cell: (r) =>
        r.location_name ? (
          <span>
            {r.location_name}
            {r.location_state ? (
              <span className="ml-1 text-[11px] text-slate-muted">{r.location_state}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-slate-muted">—</span>
        ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      hideBelow: 'lg',
      value: (r) => r.employment_type,
      cell: (r) => (
        <span>
          <span className={`badge ${r.employment_type === 'probation' ? 'bg-amber-bg text-amber-text' : ''}`}>
            {r.employment_type.replace(/_/g, ' ')}
          </span>
          {r.employment_type === 'probation' && r.probation_end_date ? (
            <span className="mt-0.5 block text-[11px] text-slate-muted">
              {r.probation_days} days · {probationNote(r.probation_end_date)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'doj',
      header: 'Joined',
      sortable: true,
      hideBelow: 'md',
      value: (r) => r.doj,
      cell: (r) => <span className="text-slate-muted">{dateLabel(r.doj)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      value: (r) => r.status,
      cell: (r) => (
        <span className={`badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status.replace(/_/g, ' ')}</span>
      ),
    },
    {
      key: 'ess',
      header: 'Self service',
      hideBelow: 'md',
      value: (r) => (invited.has(r.id) ? 'active' : r.work_email ? 'not invited' : 'no email'),
      cell: (r) =>
        invited.has(r.id) ? (
          <span className="badge bg-leaf-soft text-leaf-text">has a login</span>
        ) : !r.work_email ? (
          <span className="text-[11px] text-slate-muted">no work email</span>
        ) : canWrite ? (
          <button
            className="btn btn-sm"
            disabled={busy === r.id}
            onClick={() => invite(r)}
          >
            {busy === r.id ? 'Sending…' : 'Invite'}
          </button>
        ) : (
          <span className="text-[11px] text-slate-muted">not invited</span>
        ),
    },
  ];

  const addButton = canWrite ? (
    <button className="btn btn-primary" onClick={() => setOpen({ kind: 'add' })} disabled={full}>
      <Icon name="userplus" size={16} />
      Add employee
    </button>
  ) : null;

  return (
    <>
      {full ? (
        <div className="mb-4 flex gap-2.5 rounded-xl bg-amber-bg px-3.5 py-3 text-[13px] leading-relaxed text-amber-text">
          <span>
            <b>Every seat on your licence is in use.</b> The database refuses a new employee past
            the seat count, so adding one needs more seats first. Talk to HumaNest about your plan.
          </span>
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        searchPlaceholder="Search by name, code, email, designation…"
        empty={{
          icon: 'users',
          title: 'No employees yet',
          body: 'Add your first employee. The form captures the identity, employment, personal and emergency details an Indian payroll run needs; bank and statutory identifiers are added on the employee record afterwards, where they are encrypted.',
          action: addButton ?? undefined,
        }}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {seats ? (
              <span className="badge">
                {seats.used} of {seats.total} seats
              </span>
            ) : null}
            {canSettings ? (
              <>
                <button className="btn btn-sm" onClick={() => setOpen({ kind: 'master', what: 'department' })}>
                  + Department
                </button>
                <button className="btn btn-sm" onClick={() => setOpen({ kind: 'master', what: 'designation' })}>
                  + Designation
                </button>
                <button className="btn btn-sm" onClick={() => setOpen({ kind: 'master', what: 'location' })}>
                  + Location
                </button>
              </>
            ) : null}
            {addButton}
          </div>
        }
        rowActions={(r) => (
          <>
            <Link href={`/employees/${r.id}`} className="btn btn-sm">
              Open
            </Link>
            {canWrite ? (
              <button className="btn btn-sm" onClick={() => setOpen({ kind: 'status', row: r })}>
                Status
              </button>
            ) : null}
          </>
        )}
      />

      {open?.kind === 'add' ? (
        <Modal
          title="Add employee"
          sub="Identity, employment, personal details and an emergency contact"
          wide
          onClose={close}
        >
          <RecordForm
            fields={addFields}
            initial={{
              employee_code: nextCode,
              status: 'onboarding',
              employment_type: 'probation',
              probation_days: String(defaultProbationDays),
              nationality: 'Indian',
              same_address: true,
            }}
            action={createEmployee}
            submitLabel="Add employee"
            onDone={close}
            onCancel={close}
            note={
              <>
                Bank account, PAN, UAN and the tax regime are set on the employee&rsquo;s own record
                after this, because they are encrypted and need a separate permission.
              </>
            }
          />
        </Modal>
      ) : null}

      {open?.kind === 'status' ? (
        <Modal
          title={`Change status — ${open.row.full_name}`}
          sub={`Currently ${open.row.status.replace(/_/g, ' ')}`}
          onClose={close}
        >
          <RecordForm
            fields={[
              { name: 'status', label: 'New status', type: 'select', options: STATUS_OPTIONS, rules: [V.required('Status')] },
              {
                name: 'exit_date',
                label: 'Last working day',
                type: 'date',
                showWhen: { field: 'status', in: ['exited', 'inactive'] },
                rules: [V.required('Last working day')],
                hint: 'Must be on or after the date of joining. Payroll stops counting from here.',
              },
            ]}
            initial={{ status: open.row.status, exit_date: open.row.exit_date ?? '' }}
            action={(vals: Values) => setEmployeeStatus({ ...vals, id: open.row.id })}
            submitLabel="Save status"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {open?.kind === 'master' ? (
        <Modal
          title={
            open.what === 'department'
              ? 'New department'
              : open.what === 'designation'
                ? 'New designation'
                : 'New work location'
          }
          sub="Available immediately in the employee form"
          onClose={close}
        >
          <RecordForm
            fields={
              open.what === 'department'
                ? [
                    { name: 'name', label: 'Department name', rules: [V.required('Name')], placeholder: 'Engineering' },
                    { name: 'code', label: 'Short code', transform: 'upper', placeholder: 'ENG', hint: 'Optional. Useful in reports and employee codes.' },
                  ]
                : open.what === 'designation'
                  ? [
                      { name: 'name', label: 'Designation', rules: [V.required('Name')], placeholder: 'Senior Software Engineer' },
                      { name: 'level', label: 'Grade level', type: 'number', hint: 'Optional. A number you can sort and band by — 1 is most junior.' },
                    ]
                  : [
                      { name: 'name', label: 'Location name', rules: [V.required('Name')], placeholder: 'Head office — Pune' },
                      { name: 'city', label: 'City', half: true },
                      { name: 'state_code', label: 'State', type: 'select', options: STATES, rules: [V.required('State')], half: true, hint: 'Decides professional tax and the labour welfare fund.' },
                      { name: 'address', label: 'Address', type: 'textarea' },
                    ]
            }
            action={
              open.what === 'department'
                ? createDepartment
                : open.what === 'designation'
                  ? createDesignation
                  : createLocation
            }
            submitLabel="Create"
            onDone={() => {
              close();
              router.refresh();
            }}
            onCancel={close}
          />
        </Modal>
      ) : null}
    </>
  );
}

/** How a probation end date reads to somebody scanning the list. */
function probationNote(end: string): string {
  const days = Math.round(
    (new Date(`${end}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000,
  );
  if (days < 0) return `due for confirmation (${Math.abs(days)} days ago)`;
  if (days === 0) return 'confirms today';
  if (days === 1) return 'confirms tomorrow';
  if (days <= 30) return `confirms in ${days} days`;
  return `confirms ${new Date(`${end}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
