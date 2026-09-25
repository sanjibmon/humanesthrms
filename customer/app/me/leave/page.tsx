import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import {
  LeaveConsole,
  type LeaveTypeRow,
  type BalanceRow,
  type LeaveRequestRow,
} from '@/components/ess/leave-console';

export const dynamic = 'force-dynamic';

export default async function MyLeavePage() {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';
  const me = v.employeeId;

  if (!me) {
    return (
      <CustomerShell current="/me/leave">
        <PageHead title="My Leave" sub="Balances, applications and their approval chain" />
        <EmptyState
          icon="calendar"
          title="This sign-in is not linked to an employee record"
          body="Leave belongs to an employee, and this login administers the organisation instead. HR links a login to an employee on that employee's page."
        />
      </CustomerShell>
    );
  }

  const year = new Date().getFullYear();
  const [{ data: types }, { data: balances }, { data: requests }] = await Promise.all([
    supabase
      .from('leave_types')
      .select('id,code,name,is_paid,half_day_allowed,days_per_year,doc_required_after_days')
      .eq('org_id', org)
      .eq('is_active', true)
      .order('code'),
    supabase
      .from('leave_balances')
      .select('leave_type_id,balance,credited,debited')
      .eq('employee_id', me)
      .eq('leave_year', year),
    supabase
      .from('leave_requests')
      .select('id,request_no,leave_type_id,from_date,to_date,half_day,days,reason,status,applied_at,decided_at')
      .eq('employee_id', me)
      .order('from_date', { ascending: false })
      .limit(100),
  ]);

  return (
    <CustomerShell current="/me/leave">
      <PageHead title="My Leave" sub="Balances, applications and their approval chain" />
      <EssBanner />
      <LeaveConsole
        types={(types ?? []) as LeaveTypeRow[]}
        balances={(balances ?? []) as BalanceRow[]}
        requests={(requests ?? []) as LeaveRequestRow[]}
        canApply
      />
      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        Balances are computed from the leave ledger rather than stored as a single number, so they
        always reconcile with what was credited, used and reversed. A pending application is already
        counted against what you can apply for.
      </p>
    </CustomerShell>
  );
}
