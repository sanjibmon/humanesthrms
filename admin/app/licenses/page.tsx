import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi } from '@/components/shell';
import { PlanConsole, type PlanFull, type ModuleLite } from '@/components/platform/plan-console';
import { createClient } from '@/lib/supabase/server';
import { getPlatformIdentity, can } from '@/lib/guard';
import { inrShort } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function LicensesPage() {
  const supabase = createClient();
  const me = await getPlatformIdentity();

  const [{ data: plans }, { data: modules }, { data: pm }, { data: licences }] = await Promise.all([
    supabase.from('plans').select('id,code,name,price_per_seat_paise,max_seats,is_active').order('price_per_seat_paise'),
    supabase.from('modules').select('code,name,is_core,sort_order').order('sort_order'),
    supabase.from('plan_modules').select('plan_id,module_code'),
    supabase.from('organization_licenses').select('plan_id,seats_total,seats_used,organizations(status)'),
  ]);

  const planRows = (plans ?? []) as {
    id: string; code: string; name: string; price_per_seat_paise: number; max_seats: number | null; is_active: boolean;
  }[];
  const byId = new Map(planRows.map((p) => [p.id, p.code]));

  const planModules: Record<string, string[]> = {};
  for (const row of (pm ?? []) as { plan_id: string; module_code: string }[]) {
    const code = byId.get(row.plan_id);
    if (!code) continue;
    (planModules[code] ??= []).push(row.module_code);
  }

  const licRows = (licences ?? []) as unknown as {
    plan_id: string; seats_total: number; seats_used: number; organizations: { status: string } | null;
  }[];

  const full: PlanFull[] = planRows.map((p) => {
    const mine = licRows.filter((l) => l.plan_id === p.id);
    return {
      code: p.code,
      name: p.name,
      price_per_seat_paise: p.price_per_seat_paise,
      max_seats: p.max_seats,
      is_active: p.is_active,
      customers: mine.length,
      seats: mine.reduce((a, l) => a + (l.seats_total ?? 0), 0),
    };
  });

  const seatsSold = licRows.reduce((a, l) => a + (l.seats_total ?? 0), 0);
  const seatsUsed = licRows.reduce((a, l) => a + (l.seats_used ?? 0), 0);
  const mrr = licRows
    .filter((l) => l.organizations?.status === 'active')
    .reduce((a, l) => {
      const p = planRows.find((x) => x.id === l.plan_id);
      return a + ((l.seats_total ?? 0) * (p?.price_per_seat_paise ?? 0)) / 100;
    }, 0);

  return (
    <AdminShell current="/licenses">
      <PageHead title="Licences & Plans" sub="What each plan costs, what it unlocks, and who is on it" />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Plans" value={full.length} foot={`${full.filter((p) => p.is_active).length} sellable`} icon="card" accent="brand" />
        <Kpi label="Seats Sold" value={seatsSold.toLocaleString('en-IN')} foot="Across every licence" icon="users" accent="amber" />
        <Kpi label="Seats In Use" value={seatsUsed.toLocaleString('en-IN')} foot={seatsSold ? `${Math.round((seatsUsed / seatsSold) * 100)}% utilisation` : 'No seats yet'} icon="target" accent="leaf" />
        <Kpi label="MRR" value={inrShort(mrr)} foot="Active customers only" rupee accent="slate" />
      </div>

      <PlanConsole
        plans={full}
        modules={(modules ?? []) as ModuleLite[]}
        planModules={planModules}
        canWrite={can(me, 'manage_licenses')}
      />
    </AdminShell>
  );
}
