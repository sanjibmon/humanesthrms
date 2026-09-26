import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { confirmDueProbations } from '@/app/actions/employees';
import {
  EmployeeConsole,
  type EmployeeRow,
  type Masters,
} from '@/components/employees/employee-console';

export const dynamic = 'force-dynamic';

type Raw = {
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
  department_id: string | null;
  designation_id: string | null;
  location_id: string | null;
  reporting_manager_id: string | null;
};

export default async function EmployeesPage() {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';

  /* Confirm anybody whose probation has run out, before reading the list, so
     the page never shows somebody as "due for confirmation" and then leaves
     them that way. There is no scheduler in this project; doing it here makes
     the feature self-healing — it lands the first time HR opens this page on or
     after the due date, and the effective date recorded is the real due date
     rather than the day somebody noticed. The function is idempotent, so a
     refresh costs one cheap indexed query and changes nothing. */
  if (v.can('people.write')) await confirmDueProbations();

  /* One round trip for the directory and everything the form needs to offer as
     a choice. Row level security scopes all of it to this organisation, so
     none of these filters are the security boundary — they are just the query. */
  const [{ data: emps }, { data: depts }, { data: desigs }, { data: locs }, { data: ents }, { data: lic }] =
    await Promise.all([
      /* Deliberately no embedded joins. Every foreign key out of `employees` is
         composite — (department_id, org_id) and so on — and PostgREST's
         embedding syntax is fragile with those. The four lookup lists are
         fetched anyway for the form's dropdowns, so the names are resolved here
         instead, which cannot 400. */
      supabase
        .from('employees')
        .select(
          'id,employee_code,full_name,work_email,work_phone,doj,exit_date,status,' +
            'employment_type,probation_days,probation_end_date,' +
            'department_id,designation_id,location_id,reporting_manager_id',
        )
        .eq('org_id', org)
        .order('employee_code'),
      supabase.from('departments').select('id,name').eq('org_id', org).eq('is_active', true).order('name'),
      supabase.from('designations').select('id,name').eq('org_id', org).eq('is_active', true).order('name'),
      supabase.from('locations').select('id,name,state_code').eq('org_id', org).eq('is_active', true).order('name'),
      supabase.from('legal_entities').select('id,name').eq('org_id', org).order('name'),
      supabase.from('organization_licenses').select('seats_total,seats_used').eq('org_id', org).maybeSingle(),
    ]);

  /* Which employees already have a login, and the organisation's own default
     probation length. Both are small reads the console needs to render honestly
     rather than guessing. */
  const [{ data: members }, { data: settings }] = await Promise.all([
    supabase.from('org_members').select('employee_id').eq('org_id', org).not('employee_id', 'is', null),
    supabase.from('org_settings').select('default_probation_days').eq('org_id', org).maybeSingle(),
  ]);
  const invitedIds = ((members ?? []) as { employee_id: string }[]).map((m) => m.employee_id);
  const defaultProbationDays = Number((settings as { default_probation_days?: number } | null)?.default_probation_days ?? 180);

  const raw = (emps ?? []) as unknown as Raw[];

  const deptById = byId((depts ?? []) as { id: string; name: string }[]);
  const desigById = byId((desigs ?? []) as { id: string; name: string }[]);
  const locList = (locs ?? []) as { id: string; name: string; state_code: string }[];
  const locById = new Map(locList.map((l) => [l.id, l]));
  const nameById = new Map(raw.map((e) => [e.id, e.full_name]));

  const rows: EmployeeRow[] = raw.map((e) => ({
    id: e.id,
    employee_code: e.employee_code,
    full_name: e.full_name,
    work_email: e.work_email,
    probation_days: e.probation_days,
    probation_end_date: e.probation_end_date,
    work_phone: e.work_phone,
    doj: e.doj,
    exit_date: e.exit_date,
    status: e.status,
    employment_type: e.employment_type,
    department_name: e.department_id ? (deptById.get(e.department_id) ?? null) : null,
    designation_name: e.designation_id ? (desigById.get(e.designation_id) ?? null) : null,
    location_name: e.location_id ? (locById.get(e.location_id)?.name ?? null) : null,
    location_state: e.location_id ? (locById.get(e.location_id)?.state_code ?? null) : null,
    manager_name: e.reporting_manager_id ? (nameById.get(e.reporting_manager_id) ?? null) : null,
  }));

  const masters: Masters = {
    departments: ((depts ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name })),
    designations: ((desigs ?? []) as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name })),
    locations: ((locs ?? []) as { id: string; name: string; state_code: string }[]).map((l) => ({
      value: l.id,
      label: `${l.name} · ${l.state_code}`,
    })),
    entities: ((ents ?? []) as { id: string; name: string }[]).map((x) => ({ value: x.id, label: x.name })),
    // Anyone still on the books can be somebody's manager; leavers cannot.
    managers: rows
      .filter((r) => r.status !== 'exited')
      .map((r) => ({ value: r.id, label: `${r.full_name} (${r.employee_code})` })),
  };

  const seatRow = lic as { seats_total: number; seats_used: number } | null;

  return (
    <CustomerShell current="/employees">
      <PageHead
        title="Employees"
        sub="The employee master — identity, employment, personal records and statutory identifiers"
      />

      <EmployeeConsole
        rows={rows}
        masters={masters}
        nextCode={nextCode(rows.map((r) => r.employee_code))}
        canWrite={v.can('people.write')}
        canSettings={v.can('settings.write')}
        defaultProbationDays={defaultProbationDays}
        invitedIds={invitedIds}
        seats={seatRow ? { used: seatRow.seats_used, total: seatRow.seats_total } : null}
      />

      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        The directory above is visible to every colleague. Date of birth, address and emergency
        contacts sit in a separate table that needs the people permission, and PAN, bank account and
        UAN are encrypted at rest — readable only with the sensitive-data permission and an
        authenticator-verified session, and every reveal is written to the audit chain.
      </p>
    </CustomerShell>
  );
}

const byId = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));

/**
 * The next code in whatever series the organisation already uses, so an import
 * that started at ACME-0001 keeps counting rather than jumping to EMP001.
 * Highest wins — a deleted record must never hand its number to somebody else,
 * because employee codes reach payslips and PF filings.
 */
function nextCode(existing: string[]): string {
  const parsed = existing
    .map((c) => /^([A-Za-z-]*)(\d+)$/.exec(c))
    .filter((m): m is RegExpExecArray => Boolean(m));
  if (parsed.length === 0) return 'EMP001';

  const prefix = parsed[0][1] || 'EMP';
  const width = parsed[0][2].length;
  const highest = Math.max(
    ...parsed.filter((m) => (m[1] || 'EMP') === prefix).map((m) => Number(m[2])),
  );
  return `${prefix}${String(highest + 1).padStart(width, '0')}`;
}
