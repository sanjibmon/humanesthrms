import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin-shell';
import { PageHead, Kpi, Avatar } from '@/components/shell';
import { Icon } from '@/components/icon';
import {
  ModulePanel,
  LicensePanel,
  MemberPanel,
  type ModuleRow,
  type MemberRow,
  type EmployeeChoice,
  type LicenseInfo,
} from '@/components/customers/customer-detail';
import { createClient } from '@/lib/supabase/server';
import { getPlatformIdentity, can } from '@/lib/guard';
import { dateLabel, daysLeft, inr } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<string, string> = {
  trial: 'bg-amber-bg text-amber-text',
  active: 'bg-leaf-soft text-leaf-text',
  suspended: 'bg-slate-line2 text-slate-muted',
  expired: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-line2 text-slate-faint',
};

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const me = await getPlatformIdentity();
  const orgId = params.id;

  const { data: org } = await supabase
    .from('organizations')
    .select(
      'id,name,legal_name,slug,status,status_reason,industry,pan,tan,gstin,timezone,data_region,' +
        'trial_started_at,trial_ends_at,trial_extended_count,converted_at,non_conversion_reason,created_at',
    )
    .eq('id', orgId)
    .maybeSingle();

  if (!org) notFound();
  const o = org as {
    id: string; name: string; legal_name: string | null; slug: string | null; status: string;
    status_reason: string | null; industry: string | null; pan: string | null; tan: string | null;
    gstin: string | null; timezone: string; data_region: string; trial_started_at: string | null;
    trial_ends_at: string | null; trial_extended_count: number | null; converted_at: string | null;
    non_conversion_reason: string | null; created_at: string;
  };

  const [{ data: lic }, { data: catalog }, { data: orgMods }, { data: plans }, { data: members }, { data: empChoices }, { count: headcount }] =
    await Promise.all([
      supabase
        .from('organization_licenses')
        .select('plan_id,seats_total,seats_used,billing_cycle,grace_days,block_over_allocation,custom_price_per_seat_paise,next_billing_at,plans(code,name,price_per_seat_paise)')
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase.from('modules').select('code,name,description,is_core,is_beta,depends_on,sort_order').order('sort_order'),
      supabase.from('organization_modules').select('module_code,enabled').eq('org_id', orgId),
      supabase.from('plans').select('code,name,price_per_seat_paise,max_seats').eq('is_active', true).order('price_per_seat_paise'),
      supabase.schema('api').rpc('list_org_members', { p_org: orgId }),
      supabase.schema('api').rpc('list_org_employee_choices', { p_org: orgId }),
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    ]);

  const licRow = lic as
    | { plan_id: string; seats_total: number; seats_used: number; billing_cycle: string; grace_days: number;
        block_over_allocation: boolean; custom_price_per_seat_paise: number | null; next_billing_at: string | null;
        plans: { code: string; name: string; price_per_seat_paise: number } | null }
    | null;

  const planCode = licRow?.plans?.code ?? '';
  const { data: planMods } = planCode
    ? await supabase
        .from('plan_modules')
        .select('module_code, plans!inner(code)')
        .eq('plans.code', planCode)
    : { data: [] as { module_code: string }[] };

  const inPlan = new Set(((planMods ?? []) as { module_code: string }[]).map((p) => p.module_code));
  const enabled = new Map(
    ((orgMods ?? []) as { module_code: string; enabled: boolean }[]).map((m) => [m.module_code, m.enabled]),
  );

  const modules: ModuleRow[] = ((catalog ?? []) as Omit<ModuleRow, 'enabled' | 'in_plan'>[]).map((m) => ({
    ...m,
    depends_on: m.depends_on ?? [],
    enabled: enabled.get(m.code) ?? false,
    in_plan: inPlan.has(m.code),
  }));

  const license: LicenseInfo | null = licRow
    ? {
        plan_code: licRow.plans?.code ?? '',
        seats_total: licRow.seats_total,
        seats_used: licRow.seats_used,
        billing_cycle: licRow.billing_cycle,
        grace_days: licRow.grace_days,
        block_over_allocation: licRow.block_over_allocation,
        custom_price_per_seat_paise: licRow.custom_price_per_seat_paise,
        next_billing_at: licRow.next_billing_at,
      }
    : null;

  const trialDays = o.status === 'trial' ? daysLeft(o.trial_ends_at) : null;
  const perSeat = licRow?.custom_price_per_seat_paise ?? licRow?.plans?.price_per_seat_paise ?? 0;
  const mrr = o.status === 'active' ? ((licRow?.seats_total ?? 0) * perSeat) / 100 : 0;

  return (
    <AdminShell current="/customers">
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-muted hover:text-brand-dark">
        <span className="rotate-180">
          <Icon name="arrowup" size={13} />
        </span>
        All customers
      </Link>

      <PageHead
        title={o.name}
        sub={[o.legal_name, o.industry, o.slug].filter(Boolean).join(' · ') || 'No further details recorded'}
        action={
          <span className="flex flex-wrap items-center gap-2">
            <span className={`badge ${STATUS_CLASS[o.status] ?? ''}`}>{o.status}</span>
            {trialDays !== null ? (
              <span className={`badge ${trialDays < 3 ? 'bg-red-50 text-red-700' : 'bg-amber-bg text-amber-text'}`}>
                {trialDays < 0 ? 'lapsed' : `${trialDays} days left`}
              </span>
            ) : null}
          </span>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Employees" value={headcount ?? 0} foot={`of ${license?.seats_total ?? 0} seats`} icon="users" accent="brand" />
        <Kpi label="Modules On" value={modules.filter((m) => m.enabled).length} foot={`of ${modules.length} in the catalog`} icon="puzzle" accent="leaf" />
        <Kpi label="MRR" value={inr(mrr)} foot={o.status === 'active' ? 'Billed monthly' : 'Not billing yet'} rupee accent="amber" />
        <Kpi label="Customer Since" value={dateLabel(o.created_at)} foot={o.converted_at ? `Converted ${dateLabel(o.converted_at)}` : 'Not converted'} icon="calendar" accent="slate" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <ModulePanel
            orgId={orgId}
            modules={modules}
            canEdit={can(me, 'edit_modules')}
            canSync={can(me, 'manage_customers')}
          />

          <MemberPanel
            orgId={orgId}
            members={(members ?? []) as MemberRow[]}
            employees={(empChoices ?? []) as EmployeeChoice[]}
            canEdit={can(me, 'manage_customers')}
          />
        </div>

        <div className="flex flex-col gap-4">
          <LicensePanel
            orgId={orgId}
            license={license}
            plans={(plans ?? []) as { code: string; name: string; price_per_seat_paise: number; max_seats: number | null }[]}
            canEdit={can(me, 'manage_licenses')}
          />

          <div className="card">
            <h3 className="mb-3 text-sm">Registration</h3>
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2 text-[13px]">
              <dt className="text-xs text-slate-muted">PAN</dt>
              <dd className="font-mono font-medium text-ink">{o.pan ?? '—'}</dd>
              <dt className="text-xs text-slate-muted">TAN</dt>
              <dd className="font-mono font-medium text-ink">{o.tan ?? '—'}</dd>
              <dt className="text-xs text-slate-muted">GSTIN</dt>
              <dd className="font-mono font-medium text-ink">{o.gstin ?? '—'}</dd>
              <dt className="text-xs text-slate-muted">Timezone</dt>
              <dd className="font-medium text-ink">{o.timezone}</dd>
              <dt className="text-xs text-slate-muted">Data region</dt>
              <dd className="font-medium text-ink">{o.data_region}</dd>
            </dl>
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm">Lifecycle</h3>
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2 text-[13px]">
              <dt className="text-xs text-slate-muted">Trial started</dt>
              <dd className="font-medium text-ink">{dateLabel(o.trial_started_at)}</dd>
              <dt className="text-xs text-slate-muted">Trial ends</dt>
              <dd className="font-medium text-ink">{dateLabel(o.trial_ends_at)}</dd>
              <dt className="text-xs text-slate-muted">Extensions</dt>
              <dd className="font-medium tabular-nums text-ink">{o.trial_extended_count ?? 0}</dd>
              <dt className="text-xs text-slate-muted">Converted</dt>
              <dd className="font-medium text-ink">{dateLabel(o.converted_at)}</dd>
            </dl>
            {o.status_reason || o.non_conversion_reason ? (
              <p className="mt-3 rounded-xl bg-slate-surface px-3 py-2.5 text-[12px] leading-relaxed text-slate-body">
                {o.non_conversion_reason ?? o.status_reason}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
