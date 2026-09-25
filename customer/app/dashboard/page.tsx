import Link from 'next/link';
import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, Kpi, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';
import { createClient } from '@/lib/supabase/server';
import { inrShort } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const v = await getViewer();
  const supabase = createClient();

  if (!v.isEmployer) {
    // Employee self-service. Every figure below is scoped to this employee by row level security.
    const { count: myLeave } = await supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', v.employeeId ?? '')
      .eq('status', 'pending');
    const { count: mySlips } = await supabase
      .from('payslips')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', v.employeeId ?? '');

    return (
      <CustomerShell current="/dashboard">
        <PageHead title="My Dashboard" sub="Your attendance, leave and payslips at a glance" />
        <EssBanner />

        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Attendance This Month" value="—" foot="No punches recorded yet" icon="clock" accent="brand" />
          <Kpi label="Leave Balance" value="—" foot="CL, SL, EL and comp off" icon="calendar" accent="amber" />
          <Kpi label="Pending Requests" value={myLeave ?? 0} foot="Awaiting approval" icon="inbox" accent="slate" />
          <Kpi label="Payslips" value={mySlips ?? 0} foot="Published to you" rupee accent="leaf" />
        </div>

        <div className="card mb-5">
          <h3 className="mb-3 text-sm">Quick actions</h3>
          <div className="flex flex-wrap gap-2.5">
            <button className="btn btn-primary"><Icon name="camera" size={16} />Check in with selfie</button>
            <Link href="/me/leave" className="btn"><Icon name="calendar" size={16} />Apply leave</Link>
            <Link href="/me/attendance" className="btn"><Icon name="clock" size={16} />Regularize</Link>
            <Link href="/me/payroll" className="btn">&#8377; View payslip</Link>
            <Link href="/helpdesk" className="btn"><Icon name="lifebuoy" size={16} />Raise ticket</Link>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <h3 className="mb-3 text-sm">My leave balance</h3>
            <EmptyState icon="calendar" title="No balance configured"
                        body="Your HR team sets the leave types and opening balances. Balances are computed from the leave ledger, so they always reconcile." />
          </div>
          <div className="card">
            <h3 className="mb-3 text-sm">My team on leave</h3>
            <EmptyState icon="users" title="Nobody on leave"
                        body="Approved team leave for today appears here." />
          </div>
        </div>
      </CustomerShell>
    );
  }

  // Employer view.
  const orgId = v.orgId ?? '';
  const [{ count: headcount }, { count: pending }, { data: runs }] = await Promise.all([
    supabase.from('employees').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).in('status', ['active', 'onboarding', 'on_notice']),
    supabase.from('leave_requests').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('status', 'pending'),
    supabase.from('pay_runs').select('period_month,status,totals')
      .eq('org_id', orgId).order('period_month', { ascending: false }).limit(1),
  ]);

  const latest = runs?.[0] as { period_month: string; status: string; totals: any } | undefined;

  return (
    <CustomerShell current="/dashboard">
      <PageHead title="Dashboard" sub="Your organisation at a glance" />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Employees" value={headcount ?? 0}
             foot={headcount ? 'Active, onboarding and on notice' : 'None added yet'}
             icon="users" accent="brand" />
        <Kpi label="Present Today" value="—" foot="Awaiting the first punch" icon="checkcircle" accent="leaf" />
        <Kpi label="Pending Approvals" value={pending ?? 0}
             foot={pending ? 'Needs action' : 'All clear'} icon="inbox" accent="amber" />
        <Kpi label="Next Payroll"
             value={latest ? inrShort(Number(latest.totals?.net ?? 0)) : '₹0'}
             foot={latest ? `${latest.period_month} · ${latest.status}` : 'No run yet'}
             rupee accent="slate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm">Payroll</h3>
          {latest ? (
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2 text-[13px]">
              <dt className="text-xs text-slate-muted">Period</dt>
              <dd className="font-medium text-ink">{latest.period_month}</dd>
              <dt className="text-xs text-slate-muted">Status</dt>
              <dd className="font-medium text-ink">{latest.status}</dd>
              <dt className="text-xs text-slate-muted">Employees</dt>
              <dd className="font-medium tabular-nums text-ink">{latest.totals?.employees ?? 0}</dd>
              <dt className="text-xs text-slate-muted">Net payable</dt>
              <dd className="font-bold tabular-nums text-ink">{inrShort(Number(latest.totals?.net ?? 0))}</dd>
            </dl>
          ) : (
            <EmptyState icon="target" title="No payroll run yet"
                        body="Add employees, map a salary grade, then create a run. The engine computes PF, ESI, PT, LWF and TDS and every amount is shown in Indian Rupees."
                        action={<Link href="/employees" className="btn btn-primary"><Icon name="plus" size={16} />Add Employee</Link>} />
          )}
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm">Attendance today</h3>
          <EmptyState icon="clock" title="No attendance yet"
                      body="Attendance appears once employees check in from mobile with a selfie, or a biometric device starts syncing." />
        </div>
      </div>
    </CustomerShell>
  );
}
