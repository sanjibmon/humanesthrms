import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { dateLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function MyPayrollPage() {
  const v = await getViewer();
  const supabase = createClient();

  // Scoped to the signed-in employee. Row level security blocks anyone else's payslips
  // even if this filter were removed.
  const { data } = await supabase
    .from('payslips')
    .select('id,period_month,published_at')
    .eq('employee_id', v.employeeId ?? '')
    .order('period_month', { ascending: false });
  const slips = (data ?? []) as any[];

  return (
    <CustomerShell current="/me/payroll">
      <PageHead title="My Payroll" sub="Your payslips, salary structure and tax" />
      <EssBanner />

      {slips.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-line bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                  <th className="p-3 font-semibold">Period</th>
                  <th className="p-3 font-semibold">Published</th>
                  <th className="p-3 text-right font-semibold">Payslip</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id} className="border-b border-slate-line2 last:border-0 hover:bg-slate-surface">
                    <td className="p-3 font-semibold text-ink">{s.period_month}</td>
                    <td className="p-3 text-slate-muted">{dateLabel(s.published_at)}</td>
                    <td className="p-3 text-right">
                      <button className="btn h-8 text-xs">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState icon="target" title="No payslips yet"
                    body="Payslips appear here once your organisation locks a payroll run and publishes them. Every amount is shown in Indian Rupees." />
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        You can only view your own payroll data. Other employees&rsquo; payroll is blocked from this
        portal by row level security, not merely hidden from the menu.
      </p>
    </CustomerShell>
  );
}
