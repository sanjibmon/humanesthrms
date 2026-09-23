import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { inr, inrShort, dateLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Lic = {
  seats_total: number;
  seats_used: number;
  plans: { code: string; name: string; price_per_seat_paise: number } | null;
};
type Org = {
  id: string; name: string; status: string; created_at: string; converted_at: string | null;
  trial_ends_at: string | null; industry: string | null; organization_licenses: Lic | null;
};

function Bars({ data, total }: { data: { label: string; n: number; sub?: string }[]; total: number }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((d) => (
        <div key={d.label} className="grid grid-cols-[1fr_52px] items-center gap-3 text-xs">
          <div>
            <div className="mb-1 flex justify-between gap-2">
              <span className="font-semibold text-ink">{d.label}</span>
              {d.sub ? <span className="text-slate-muted">{d.sub}</span> : null}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-line">
              <i className="block h-full rounded-full bg-brand-grad-wide" style={{ width: `${Math.max(2, (d.n / max) * 100)}%` }} />
            </div>
          </div>
          <span className="text-right font-semibold tabular-nums">
            {d.n}
            {total ? <span className="ml-1 text-[10px] font-normal text-slate-faint">{Math.round((d.n / total) * 100)}%</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function ReportsPage() {
  const supabase = createClient();

  const [{ data: orgs }, { data: orgMods }, { data: modules }, { count: employees }] = await Promise.all([
    supabase
      .from('organizations')
      .select('id,name,status,created_at,converted_at,trial_ends_at,industry,organization_licenses(seats_total,seats_used,plans(code,name,price_per_seat_paise))')
      .order('created_at', { ascending: false }),
    supabase.from('organization_modules').select('module_code').eq('enabled', true),
    supabase.from('modules').select('code,name').order('sort_order'),
    supabase.from('employees').select('id', { count: 'exact', head: true }),
  ]);

  const rows = (orgs ?? []) as unknown as Org[];

  if (!rows.length) {
    return (
      <AdminShell current="/reports">
        <PageHead title="Reports & Analytics" sub="Revenue, adoption and the trial funnel" />
        <div className="card">
          <EmptyState
            icon="chart"
            title="Nothing to report yet"
            body="Every figure on this page is computed from live customer, licence and module rows. Create your first customer and the charts fill in — there is no sample data behind them."
          />
        </div>
      </AdminShell>
    );
  }

  const live = rows.filter((r) => r.status !== 'cancelled');
  const active = rows.filter((r) => r.status === 'active');
  const mrr = active.reduce(
    (a, r) => a + ((r.organization_licenses?.seats_total ?? 0) * (r.organization_licenses?.plans?.price_per_seat_paise ?? 0)) / 100,
    0,
  );
  const seatsSold = live.reduce((a, r) => a + (r.organization_licenses?.seats_total ?? 0), 0);
  const seatsUsed = live.reduce((a, r) => a + (r.organization_licenses?.seats_used ?? 0), 0);
  const arpa = active.length ? mrr / active.length : 0;

  const byStatus = ['trial', 'active', 'suspended', 'expired', 'cancelled'].map((s) => ({
    label: s,
    n: rows.filter((r) => r.status === s).length,
  }));

  const planNames = new Map<string, string>();
  for (const r of live) {
    const p = r.organization_licenses?.plans;
    if (p) planNames.set(p.code, p.name);
  }
  const byPlan = [...planNames.entries()].map(([code, name]) => {
    const mine = live.filter((r) => r.organization_licenses?.plans?.code === code);
    return {
      label: name,
      n: mine.length,
      sub: inrShort(
        mine
          .filter((r) => r.status === 'active')
          .reduce((a, r) => a + ((r.organization_licenses?.seats_total ?? 0) * (r.organization_licenses?.plans?.price_per_seat_paise ?? 0)) / 100, 0),
      ),
    };
  });

  const modName = new Map(((modules ?? []) as { code: string; name: string }[]).map((m) => [m.code, m.name]));
  const adoption = new Map<string, number>();
  for (const m of (orgMods ?? []) as { module_code: string }[]) {
    adoption.set(m.module_code, (adoption.get(m.module_code) ?? 0) + 1);
  }
  const byModule = [...adoption.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([code, n]) => ({ label: modName.get(code) ?? code, n }));

  const byIndustry = [...new Set(live.map((r) => r.industry).filter(Boolean))]
    .map((ind) => ({ label: String(ind), n: live.filter((r) => r.industry === ind).length }))
    .sort((a, b) => b.n - a.n);

  const everTrialled = rows.filter((r) => r.trial_ends_at || r.converted_at || r.status === 'trial');
  const converted = rows.filter((r) => r.converted_at);
  const funnel = [
    { label: 'Trials started', n: everTrialled.length },
    { label: 'Still evaluating', n: rows.filter((r) => r.status === 'trial').length },
    { label: 'Converted to paid', n: converted.length },
    { label: 'Lapsed without converting', n: rows.filter((r) => r.status === 'expired').length },
  ];

  return (
    <AdminShell current="/reports">
      <PageHead title="Reports & Analytics" sub="Computed live from customer, licence and module rows" />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="MRR" value={inrShort(mrr)} foot={`ARR ${inrShort(mrr * 12)}`} rupee accent="brand" />
        <Kpi label="Average Revenue / Customer" value={inr(arpa)} foot="Active customers only" rupee accent="leaf" />
        <Kpi label="Seat Utilisation" value={seatsSold ? `${Math.round((seatsUsed / seatsSold) * 100)}%` : '—'} foot={`${seatsUsed} of ${seatsSold} seats`} icon="target" accent="amber" />
        <Kpi label="Employees On Platform" value={(employees ?? 0).toLocaleString('en-IN')} foot="Across every customer" icon="users" accent="slate" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="text-sm">Customers by status</h3>
          <p className="mb-3.5 text-xs text-slate-muted">Where every account sits today</p>
          <Bars data={byStatus} total={rows.length} />
        </div>

        <div className="card">
          <h3 className="text-sm">Plan mix</h3>
          <p className="mb-3.5 text-xs text-slate-muted">Customers per plan, with the revenue each carries</p>
          {byPlan.length ? <Bars data={byPlan} total={live.length} /> : <p className="text-[13px] text-slate-muted">No licences yet.</p>}
        </div>

        <div className="card">
          <h3 className="text-sm">Trial funnel</h3>
          <p className="mb-3.5 text-xs text-slate-muted">
            {everTrialled.length ? `${Math.round((converted.length / everTrialled.length) * 100)}% of trials converted` : 'No trials yet'}
          </p>
          <Bars data={funnel} total={everTrialled.length} />
        </div>

        <div className="card">
          <h3 className="text-sm">Module adoption</h3>
          <p className="mb-3.5 text-xs text-slate-muted">How many customers have each module switched on</p>
          {byModule.length ? <Bars data={byModule} total={live.length} /> : <p className="text-[13px] text-slate-muted">No modules enabled yet.</p>}
        </div>
      </div>

      {byIndustry.length ? (
        <div className="mb-5 card">
          <h3 className="text-sm">Industry mix</h3>
          <p className="mb-3.5 text-xs text-slate-muted">Useful for deciding which vertical to build for next</p>
          <Bars data={byIndustry} total={live.length} />
        </div>
      ) : null}

      <div className="card">
        <h3 className="mb-3.5 text-sm">Newest customers</h3>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Plan</th>
                <th className="text-right">Seats</th>
                <th className="text-right">MRR</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((r) => {
                const lic = r.organization_licenses;
                const rowMrr = ((lic?.seats_total ?? 0) * (lic?.plans?.price_per_seat_paise ?? 0)) / 100;
                return (
                  <tr key={r.id}>
                    <td className="font-semibold text-ink">{r.name}</td>
                    <td>
                      <span className="badge">{r.status}</span>
                    </td>
                    <td>{lic?.plans?.name ?? '—'}</td>
                    <td className="text-right tabular-nums">
                      {lic?.seats_used ?? 0}/{lic?.seats_total ?? 0}
                    </td>
                    <td className="text-right font-semibold tabular-nums">
                      {r.status === 'active' ? inr(rowMrr) : '—'}
                    </td>
                    <td className="text-slate-muted">{dateLabel(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
