import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi } from '@/components/shell';
import { CustomerConsole, type CustomerRow, type PlanRow } from '@/components/customers/customer-console';
import { createClient } from '@/lib/supabase/server';
import { getPlatformIdentity, can } from '@/lib/guard';
import { inrShort } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Raw = {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string | null;
  status: string;
  industry: string | null;
  pan: string | null;
  tan: string | null;
  gstin: string | null;
  trial_ends_at: string | null;
  trial_extended_count: number | null;
  created_at: string;
  organization_licenses: {
    seats_total: number;
    seats_used: number;
    plans: { code: string; name: string; price_per_seat_paise: number } | null;
  } | null;
};

export default async function CustomersPage() {
  const supabase = createClient();
  const me = await getPlatformIdentity();

  const [{ data: orgs }, { data: plans }] = await Promise.all([
    supabase
      .from('organizations')
      .select(
        'id,name,legal_name,slug,status,industry,pan,tan,gstin,trial_ends_at,trial_extended_count,created_at,' +
          'organization_licenses(seats_total,seats_used,plans(code,name,price_per_seat_paise))',
      )
      .order('created_at', { ascending: false }),
    supabase.from('plans').select('code,name,price_per_seat_paise,max_seats').eq('is_active', true).order('price_per_seat_paise'),
  ]);

  const rows: CustomerRow[] = ((orgs ?? []) as unknown as Raw[]).map((o) => ({
    id: o.id,
    name: o.name,
    legal_name: o.legal_name,
    slug: o.slug,
    status: o.status,
    industry: o.industry,
    pan: o.pan,
    tan: o.tan,
    gstin: o.gstin,
    trial_ends_at: o.trial_ends_at,
    trial_extended_count: o.trial_extended_count ?? 0,
    created_at: o.created_at,
    seats_total: o.organization_licenses?.seats_total ?? 0,
    seats_used: o.organization_licenses?.seats_used ?? 0,
    plan_code: o.organization_licenses?.plans?.code ?? null,
    plan_name: o.organization_licenses?.plans?.name ?? null,
    price_per_seat_paise: o.organization_licenses?.plans?.price_per_seat_paise ?? 0,
  }));

  const live = rows.filter((r) => r.status !== 'cancelled');
  const mrr = rows
    .filter((r) => r.status === 'active')
    .reduce((a, r) => a + (r.seats_total * r.price_per_seat_paise) / 100, 0);

  return (
    <AdminShell current="/customers">
      <PageHead title="Customer Management" sub="Every organisation on the platform, and its whole lifecycle" />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Customers" value={live.length} foot="Excluding cancelled" icon="building" accent="brand" />
        <Kpi label="On Trial" value={live.filter((r) => r.status === 'trial').length} foot="Live evaluations" icon="clock" accent="amber" />
        <Kpi label="Paying" value={live.filter((r) => r.status === 'active').length} foot="Active licences" icon="checkcircle" accent="leaf" />
        <Kpi label="MRR" value={inrShort(mrr)} foot="Billed on active seats" rupee accent="slate" />
      </div>

      <CustomerConsole
        rows={rows}
        plans={(plans ?? []) as PlanRow[]}
        canWrite={can(me, 'manage_customers')}
      />
    </AdminShell>
  );
}
