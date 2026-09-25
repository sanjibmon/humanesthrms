import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState, Kpi } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { dateLabel, inr } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function MyPayrollPage() {
  const v = await getViewer();
  const supabase = createClient();
  const me = v.employeeId;

  if (!me) {
    return (
      <CustomerShell current="/me/payroll">
        <PageHead title="My Payroll" sub="Your payslips and what makes them up" />
        <EmptyState
          icon="file"
          title="This sign-in is not linked to an employee record"
          body="Payslips belong to an employee. This login administers the organisation instead."
        />
      </CustomerShell>
    );
  }

  /* payslips_select lets an employee read their own slips; pay_run_items has the
     figures. Both are scoped by row level security, so the filters below are the
     query rather than the protection. */
  const [{ data: slips }, { data: items }] = await Promise.all([
    supabase
      .from('payslips')
      .select('id,period_month,published_at,run_id')
      .eq('employee_id', me)
      .order('period_month', { ascending: false }),
    supabase
      .from('pay_run_items')
      .select('run_id,paid_days,lop_days,gross,total_deductions,net,pf_employee,esi_employee,pt,tds')
      .eq('employee_id', me),
  ]);

  const rows = (slips ?? []) as { id: string; period_month: string; published_at: string | null; run_id: string }[];
  const byRun = new Map(
    ((items ?? []) as any[]).map((i) => [i.run_id as string, i]),
  );
  const latest = rows[0] ? byRun.get(rows[0].run_id) : null;

  return (
    <CustomerShell current="/me/payroll">
      <PageHead title="My Payroll" sub="Your payslips and what makes them up" />
      <EssBanner />

      {latest ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Latest net pay" value={inr(Number(latest.net ?? 0))} foot={rows[0].period_month} rupee accent="leaf" />
          <Kpi label="Gross" value={inr(Number(latest.gross ?? 0))} foot="before deductions" rupee accent="brand" />
          <Kpi label="Deductions" value={inr(Number(latest.total_deductions ?? 0))} foot="PF, ESI, PT and TDS" rupee accent="amber" />
          <Kpi label="Paid days" value={String(latest.paid_days ?? '—')} foot={`${latest.lop_days ?? 0} loss of pay`} icon="calendar" accent="slate" />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="file"
          title="No payslips published yet"
          body="A payslip appears here once payroll has run for the month, been approved and published. Nothing is visible to you before it is published."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-line bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                  <th className="p-3 font-semibold">Month</th>
                  <th className="p-3 text-right font-semibold">Gross</th>
                  <th className="p-3 text-right font-semibold">PF</th>
                  <th className="p-3 text-right font-semibold">ESI</th>
                  <th className="p-3 text-right font-semibold">PT</th>
                  <th className="p-3 text-right font-semibold">TDS</th>
                  <th className="p-3 text-right font-semibold">Net</th>
                  <th className="p-3 font-semibold">Published</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const i = byRun.get(s.run_id);
                  const cell = (n: unknown) => (i ? inr(Number(n ?? 0)) : '—');
                  return (
                    <tr key={s.id} className="border-b border-slate-line2 last:border-0 hover:bg-slate-surface">
                      <td className="p-3 font-semibold text-ink">{s.period_month}</td>
                      <td className="p-3 text-right">{cell(i?.gross)}</td>
                      <td className="p-3 text-right text-slate-muted">{cell(i?.pf_employee)}</td>
                      <td className="p-3 text-right text-slate-muted">{cell(i?.esi_employee)}</td>
                      <td className="p-3 text-right text-slate-muted">{cell(i?.pt)}</td>
                      <td className="p-3 text-right text-slate-muted">{cell(i?.tds)}</td>
                      <td className="p-3 text-right font-semibold text-ink">{cell(i?.net)}</td>
                      <td className="p-3 text-slate-muted">
                        {s.published_at ? dateLabel(s.published_at) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        Every figure comes from the payroll run that produced it, not from a recalculation, so a
        payslip you opened last year still shows exactly what was paid. PDF download arrives with
        the payroll module.
      </p>
    </CustomerShell>
  );
}
