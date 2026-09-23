import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi } from '@/components/shell';
import { CustomerConsole, type CustomerRow, type PlanRow } from '@/components/customers/customer-console';
import { createClient } from '@/lib/supabase/server';
import { getPlatformIdentity, can } from '@/lib/guard';
import { daysLeft } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Raw = {
  id: string; name: string; legal_name: string | null; slug: string | null; status: string;
  industry: string | null; pan: string | null; tan: string | null; gstin: string | null;
  trial_ends_at: string | null; trial_extended_count: number | null; converted_at: string | null;
  non_conversion_reason: string | null; created_at: string;
  organization_licenses: {
    seats_total: number; seats_used: number;
    plans: { code: string; name: string; price_per_seat_paise: number } | null;
  } | null;
};

export default async function TrialsPage() {
  const supabase = createClient();
  const me = await getPlatformIdentity();

  const [{ data: orgs }, { data: plans }] = await Promise.all([
    supabase
      .from('organizations')
      .select(
        'id,name,legal_name,slug,status,industry,pan,tan,gstin,trial_ends_at,trial_extended_count,converted_at,non_conversion_reason,created_at,' +
          'organization_licenses(seats_total,seats_used,plans(code,name,price_per_seat_paise))',
      )
      .order('trial_ends_at', { ascending: true }),
    supabase.from('plans').select('code,name,price_per_seat_paise,max_seats').eq('is_active', true).order('price_per_seat_paise'),
  ]);

  const all = (orgs ?? []) as unknown as Raw[];
  const map = (o: Raw): CustomerRow => ({
    id: o.id, name: o.name, legal_name: o.legal_name, slug: o.slug, status: o.status,
    industry: o.industry, pan: o.pan, tan: o.tan, gstin: o.gstin,
    trial_ends_at: o.trial_ends_at, trial_extended_count: o.trial_extended_count ?? 0,
    created_at: o.created_at,
    seats_total: o.organization_licenses?.seats_total ?? 0,
    seats_used: o.organization_licenses?.seats_used ?? 0,
    plan_code: o.organization_licenses?.plans?.code ?? null,
    plan_name: o.organization_licenses?.plans?.name ?? null,
    price_per_seat_paise: o.organization_licenses?.plans?.price_per_seat_paise ?? 0,
  });

  const trials = all.filter((o) => o.status === 'trial');
  const converted = all.filter((o) => o.converted_at);
  const lapsed = all.filter((o) => o.status === 'expired');
  const everTrialled = all.filter((o) => o.trial_ends_at || o.converted_at || o.status === 'trial');

  const endingSoon = trials.filter((o) => {
    const d = daysLeft(o.trial_ends_at);
    return d !== null && d >= 0 && d <= 7;
  });
  const lapsedNow = trials.filter((o) => {
    const d = daysLeft(o.trial_ends_at);
    return d !== null && d < 0;
  });

  const rate = everTrialled.length ? Math.round((converted.length / everTrialled.length) * 100) : 0;

  return (
    <AdminShell current="/trials">
      <PageHead title="Trial Management" sub="Every evaluation, how long it has left, and what happened to it" />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Live Trials" value={trials.length} foot={trials.length ? 'Being evaluated now' : 'None running'} icon="clock" accent="amber" />
        <Kpi label="Ending Within 7 Days" value={endingSoon.length} foot="Worth a call today" icon="alert" accent="brand" />
        <Kpi label="Already Lapsed" value={lapsedNow.length} foot="Past their end date, still on trial" icon="pause" accent="slate" />
        <Kpi label="Conversion Rate" value={`${rate}%`} foot={`${converted.length} converted, ${lapsed.length} lost`} icon="trending" accent="leaf" />
      </div>

      {lapsedNow.length ? (
        <div className="mb-5 flex gap-3 rounded-xl bg-amber-bg px-4 py-3.5 text-[13px] leading-relaxed text-amber-text">
          <span>
            <b>
              {lapsedNow.length} trial{lapsedNow.length > 1 ? 's are' : ' is'} past the end date but still
              marked trial.
            </b>{' '}
            Nothing expires on its own — convert them, extend them, or mark them expired so the
            conversion numbers stay honest.
          </span>
        </div>
      ) : null}

      <CustomerConsole
        rows={trials.map(map)}
        plans={(plans ?? []) as PlanRow[]}
        canWrite={can(me, 'manage_customers')}
      />

      {converted.length || lapsed.length ? (
        <div className="mt-5">
          <h3 className="mb-3 text-sm">Finished evaluations</h3>
          <CustomerConsole
            rows={[...converted, ...lapsed].filter((o) => o.status !== 'trial').map(map)}
            plans={(plans ?? []) as PlanRow[]}
            canWrite={can(me, 'manage_customers')}
          />
        </div>
      ) : null}
    </AdminShell>
  );
}
