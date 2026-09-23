import Link from 'next/link';
import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi, EmptyState, Avatar } from '@/components/shell';
import { Icon } from '@/components/icon';
import { createClient } from '@/lib/supabase/server';
import { inrShort, inr, dateLabel, daysLeft } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Customer = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  trial_ends_at: string | null;
  created_at: string;
  organization_licenses:
    | { seats_total: number; seats_used: number; plans: { code: string; price_per_seat_paise: number } | null }
    | null;
};

function daysBadge(n: number | null) {
  if (n === null) return <span className="text-slate-muted">&mdash;</span>;
  const cls = n < 3 ? 'bg-red-50 text-red-700' : n < 7 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-50 text-green-700';
  return <span className={`badge ${cls}`}>{n < 0 ? 'Expired' : `${n} days left`}</span>;
}

export default async function Dashboard() {
  const supabase = createClient();

  const { data } = await supabase
    .from('organizations')
    .select('id,name,slug,status,trial_ends_at,created_at,organization_licenses(seats_total,seats_used,plans(code,price_per_seat_paise))')
    .order('created_at', { ascending: false });

  const customers = (data ?? []) as unknown as Customer[];
  const live = customers.filter((c) => c.status !== 'cancelled');
  const seatsSold = live.reduce((a, c) => a + (c.organization_licenses?.seats_total ?? 0), 0);
  const seatsUsed = live.reduce((a, c) => a + (c.organization_licenses?.seats_used ?? 0), 0);
  const util = seatsSold ? Math.round((seatsUsed / seatsSold) * 100) : 0;
  const trials = live.filter((c) => c.status === 'trial');
  const mrr = live
    .filter((c) => c.status === 'active')
    .reduce(
      (a, c) =>
        a +
        ((c.organization_licenses?.seats_total ?? 0) *
          (c.organization_licenses?.plans?.price_per_seat_paise ?? 0)) /
          100,
      0,
    );

  const expiring = trials
    .filter((c) => c.trial_ends_at)
    .sort((a, b) => Date.parse(a.trial_ends_at!) - Date.parse(b.trial_ends_at!));

  const topBySeats = [...live]
    .sort(
      (a, b) =>
        (b.organization_licenses?.seats_total ?? 0) - (a.organization_licenses?.seats_total ?? 0),
    )
    .slice(0, 10);
  const maxSeats = Math.max(1, ...topBySeats.map((c) => c.organization_licenses?.seats_total ?? 0));

  const addCustomer = (
    <Link href="/customers" className="btn btn-primary">
      <Icon name="plus" size={16} />
      Add Customer
    </Link>
  );

  return (
    <AdminShell current="/dashboard">
      <PageHead title="Dashboard" sub="Overview of your platform — customers, licenses, revenue" />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Customers" value={live.length}
             foot={live.length ? 'Active, trial and suspended' : 'No customers yet'}
             icon="building" accent="brand" />
        <Kpi label="Licensed Users" value={seatsSold.toLocaleString('en-IN')} foot="Seats sold"
             icon="users" accent="amber" />
        <Kpi label="Active Users" value={seatsUsed.toLocaleString('en-IN')} foot="Seats in use"
             icon="user" accent="slate" />
        <Kpi label="Utilization" value={`${util}%`} foot="Used of licensed" icon="target" accent="leaf" />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="MRR" value={inrShort(mrr)} foot="Billed on active seats" rupee accent="brand" />
        <Kpi label="Trial Active" value={trials.length} foot="Live evaluations" icon="clock" accent="amber" />
        <Kpi label="Suspended" value={live.filter((c) => c.status === 'suspended').length}
             foot="Logins blocked" icon="pause" accent="slate" />
        <Kpi label="Conversion Rate"
             value={`${live.length ? Math.round((live.filter((c) => c.status === 'active').length / live.length) * 100) : 0}%`}
             foot="Trial to paid" icon="trending" accent="leaf" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="text-sm">Top 10 Customers by Users</h3>
          <p className="mb-3.5 text-xs text-slate-muted">Ranked by licensed seats</p>
          {topBySeats.length ? (
            <div className="flex flex-col gap-2">
              {topBySeats.map((c, i) => {
                const seats = c.organization_licenses?.seats_total ?? 0;
                return (
                  <div key={c.id} className="grid grid-cols-[18px_1fr_56px] items-center gap-2.5 text-xs">
                    <span className="text-[11px] font-bold text-slate-faint">{i + 1}</span>
                    <div>
                      <div className="mb-1 flex justify-between gap-2">
                        <span className="font-semibold text-ink">{c.name}</span>
                        <span className="text-slate-muted">{c.slug ?? ''}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-line">
                        <i className="block h-full rounded-full bg-brand-grad-wide"
                           style={{ width: `${Math.max(3, (seats / maxSeats) * 100)}%` }} />
                      </div>
                    </div>
                    <span className="text-right font-semibold tabular-nums">{seats}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon="building" title="No customers yet"
                        body="Create your first customer and this chart fills in."
                        action={addCustomer} />
          )}
        </div>

        <div className="card">
          <h3 className="text-sm">Trials Expiring Soon</h3>
          <p className="mb-3.5 text-xs text-slate-muted">Act before access lapses</p>
          {expiring.length ? (
            <div className="flex flex-col divide-y divide-slate-line2">
              {expiring.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-semibold text-ink">{c.name}</b>
                    <span className="text-[11px] text-slate-muted">
                      Ends {dateLabel(c.trial_ends_at)}
                    </span>
                  </div>
                  {daysBadge(daysLeft(c.trial_ends_at))}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="clock" title="No trials expiring"
                        body="Trials you create will show here as their end date approaches."
                        action={
                          <Link href="/trials" className="btn btn-primary">
                            <Icon name="plus" size={16} />Create Trial
                          </Link>
                        } />
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3.5 text-sm">Recent Customers</h3>
        {live.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-surface text-left text-xs uppercase tracking-wide text-slate-muted">
                  <th className="p-3 font-semibold">Company</th>
                  <th className="p-3 font-semibold">Plan</th>
                  <th className="p-3 font-semibold">Seats</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 text-right font-semibold">MRR</th>
                  <th className="p-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {live.slice(0, 10).map((c) => {
                  const lic = c.organization_licenses;
                  const rowMrr = ((lic?.seats_total ?? 0) * (lic?.plans?.price_per_seat_paise ?? 0)) / 100;
                  return (
                    <tr key={c.id} className="border-b border-slate-line2 last:border-0 hover:bg-slate-surface">
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={c.name} />
                          <span>
                            <b className="block font-semibold text-ink">{c.name}</b>
                            <span className="text-[11px] text-slate-muted">{c.slug ?? ''}</span>
                          </span>
                        </div>
                      </td>
                      <td className="p-3"><span className="badge">{lic?.plans?.code ?? '—'}</span></td>
                      <td className="p-3 tabular-nums">{lic?.seats_used ?? 0}/{lic?.seats_total ?? 0}</td>
                      <td className="p-3"><span className="badge">{c.status}</span></td>
                      <td className="p-3 text-right font-semibold tabular-nums">
                        {c.status === 'trial' ? '—' : inr(rowMrr)}
                      </td>
                      <td className="p-3 text-slate-muted">{dateLabel(c.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="building" title="No customers yet"
                      body="Create your first customer to get started." action={addCustomer} />
        )}
      </div>
    </AdminShell>
  );
}
