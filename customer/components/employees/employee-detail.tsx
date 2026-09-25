'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/ui/modal';
import { RecordForm, type FieldDef, type Values } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { Avatar } from '@/components/shell';
import { Icon } from '@/components/icon';
import { dateLabel, inr } from '@/lib/format';
import * as V from '@/lib/validate';
import { STATES, type Option, type Masters } from '@/components/employees/employee-console';
import {
  updateEmployeeJob,
  updateEmployeePersonal,
  updateEmployeeStatutory,
  revealStatutory,
  saveCompensation,
} from '@/app/actions/employees';

export type EmployeeFull = {
  id: string;
  employee_code: string;
  full_name: string;
  work_email: string | null;
  work_phone: string | null;
  doj: string;
  exit_date: string | null;
  status: string;
  employment_type: string;
  contract_end_date: string | null;
  department_id: string | null;
  designation_id: string | null;
  location_id: string | null;
  entity_id: string | null;
  reporting_manager_id: string | null;
  department_name: string | null;
  designation_name: string | null;
  location_name: string | null;
  manager_name: string | null;
};

export type PersonalRow = {
  dob: string | null;
  gender: string | null;
  marital_status: string | null;
  blood_group: string | null;
  personal_email: string | null;
  personal_phone: string | null;
  nationality: string | null;
  current_address: Record<string, string> | null;
  permanent_address: Record<string, string> | null;
  emergency_contacts: { name?: string; relationship?: string; phone?: string }[] | null;
} | null;

export type StatutoryRow = {
  pan_last4: string | null;
  bank_last4: string | null;
  bank_name: string | null;
  ifsc: string | null;
  uan: string | null;
  esi_ip_number: string | null;
  aadhaar_last4: string | null;
  tax_regime: string;
  pf_applicable: boolean;
  pf_on_actual: boolean;
  esi_applicable: boolean;
  pt_applicable: boolean;
  lwf_applicable: boolean;
} | null;

export type CompRow = {
  id: string;
  effective_from: string;
  annual_ctc: number;
  grade: string | null;
  status: string;
  revision_reason: string | null;
};

const TABS = ['Job', 'Personal', 'Statutory & bank', 'Compensation'] as const;
type Tab = (typeof TABS)[number];

const GENDER_LABEL: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other' };

const withBlank = (opts: Option[], blank = '— none —'): Option[] => [
  { value: '', label: blank },
  ...opts,
];

