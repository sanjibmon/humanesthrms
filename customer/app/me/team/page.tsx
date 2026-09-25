import Link from 'next/link';
import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState, Avatar } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { dateLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function MyTeamPage() {
  const v = await getViewer();
  const supabase = createClient();
  const me = v.employeeId;

  if (!me) {
    return (
      <CustomerShell current="/me/team">
        <PageHead title="My Team" sub="The people reporting to you" />
        <EmptyState
          icon="users"
          title="This sign-in is not linked to an employee record"
          body="A reporting line runs between employees. This login administers the organisation instead."
        />
      </CustomerShell>
    );
  }

  const { data: team } = await supabase
    .from('employees')
    .select('id,employee_code,full_name,work_email,doj,status,designation_id')
    .eq('reporting_manager_id', me)
    .neq('status', 'exited')
    .order('full_name');

  const rows = (team ?? []) as any[];

  /* Who is off today, and what is waiting on this manager. app.is_manager_of
     is what lets a manager read their reports' leave at all. */
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: leaves }, { data: desigs }] = await Promise.all([
    rows.length
      ? supabase
          .from('leave_requests')
          .select('id,employee_id,from_date,to_date,days,status,leave_type_id')
          .in('employee_id', rows.map((r) => r.id))
          .in('status', ['pending', 'approved'])
          .gte('to_date', today)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.from('designations').select('id,name').eq('org_id', v.orgId ?? ''),
  ]);

  const desigById = new Map(((desigs ?? []) as any[]).map((d) => [d.id as string, d.name as string]));
  const all = (leaves ?? []) as any[];
  const onLeaveToday = new Set(
    all.filter((l) => l.status === 'approved' && l.from_date <= today && l.to_date >= today).map((l) => l.employee_id),
  );
  const pendingByEmployee = new Map<string, number>();
  for (const l of all.filter((x) => x.status === 'pending')) {
    pendingByEmployee.set(l.employee_id, (pendingByEmployee.get(l.employee_id) ?? 0) + 1);
  }
  const pendingTotal = [...pendingByEmployee.values()].reduce((a, b) => a + b, 0);

  return (
    <CustomerShell current="/me/team">
      <PageHead title="My Team" sub="The people reporting to you" />
      <EssBanner />

      {rows.length === 0 ? (
        <EmptyState
          icon="users"
          title="Nobody reports to you"
          body="When HR sets you as somebody's reporting manager, they appear here — and their leave and regularisation requests start arriving in your inbox."
        />
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <Tile label="Team size" value={rows.length} foot="excluding leavers" />
            <Tile label="Off today" value={onLeaveToday.size} foot="approved leave" />
            <Tile
              label="Waiting on you"
              value={pendingTotal}
              foot={pendingTotal ? 'leave requests pending' : 'nothing pending'}
            />
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm">Reports</h3>
            <div className="flex flex-col divide-y divide-slate-line2">
              {rows.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Avatar name={e.full_name} slate={onLeaveToday.has(e.id)} />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-semibold text-ink">{e.full_name}</b>
                    <span className="block truncate text-[11px] text-slate-muted">
                      {e.employee_code}
                      {desigById.get(e.designation_id) ? ` · ${desigById.get(e.designation_id)}` : ''}
                      {e.work_email ? ` · ${e.work_email}` : ''}
                    </span>
                    <span className="block text-[11px] text-slate-faint">
                      Joined {dateLabel(e.doj)}
                    </span>
                  </div>
                  {onLeaveToday.has(e.id) ? <span className="badge bg-brand-soft text-brand-dark">on leave</span> : null}
                  {pendingByEmployee.get(e.id) ? (
                    <span className="badge bg-amber-bg text-amber-text">
                      {pendingByEmployee.get(e.id)} pending
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {pendingTotal ? (
            <p className="mt-4 text-[13px] text-slate-muted">
              {pendingTotal} request{pendingTotal > 1 ? 's are' : ' is'} waiting for your decision.{' '}
              <Link href="/inbox" className="font-semibold text-brand-dark hover:underline">
                Open your inbox
              </Link>
              .
            </p>
          ) : null}
        </>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        You see your reports&rsquo; leave because you are their manager, not because you are an
        administrator — the database grants that specific visibility and nothing wider. Their salary,
        bank details and personal records stay closed to you.
      </p>
    </CustomerShell>
  );
}

function Tile({ label, value, foot }: { label: string; value: React.ReactNode; foot: string }) {
  return (
    <div className="card">
      <span className="lbl">{label}</span>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-muted">{foot}</p>
    </div>
  );
}
