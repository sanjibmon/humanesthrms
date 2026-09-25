import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead, Kpi, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';
import { createClient } from '@/lib/supabase/server';
import { inr, inrShort, dateLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-line2 text-slate-muted',
  computed: 'bg-brand-soft text-brand-dark',
  approved: 'bg-amber-bg text-amber-text',
  locked: 'bg-violet-50 text-violet-700',
  paid: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};

export default async function PayrollPage() {
  const v = await getViewer();
  const supabase = createClient();

  const [{ data: runs }, { data: structures }, { data: rules }] = await Promise.all([
    supabase.from('pay_runs').select('id,period_month,run_type,status,totals,created_at')
      .eq('org_id', v.orgId ?? '').order('period_month', { ascending: false }).limit(12),
    supabase.from('salary_structures').select('id,code,name').eq('org_id', v.orgId ?? ''),
    supabase.from('statutory_rules').select('rule_key,value,status,effective_from,source')
      .in('rule_key', ['pf.wageCeiling', 'esi.wageCeiling', 'pf.employeeRate', 'esi.employeeRate'])
      .order('effective_from', { ascending: false }),
  ]);

  const rows = (runs ?? []) as any[];
  const latest = rows[0];
  const t = latest?.totals ?? {};
  const announced = (rules ?? []).find((r: any) => r.status === 'announced');

  return (
    <CustomerShell current="/payroll">
      <PageHead title="Payroll — India"
                sub="Grades, components, statutory compliance and pay runs"
                action={
                  <button className="btn btn-primary">
                    <Icon name="plus" size={16} />
                    Create Payroll Run
                  </button>
                } />

      {announced ? (
        <div className="mb-5 flex gap-2.5 rounded-xl bg-amber-bg px-3.5 py-3 text-[13px] leading-relaxed text-amber-text">
          <span className="shrink-0"><Icon name="alert" size={18} /></span>
          <span>
            <b>EPFO wage ceiling of {inr(Number(announced.value))} is announced, not yet in force.</b>{' '}
            Payroll keeps using the in-force ceiling until the Gazette notification gives an
            effective date. Source: {announced.source}
          </span>
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Payout" value={latest ? inrShort(Number(t.net ?? 0)) : '₹0'}
             foot={latest?.period_month ?? 'No run yet'} rupee accent="brand" />
        <Kpi label="Employee PF" value={latest ? inrShort(Number(t.employeePf ?? 0)) : '₹0'}
             foot="12% of basic" icon="shieldcheck" accent="amber" />
        <Kpi label="TDS" value={latest ? inrShort(Number(t.tds ?? 0)) : '₹0'}
             foot="Deducted at source" icon="receipt" accent="slate" />
        <Kpi label="Salary Structures" value={structures?.length ?? 0}
             foot="Grade templates" icon="file" accent="leaf" />
      </div>

      {rows.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-line bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                  <th className="p-3 font-semibold">Month</th>
                  <th className="p-3 font-semibold">Type</th>
                  <th className="p-3 text-right font-semibold">Employees</th>
                  <th className="p-3 text-right font-semibold">Gross</th>
                  <th className="p-3 text-right font-semibold">Deductions</th>
                  <th className="p-3 text-right font-semibold">Net</th>
                  <th className="p-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-line2 last:border-0 hover:bg-slate-surface">
                    <td className="p-3 font-semibold text-ink">{r.period_month}</td>
                    <td className="p-3 text-slate-muted">{r.run_type}</td>
                    <td className="p-3 text-right tabular-nums">{r.totals?.employees ?? 0}</td>
                    <td className="p-3 text-right tabular-nums">{inr(Number(r.totals?.gross ?? 0))}</td>
                    <td className="p-3 text-right tabular-nums">{inr(Number(r.totals?.deductions ?? 0))}</td>
                    <td className="p-3 text-right font-bold tabular-nums">{inr(Number(r.totals?.net ?? 0))}</td>
                    <td className="p-3"><span className={`badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState icon="target" title="No payroll runs yet"
                    body="Create a run once employees have an approved salary structure and a work location. The location decides Professional Tax and Labour Welfare Fund, so payroll refuses to guess it."
                    action={
                      <button className="btn btn-primary">
                        <Icon name="plus" size={16} />
                        Create Payroll Run
                      </button>
                    } />
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm">Statutory parameters in force</h3>
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2 text-[13px]">
            {(rules ?? []).filter((r: any) => r.status === 'in_force').map((r: any) => (
              <div key={`${r.rule_key}-${r.effective_from}`} className="contents">
                <dt className="text-xs text-slate-muted">{r.rule_key}</dt>
                <dd className="font-medium tabular-nums text-ink">
                  {String(r.value)}{' '}
                  <span className="text-[11px] font-normal text-slate-muted">
                    from {dateLabel(r.effective_from)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-slate-muted">
            Rates are effective-dated data, not code. A change is published, not released.
          </p>
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm">Run lifecycle</h3>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {['Draft', 'Computed', 'Approved', 'Locked', 'Paid'].map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                {i ? <span className="text-slate-faint">&rarr;</span> : null}
                <span className="badge">{s}</span>
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-muted">
            Approval requires a different person from whoever computed the run, a locked run freezes
            the attendance it used, and every amount is shown in Indian Rupees.
          </p>
        </div>
      </div>
    </CustomerShell>
  );
}
