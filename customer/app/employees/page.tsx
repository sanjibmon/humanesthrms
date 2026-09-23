import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead, EmptyState, Avatar } from '@/components/shell';
import { Icon } from '@/components/icon';
import { createClient } from '@/lib/supabase/server';
import { dateLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  onboarding: 'bg-brand-soft text-brand-dark',
  on_notice: 'bg-amber-bg text-amber-text',
  inactive: 'bg-slate-line2 text-slate-muted',
  exited: 'bg-slate-line2 text-slate-muted',
};

export default async function EmployeesPage() {
  const v = await getViewer();
  const supabase = createClient();
  const { data } = await supabase
    .from('employees')
    .select('id,employee_code,full_name,work_email,doj,status,employment_type,departments(name),designations(name),locations(name,state_code)')
    .eq('org_id', v.orgId ?? '')
    .order('employee_code');
  const rows = (data ?? []) as any[];

  const add = (
    <button className="btn btn-primary">
      <Icon name="plus" size={16} />
      Add Employee
    </button>
  );

  return (
    <CustomerShell current="/employees">
      <PageHead title="Employees — Core HR"
                sub="Employee master, grades, documents and lifecycle" action={add} />

      {rows.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-line bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                  <th className="p-3 font-semibold">Employee</th>
                  <th className="p-3 font-semibold">Code</th>
                  <th className="p-3 font-semibold">Department</th>
                  <th className="p-3 font-semibold">Designation</th>
                  <th className="p-3 font-semibold">Location</th>
                  <th className="p-3 font-semibold">Joined</th>
                  <th className="p-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-slate-line2 last:border-0 hover:bg-slate-surface">
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={e.full_name} />
                        <span>
                          <b className="block font-semibold text-ink">{e.full_name}</b>
                          <span className="text-[11px] text-slate-muted">{e.work_email ?? ''}</span>
                        </span>
                      </div>
                    </td>
                    <td className="p-3 font-mono text-xs text-slate-muted">{e.employee_code}</td>
                    <td className="p-3">{e.departments?.name ?? '—'}</td>
                    <td className="p-3">{e.designations?.name ?? '—'}</td>
                    <td className="p-3 text-slate-muted">
                      {e.locations?.name ?? '—'}
                      {e.locations?.state_code ? ` · ${e.locations.state_code}` : ''}
                    </td>
                    <td className="p-3 text-slate-muted">{dateLabel(e.doj)}</td>
                    <td className="p-3">
                      <span className={`badge ${STATUS_CLASS[e.status] ?? ''}`}>{e.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState icon="users" title="No employees yet"
                    body="Add your first employee to get started. Seats are enforced against your licence, so a new record is blocked once the seat count is reached."
                    action={add} />
      )}

      <p className="mt-4 text-xs text-slate-muted">
        Personal details and statutory identifiers live in separate tables with stricter access
        rules. A colleague sees the directory; only HR with the sensitive-data permission, and the
        employee themselves, see the rest.
      </p>
    </CustomerShell>
  );
}
