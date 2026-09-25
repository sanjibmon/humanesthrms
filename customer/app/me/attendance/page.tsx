import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { AttendanceConsole, type DayRow, type RegRow } from '@/components/ess/attendance-console';

export const dynamic = 'force-dynamic';

export default async function MyAttendancePage() {
  const v = await getViewer();
  const supabase = createClient();
  const me = v.employeeId;

  if (!me) {
    return (
      <CustomerShell current="/me/attendance">
        <PageHead title="My Attendance" sub="Your days, and anything that needs correcting" />
        <EmptyState
          icon="clock"
          title="This sign-in is not linked to an employee record"
          body="Attendance belongs to an employee. HR links a login to an employee on that employee's page."
        />
      </CustomerShell>
    );
  }

  // The current month, plus the tail of the previous one so a regularisation
  // window that straddles month-end is still reachable.
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const monthLabel = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const [{ data: days }, { data: regs }] = await Promise.all([
    supabase
      .from('attendance_daily')
      .select('work_date,first_in,last_out,worked_minutes,status,late_minutes,overtime_minutes,is_regularized,locked')
      .eq('employee_id', me)
      .gte('work_date', from)
      .order('work_date', { ascending: false }),
    supabase
      .from('attendance_regularizations')
      .select('id,work_date,request_type,reason,status,created_at')
      .eq('employee_id', me)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const all = (days ?? []) as DayRow[];

  return (
    <CustomerShell current="/me/attendance">
      <PageHead title="My Attendance" sub="Your days, and anything that needs correcting" />
      <EssBanner />
      <AttendanceConsole
        days={all}
        regularizations={(regs ?? []) as RegRow[]}
        month={monthLabel}
        monthStart={monthStart}
        canRequest
      />
      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        Counters above cover {monthLabel}; the table also shows the previous month so a correction
        near month-end is still within the 31-day regularisation window. Days from{' '}
        {monthStart.slice(0, 7)} onwards are the ones payroll will read.
      </p>
    </CustomerShell>
  );
}
