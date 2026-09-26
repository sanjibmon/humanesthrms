import { notFound } from 'next/navigation';
import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import {
  EmployeeDetail,
  type EmployeeFull,
  type PersonalRow,
  type StatutoryRow,
  type CompRow,
} from '@/components/employees/employee-detail';
import type { Masters, Option } from '@/components/employees/employee-console';

export const dynamic = 'force-dynamic';

export default async function EmployeePage({ params }: { params: { id: string } }) {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';
  const id = params.id;

  /* No embedded joins — every foreign key out of `employees` is composite and
     PostgREST's embedding is unreliable with those. The lookup lists below are
     fetched for the edit form anyway, so the names come from them. */
  const { data: row } = await supabase
    .from('employees')
    .select(
      'id,employee_code,full_name,work_email,work_phone,doj,exit_date,status,employment_type,' +
        'probation_days,probation_end_date,probation_confirmed_on,' +
        'contract_end_date,department_id,designation_id,location_id,entity_id,reporting_manager_id',
    )
    .eq('id', id)
    .maybeSingle();

  if (!row) notFound();
  const e = row as any;

  // Filled in after the lookup lists load, a few lines below.
  const emp: EmployeeFull = {
    id: e.id,
    employee_code: e.employee_code,
    full_name: e.full_name,
    work_email: e.work_email,
    work_phone: e.work_phone,
    doj: e.doj,
    exit_date: e.exit_date,
    status: e.status,
    employment_type: e.employment_type,
    probation_days: e.probation_days,
    probation_end_date: e.probation_end_date,
    probation_confirmed_on: e.probation_confirmed_on,
    contract_end_date: e.contract_end_date,
    department_id: e.department_id,
    designation_id: e.designation_id,
    location_id: e.location_id,
    entity_id: e.entity_id,
    reporting_manager_id: e.reporting_manager_id,
    department_name: null,
    designation_name: null,
    location_name: null,
    manager_name: null,
  };

  /* Each of these is a separate table with its own policy, so a caller without
     the permission simply gets nothing back rather than an error — which is why
     the component renders an explanation instead of assuming the data is
     missing. */
  const [{ data: personal }, { data: statutory }, { data: comp }, { data: depts }, { data: desigs }, { data: locs }, { data: ents }, { data: peers }, { data: structs }] =
    await Promise.all([
      supabase
        .from('employee_personal')
        .select('dob,gender,marital_status,blood_group,personal_email,personal_phone,nationality,current_address,permanent_address,emergency_contacts')
        .eq('employee_id', id)
        .maybeSingle(),
      supabase
        .from('employee_statutory')
        .select('pan_last4,bank_last4,bank_name,ifsc,uan,esi_ip_number,aadhaar_last4,tax_regime,pf_applicable,pf_on_actual,esi_applicable,pt_applicable,lwf_applicable')
        .eq('employee_id', id)
        .maybeSingle(),
      supabase
        .from('employee_compensation')
        .select('id,effective_from,annual_ctc,grade,status,revision_reason')
        .eq('employee_id', id)
        .order('effective_from', { ascending: false }),
      supabase.from('departments').select('id,name').eq('org_id', org).eq('is_active', true).order('name'),
      supabase.from('designations').select('id,name').eq('org_id', org).eq('is_active', true).order('name'),
      supabase.from('locations').select('id,name,state_code').eq('org_id', org).eq('is_active', true).order('name'),
      supabase.from('legal_entities').select('id,name').eq('org_id', org).order('name'),
      supabase.from('employees').select('id,full_name,employee_code').eq('org_id', org).neq('status', 'exited').order('full_name'),
      supabase.from('salary_structures').select('id,name,code').eq('org_id', org).order('name'),
    ]);

  const masters: Masters = {
    departments: ((depts ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name })),
    designations: ((desigs ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name })),
    locations: ((locs ?? []) as { id: string; name: string; state_code: string }[]).map((l) => ({
      value: l.id,
      label: `${l.name} · ${l.state_code}`,
    })),
    entities: ((ents ?? []) as { id: string; name: string }[]).map((x) => ({ value: x.id, label: x.name })),
    managers: ((peers ?? []) as { id: string; full_name: string; employee_code: string }[]).map((p) => ({
      value: p.id,
      label: `${p.full_name} (${p.employee_code})`,
    })),
  };

  const structures: Option[] = ((structs ?? []) as { id: string; name: string; code: string }[]).map((s) => ({
    value: s.id,
    label: `${s.name} (${s.code})`,
  }));

  const label = (opts: { value: string; label: string }[], id: string | null) =>
    id ? (opts.find((o) => o.value === id)?.label ?? null) : null;

  emp.department_name = label(masters.departments, emp.department_id);
  emp.designation_name = label(masters.designations, emp.designation_id);
  emp.location_name = label(masters.locations, emp.location_id);
  emp.manager_name = emp.reporting_manager_id
    ? (((peers ?? []) as { id: string; full_name: string }[]).find((p) => p.id === emp.reporting_manager_id)
        ?.full_name ?? null)
    : null;

  return (
    <CustomerShell current="/employees">
      <PageHead title={emp.full_name} sub={`${emp.employee_code} · employee record`} />
      <EmployeeDetail
        emp={emp}
        personal={(personal ?? null) as PersonalRow}
        statutory={(statutory ?? null) as StatutoryRow}
        compensation={(comp ?? []) as CompRow[]}
        structures={structures}
        masters={masters}
        canWrite={v.can('people.write')}
        canSensitive={v.can('people.sensitive.write')}
        canPayroll={v.can('payroll.config')}
      />
    </CustomerShell>
  );
}