export function EmployeeDetail({
  emp,
  personal,
  statutory,
  compensation,
  structures,
  masters,
  canWrite,
  canSensitive,
  canPayroll,
}: {
  emp: EmployeeFull;
  personal: PersonalRow;
  statutory: StatutoryRow;
  compensation: CompRow[];
  structures: Option[];
  masters: Masters;
  canWrite: boolean;
  /** people.sensitive.write — PAN, bank, UAN. */
  canSensitive: boolean;
  /** payroll.config — a different permission, held by payroll admins. */
  canPayroll: boolean;
}) {
  const [tab, setTab] = useState<Tab>('Job');
  const [edit, setEdit] = useState<Tab | 'comp' | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const close = () => setEdit(null);

  /* Unmasking writes an audit row on the database side. It is deliberately one
     field at a time and never cached on the server — the value lives only in
     this component's state until the page is left. */
  async function reveal(field: 'pan' | 'bank_account') {
    setBusy(true);
    const res = await revealStatutory(emp.id, field);
    setBusy(false);
    if (!res.ok) return toast(res.error, true);
    setRevealed((r) => ({ ...r, [field]: String(res.data ?? '') || '— not set —' }));
  }

  const jobFields: FieldDef[] = [
    { name: 'full_name', label: 'Full name', rules: [V.required('Full name')], half: true },
    { name: 'work_email', label: 'Work email', type: 'email', transform: 'lower', rules: [V.email], half: true },
    { name: 'work_phone', label: 'Work phone', rules: [V.phone], half: true },
    { name: 'doj', label: 'Date of joining', type: 'date', rules: [V.required('Date of joining')], half: true },
    { name: 'employment_type', label: 'Employment type', type: 'select', options: [
        { value: 'permanent', label: 'Permanent' },
        { value: 'fixed_term', label: 'Fixed term' },
        { value: 'contract', label: 'Contract' },
        { value: 'intern', label: 'Intern' },
        { value: 'consultant', label: 'Consultant' },
      ], rules: [V.required('Employment type')], half: true },
    { name: 'contract_end_date', label: 'Contract end date', type: 'date', showWhen: { field: 'employment_type', in: ['fixed_term'] }, rules: [V.required('Contract end date')], half: true },
    { name: 'department_id', label: 'Department', type: 'select', options: withBlank(masters.departments), half: true },
    { name: 'designation_id', label: 'Designation', type: 'select', options: withBlank(masters.designations), half: true },
    { name: 'location_id', label: 'Work location', type: 'select', options: withBlank(masters.locations), hint: 'Sets the state for professional tax and LWF.', half: true },
    { name: 'entity_id', label: 'Legal entity', type: 'select', options: withBlank(masters.entities), half: true },
    { name: 'reporting_manager_id', label: 'Reporting manager', type: 'select', options: withBlank(masters.managers.filter((m) => m.value !== emp.id)) },
  ];

  const personalFields: FieldDef[] = [
    { name: 'dob', label: 'Date of birth', type: 'date', half: true },
    { name: 'gender', label: 'Gender', type: 'select', options: withBlank([
        { value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }, { value: 'O', label: 'Other' },
      ], '— not stated —'), half: true },
    { name: 'marital_status', label: 'Marital status', type: 'select', options: withBlank(
        ['single', 'married', 'divorced', 'widowed', 'other'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) })),
        '— not stated —'), half: true },
    { name: 'blood_group', label: 'Blood group', type: 'select', options: withBlank(
        ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map((x) => ({ value: x, label: x })), '— not stated —'), half: true },
    { name: 'personal_email', label: 'Personal email', type: 'email', transform: 'lower', rules: [V.email], half: true },
    { name: 'personal_phone', label: 'Personal phone', rules: [V.phone], half: true },
    { name: 'nationality', label: 'Nationality', half: true },

    { name: 'cur_line1', label: 'Current address', placeholder: 'Flat, building, street' },
    { name: 'cur_line2', label: 'Area / landmark' },
    { name: 'cur_city', label: 'City', half: true },
    { name: 'cur_state', label: 'State', type: 'select', options: withBlank(STATES), half: true },
    { name: 'cur_pin', label: 'PIN code', rules: [V.pincode], half: true },
    { name: 'same_address', label: 'Permanent address is the same', type: 'switch' },
    { name: 'per_line1', label: 'Permanent address', showWhen: { field: 'same_address', in: ['false'] } },
    { name: 'per_city', label: 'City', showWhen: { field: 'same_address', in: ['false'] }, half: true },
    { name: 'per_state', label: 'State', type: 'select', options: withBlank(STATES), showWhen: { field: 'same_address', in: ['false'] }, half: true },
    { name: 'per_pin', label: 'PIN code', rules: [V.pincode], showWhen: { field: 'same_address', in: ['false'] }, half: true },

    { name: 'emg_name', label: 'Emergency contact', half: true },
    { name: 'emg_relation', label: 'Relationship', half: true },
    { name: 'emg_phone', label: 'Their phone', rules: [V.phone], half: true },
  ];

  const statutoryFields: FieldDef[] = [
    { name: 'pan', label: 'PAN', transform: 'upper', placeholder: 'ABCDE1234F', hint: statutory?.pan_last4 ? `Currently ending ${statutory.pan_last4}. Leave blank to keep it.` : 'Needed for TDS and Form 16.', half: true },
    { name: 'aadhaar_last4', label: 'Aadhaar — last 4 digits only', placeholder: '4321', hint: 'HumaNest never stores a full Aadhaar number. Data minimisation under the DPDP Act.', half: true },
    { name: 'uan', label: 'UAN', placeholder: '123456789012', hint: 'Twelve digits, from the EPFO portal.', half: true },
    { name: 'esi_ip_number', label: 'ESI IP number', placeholder: '3112345678', half: true },

    { name: 'bank_account', label: 'Bank account number', hint: statutory?.bank_last4 ? `Currently ending ${statutory.bank_last4}. Leave blank to keep it.` : 'Encrypted at rest; only the last four digits stay readable.', half: true },
    { name: 'ifsc', label: 'IFSC', transform: 'upper', placeholder: 'HDFC0001234', half: true },
    { name: 'bank_name', label: 'Bank name', placeholder: 'HDFC Bank', half: true },

    { name: 'tax_regime', label: 'Tax regime', type: 'select', options: [
        { value: 'new', label: 'New regime (default under section 115BAC)' },
        { value: 'old', label: 'Old regime — with deductions' },
      ], half: true },
    { name: 'pf_applicable', label: 'Provident fund applies', type: 'switch' },
    { name: 'pf_on_actual', label: 'PF on actual basic, above the wage ceiling', type: 'switch', showWhen: { field: 'pf_applicable', in: ['true'] }, hint: 'Off means PF is capped at the statutory ceiling.' },
    { name: 'esi_applicable', label: 'ESI applies', type: 'switch', hint: 'Usually for gross wages at or below the ESI ceiling.' },
    { name: 'pt_applicable', label: 'Professional tax applies', type: 'switch', hint: 'Rate comes from the work location state.' },
    { name: 'lwf_applicable', label: 'Labour welfare fund applies', type: 'switch' },
  ];

  const addr = (a: Record<string, string> | null | undefined) => {
    if (!a || !a.line1) return null;
    return [a.line1, a.line2, a.city, a.state, a.pin].filter(Boolean).join(', ');
  };
  const emg = personal?.emergency_contacts?.[0];
  const latestComp = compensation[0];

  return (
    <>
      <div className="card mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={emp.full_name} slate={emp.status === 'exited'} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ink">{emp.full_name}</h2>
            <p className="mt-0.5 text-[13px] text-slate-muted">
              {emp.employee_code}
              {emp.designation_name ? ` · ${emp.designation_name}` : ''}
              {emp.department_name ? ` · ${emp.department_name}` : ''}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <span className="badge">{emp.status.replace(/_/g, ' ')}</span>
              <span className="badge">{emp.employment_type.replace(/_/g, ' ')}</span>
              <span className="badge">Joined {dateLabel(emp.doj)}</span>
              {emp.exit_date ? <span className="badge">Left {dateLabel(emp.exit_date)}</span> : null}
            </div>
          </div>
          <Link href="/employees" className="btn btn-sm">
            Back to list
          </Link>
        </div>
      </div>

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

      {tab === 'Job' ? (
        <Section
          title="Employment"
          onEdit={canWrite ? () => setEdit('Job') : undefined}
          rows={[
            ['Employee code', emp.employee_code],
            ['Work email', emp.work_email],
            ['Work phone', emp.work_phone],
            ['Date of joining', dateLabel(emp.doj)],
            ['Employment type', emp.employment_type.replace(/_/g, ' ')],
            ['Contract ends', emp.contract_end_date ? dateLabel(emp.contract_end_date) : null],
            ['Department', emp.department_name],
            ['Designation', emp.designation_name],
            ['Work location', emp.location_name],
            ['Reporting manager', emp.manager_name],
          ]}
        />
      ) : null}

      {tab === 'Personal' ? (
        <Section
          title="Personal details"
          onEdit={canWrite ? () => setEdit('Personal') : undefined}
          note="Visible to HR and to the employee themselves — not to colleagues."
          rows={[
            ['Date of birth', personal?.dob ? dateLabel(personal.dob) : null],
            ['Gender', personal?.gender ? (GENDER_LABEL[personal.gender] ?? personal.gender) : null],
            ['Marital status', personal?.marital_status],
            ['Blood group', personal?.blood_group],
            ['Personal email', personal?.personal_email],
            ['Personal phone', personal?.personal_phone],
            ['Nationality', personal?.nationality],
            ['Current address', addr(personal?.current_address)],
            ['Permanent address', addr(personal?.permanent_address)],
            [
              'Emergency contact',
              emg?.name ? `${emg.name}${emg.relationship ? ` (${emg.relationship})` : ''}${emg.phone ? ` · ${emg.phone}` : ''}` : null,
            ],
          ]}
        />
      ) : null}

      {tab === 'Statutory & bank' ? (
        canSensitive ? (
          <Section
            title="Statutory identifiers and bank"
            onEdit={() => setEdit('Statutory & bank')}
            note="PAN and the bank account are encrypted at rest. Revealing one is recorded in the audit chain."
            rows={[
              [
                'PAN',
                revealed.pan ??
                  (statutory?.pan_last4 ? (
                    <span className="flex items-center gap-2">
                      <span className="font-mono">••••••{statutory.pan_last4}</span>
                      <button className="btn btn-sm" onClick={() => reveal('pan')} disabled={busy}>
                        Reveal
                      </button>
                    </span>
                  ) : null),
              ],
              ['Aadhaar', statutory?.aadhaar_last4 ? `•••• •••• ${statutory.aadhaar_last4}` : null],
              ['UAN', statutory?.uan],
              ['ESI IP number', statutory?.esi_ip_number],
              [
                'Bank account',
                revealed.bank_account ??
                  (statutory?.bank_last4 ? (
                    <span className="flex items-center gap-2">
                      <span className="font-mono">••••{statutory.bank_last4}</span>
                      <button className="btn btn-sm" onClick={() => reveal('bank_account')} disabled={busy}>
                        Reveal
                      </button>
                    </span>
                  ) : null),
              ],
              ['Bank', statutory?.bank_name],
              ['IFSC', statutory?.ifsc],
              ['Tax regime', statutory ? (statutory.tax_regime === 'old' ? 'Old regime' : 'New regime') : null],
              [
                'Deductions',
                statutory
                  ? [
                      statutory.pf_applicable ? `PF${statutory.pf_on_actual ? ' (on actual basic)' : ''}` : null,
                      statutory.esi_applicable ? 'ESI' : null,
                      statutory.pt_applicable ? 'PT' : null,
                      statutory.lwf_applicable ? 'LWF' : null,
                    ].filter(Boolean).join(' · ') || 'None'
                  : null,
              ],
            ]}
          />
        ) : (
          <div className="card">
            <p className="text-[13px] leading-relaxed text-slate-muted">
              <b className="text-ink">You do not have the sensitive-data permission.</b> PAN, bank
              details and UAN are hidden from this account. This is enforced by the database, not by
              this screen — an owner or HR admin can grant the permission.
            </p>
          </div>
        )
      ) : null}

      {tab === 'Compensation' ? (
        <div className="card">
          <div className="mb-3.5 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm">Compensation history</h3>
              <p className="mt-0.5 text-xs text-slate-muted">
                Every revision is kept, so a payroll run months later still uses the CTC that
                applied then. A revision starts as a draft and is approved separately.
              </p>
            </div>
            {canPayroll ? (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setEdit('comp')}
                disabled={structures.length === 0}
              >
                Add revision
              </button>
            ) : null}
          </div>

          {!canPayroll ? (
            <p className="text-[13px] leading-relaxed text-slate-muted">
              <b className="text-ink">Compensation is a payroll permission.</b> It is deliberately
              separate from the one that unlocks PAN and bank details, so an HR admin can maintain
              records without seeing what everybody earns. A payroll admin or the owner can edit
              this.
            </p>
          ) : compensation.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-slate-line px-4 py-6 text-center text-[13px] text-slate-muted">
              {structures.length === 0
                ? 'No salary structure has been set up for this organisation yet. A structure defines how CTC is split into basic, HRA and allowances, so one is needed before compensation can be recorded.'
                : 'No compensation recorded. Add the first revision, effective from the date of joining.'}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-line2">
              {compensation.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px] font-semibold text-ink">
                      <span className="rupee">{inr(Number(c.annual_ctc))}</span> a year
                    </b>
                    <span className="text-[11px] text-slate-muted">
                      From {dateLabel(c.effective_from)}
                      {c.grade ? ` · grade ${c.grade}` : ''}
                      {c.revision_reason ? ` · ${c.revision_reason}` : ''}
                    </span>
                  </div>
                  <span className="badge">{c.status}</span>
                </div>
              ))}
            </div>
          )}

          {latestComp ? (
            <p className="mt-3 text-xs text-slate-muted">
              Current annual CTC is <b className="text-ink">{inr(Number(latestComp.annual_ctc))}</b>,
              effective {dateLabel(latestComp.effective_from)}.
            </p>
          ) : null}
        </div>
      ) : null}

      {edit === 'Job' ? (
        <Modal title="Edit employment details" wide onClose={close}>
          <RecordForm
            fields={jobFields}
            initial={{
              full_name: emp.full_name,
              work_email: emp.work_email ?? '',
              work_phone: emp.work_phone ?? '',
              doj: emp.doj,
              employment_type: emp.employment_type,
              contract_end_date: emp.contract_end_date ?? '',
              department_id: emp.department_id ?? '',
              designation_id: emp.designation_id ?? '',
              location_id: emp.location_id ?? '',
              entity_id: emp.entity_id ?? '',
              reporting_manager_id: emp.reporting_manager_id ?? '',
            }}
            action={(vals: Values) => updateEmployeeJob({ ...vals, id: emp.id })}
            submitLabel="Save"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {edit === 'Personal' ? (
        <Modal title="Edit personal details" wide onClose={close}>
          <RecordForm
            fields={personalFields}
            initial={{
              dob: personal?.dob ?? '',
              gender: personal?.gender ?? '',
              marital_status: personal?.marital_status ?? '',
              blood_group: personal?.blood_group ?? '',
              personal_email: personal?.personal_email ?? '',
              personal_phone: personal?.personal_phone ?? '',
              nationality: personal?.nationality ?? 'Indian',
              cur_line1: personal?.current_address?.line1 ?? '',
              cur_line2: personal?.current_address?.line2 ?? '',
              cur_city: personal?.current_address?.city ?? '',
              cur_state: personal?.current_address?.state ?? '',
              cur_pin: personal?.current_address?.pin ?? '',
              same_address: false,
              per_line1: personal?.permanent_address?.line1 ?? '',
              per_city: personal?.permanent_address?.city ?? '',
              per_state: personal?.permanent_address?.state ?? '',
              per_pin: personal?.permanent_address?.pin ?? '',
              emg_name: emg?.name ?? '',
              emg_relation: emg?.relationship ?? '',
              emg_phone: emg?.phone ?? '',
            }}
            action={(vals: Values) => updateEmployeePersonal({ ...vals, id: emp.id })}
            submitLabel="Save"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {edit === 'Statutory & bank' ? (
        <Modal
          title="Statutory identifiers and bank"
          sub="PAN and the account number are encrypted on the way in"
          wide
          onClose={close}
        >
          <RecordForm
            fields={statutoryFields}
            initial={{
              pan: '',
              aadhaar_last4: statutory?.aadhaar_last4 ?? '',
              uan: statutory?.uan ?? '',
              esi_ip_number: statutory?.esi_ip_number ?? '',
              bank_account: '',
              ifsc: statutory?.ifsc ?? '',
              bank_name: statutory?.bank_name ?? '',
              tax_regime: statutory?.tax_regime ?? 'new',
              pf_applicable: statutory?.pf_applicable ?? true,
              pf_on_actual: statutory?.pf_on_actual ?? false,
              esi_applicable: statutory?.esi_applicable ?? false,
              pt_applicable: statutory?.pt_applicable ?? true,
              lwf_applicable: statutory?.lwf_applicable ?? false,
            }}
            action={(vals: Values) => updateEmployeeStatutory({ ...vals, id: emp.id })}
            submitLabel="Save"
            onDone={close}
            onCancel={close}
            note={
              <>
                PAN and the bank account are left blank on purpose — typing a new value replaces the
                stored one, and leaving them empty keeps what is already there.
              </>
            }
          />
        </Modal>
      ) : null}

      {edit === 'comp' ? (
        <Modal title="New compensation revision" sub={emp.full_name} onClose={close}>
          <RecordForm
            fields={[
              { name: 'effective_from', label: 'Effective from', type: 'date', rules: [V.required('Effective date')], hint: 'Payroll for months before this date keeps using the previous figure.', half: true },
              { name: 'annual_ctc', label: 'Annual CTC', type: 'number', rules: [V.required('Annual CTC'), V.positiveInt('Annual CTC')], hint: 'In rupees, for the full year.', half: true },
              { name: 'structure_id', label: 'Salary structure', type: 'select', options: structures, rules: [V.required('Salary structure')], hint: 'Decides how the CTC is split into basic, HRA and allowances.' },
              { name: 'grade', label: 'Grade', half: true },
              { name: 'revision_reason', label: 'Reason', placeholder: 'Annual increment, promotion, correction', half: true },
            ]}
            initial={{ effective_from: latestComp ? '' : emp.doj }}
            action={(vals: Values) => saveCompensation({ ...vals, id: emp.id })}
            submitLabel="Save as draft"
            onDone={close}
            onCancel={close}
          />
        </Modal>
      ) : null}
    </>
  );
}

function Section({
  title,
  rows,
  onEdit,
  note,
}: {
  title: string;
  rows: [string, React.ReactNode][];
  onEdit?: () => void;
  note?: string;
}) {
  return (
    <div className="card">
      <div className="mb-3.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm">{title}</h3>
          {note ? <p className="mt-0.5 text-xs text-slate-muted">{note}</p> : null}
        </div>
        {onEdit ? (
          <button className="btn btn-sm" onClick={onEdit}>
            <Icon name="settings" size={14} />
            Edit
          </button>
        ) : null}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="lbl">{label}</dt>
            <dd className="mt-0.5 text-[13px] text-ink">
              {value ? value : <span className="text-slate-faint">—</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
