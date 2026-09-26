import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import {
  LeaveConsole,
  type TypeRow, type RequestRow, type BalanceRow, type LedgerRow, type HolidayRow,
} from '@/components/leave/leave-console';

export const dynamic = 'force-dynamic';

export default async function LeavePage() {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';
  const year = new Date().getFullYear();

  const [
    { data: types }, { data: requests }, { data: balances },
    { data: ledger }, { data: staff }, { data: holidays },
    { data: locations }, { data: departments },
  ] = await Promise.all([
    supabase.from('leave_types').select('id,code,name,is_paid,days_per_year,is_active').eq('org_id', org).order('code'),
    supabase
      .from('leave_requests')
      .select('id,request_no,employee_id,leave_type_id,from_date,to_date,half_day,days,reason,status,balance_before,balance_after,approval_request_id,applied_at')
      .eq('org_id', org)
      .gte('from_date', `${year}-01-01`)
      .order('applied_at', { ascending: false })
      .limit(300),
    supabase.from('leave_balances').select('employee_id,leave_type_id,balance,credited,debited').eq('org_id', org).eq('leave_year', year),
    supabase
      .from('leave_ledger')
      .select('id,employee_id,leave_type_id,entry_date,delta,reason,note')
      .eq('org_id', org)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('employees')
      .select('id,full_name,employee_code,department_id,status')
      .eq('org_id', org)
      .eq('status', 'active')
      .order('full_name'),
    supabase
      .from('holidays')
      .select('id,holiday_date,name,is_optional,location_id')
      .eq('org_id', org)
      .gte('holiday_date', `${year}-01-01`)
      .lte('holiday_date', `${year}-12-31`)
      .order('holiday_date'),
    supabase.from('locations').select('id,name').eq('org_id', org).order('name'),
    supabase.from('departments').select('id,name').eq('org_id', org),
  ]);

  const deptById = new Map(((departments ?? []) as any[]).map((d) => [d.id as string, d.name as string]));
  const people = ((staff ?? []) as any[]).map((e) => ({
    id: e.id as string,
    full_name: e.full_name as string,
    employee_code: e.employee_code as string,
    department: e.department_id ? (deptById.get(e.department_id) ?? null) : null,
  }));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.full_name ?? 'Employee';

  return (
    <CustomerShell current="/leave">
      <PageHead
        title="Leave"
        sub="Applications, who is off, balances and the holiday calendar"
      />
      <LeaveConsole
        types={(types ?? []) as TypeRow[]}
        requests={((requests ?? []) as any[]).map((r) => ({ ...r, employee_name: nameOf(r.employee_id) })) as RequestRow[]}
        balances={(balances ?? []) as BalanceRow[]}
        ledger={((ledger ?? []) as any[]).map((l) => ({ ...l, employee_name: nameOf(l.employee_id) })) as LedgerRow[]}
        staff={people}
        holidays={(holidays ?? []) as HolidayRow[]}
        locations={((locations ?? []) as any[]).map((l) => ({ value: l.id, label: l.name }))}
        year={year}
        caps={{ approve: v.can('leave.approve'), config: v.can('leave.config') }}
      />
    </CustomerShell>
  );
}
