import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { AssetList, type AllocationRow } from '@/components/ess/asset-list';

export const dynamic = 'force-dynamic';

export default async function MyAssetsPage() {
  const v = await getViewer();
  const supabase = createClient();
  const me = v.employeeId;

  if (!me) {
    return (
      <CustomerShell current="/me/assets">
        <PageHead title="My Assets" sub="Company property issued to you" />
        <EmptyState
          icon="laptop"
          title="This sign-in is not linked to an employee record"
          body="Assets are issued to an employee. This login administers the organisation instead."
        />
      </CustomerShell>
    );
  }

  const { data } = await supabase
    .from('asset_allocations')
    .select('id,asset_id,allocated_on,returned_on,condition_out,condition_in,acknowledged_at')
    .eq('employee_id', me)
    .order('allocated_on', { ascending: false });

  const allocs = (data ?? []) as any[];
  const { data: assets } = allocs.length
    ? await supabase
        .from('assets')
        .select('id,asset_tag,name,category,serial_no')
        .in('id', allocs.map((a) => a.asset_id))
    : { data: [] as unknown[] };

  const assetById = new Map(((assets ?? []) as any[]).map((a) => [a.id as string, a]));

  const rows: AllocationRow[] = allocs.map((a) => {
    const asset = assetById.get(a.asset_id);
    return {
      id: a.id,
      name: asset?.name ?? 'Asset',
      asset_tag: asset?.asset_tag ?? null,
      category: asset?.category ?? null,
      serial_no: asset?.serial_no ?? null,
      allocated_on: a.allocated_on,
      returned_on: a.returned_on,
      condition_out: a.condition_out,
      condition_in: a.condition_in,
      acknowledged_at: a.acknowledged_at,
    };
  });

  return (
    <CustomerShell current="/me/assets">
      <PageHead title="My Assets" sub="Company property issued to you" />
      <EssBanner />
      <AssetList rows={rows} />
      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        Acknowledging an asset is the one change you can make to these records — it is your
        confirmation that you received it in the stated condition, and it is timestamped.
        Everything else is maintained by whoever manages assets.
      </p>
    </CustomerShell>
  );
}
