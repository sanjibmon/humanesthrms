import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerShell, getViewer } from '@/components/customer-shell';
import { PageHead } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { RunDetail, type RunHeader, type ItemRow, type AdjRow } from '@/components/payroll/run-detail';

export const dynamic = 'force-dynamic';

export default async function PayRunPage({ params }: { params: { id: string } }) {
  const v = await getViewer();
  const supabase = createClient();
  const org = v.orgId ?? '';

  const { data: run } = await supabase
    .from('pay_runs')
    .select('id,org_id,entity_id,period_month,run_type,status,totals,engine_version,computed_at,approved_at,locked_at,paid_at')
    .eq('id', params.id)
    .maybeSingle();

  if (!run) notFound();

  const [{ data: items }, { data: adj }, { data: entity }, { count: published }, { data: staff }] =
    await Promise.all([
      supabase
        .from('pay_run_items')
        .select('id,employee_id,paid_days,lop_days,gross,total_deductions,net,employer_cost,pf_employee,esi_employee,pt,tds,hold,hold_reason,payload')
        .eq('run_id', params.id),
      supabase
        .from('pay_adjustments')
        .select('id,employee_id,kind,description,amount,status')
        .eq('org_id', org)
        .eq('period_month', (run as any).period_month)
        .order('created_at', { ascending: false }),
      (run as any).entity_id
        ? supabase.from('legal_entities').select('name').eq('id', (run as any).entity_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('payslips').select('id', { count: 'exact', head: true }).eq('run_id', params.id),
      supabase
        .from('employees')
        .select('id,full_name,employee_code,status')
        .eq('org_id', org)
        .eq('status', 'active')
        .order('full_name'),
    ]);

  const empById = new Map(((staff ?? []) as any[]).map((e) => [e.id as string, e]));
  const nameOf = (id: string) => empById.get(id)?.full_name ?? 'Employee';
  const codeOf = (id: string) => empById.get(id)?.employee_code ?? '—';

  /* Sorted by net descending so the largest payments — the ones worth a second
     look before approval — are the first thing on screen. */
  const rows = ((items ?? []) as any[])
    .map((i) => ({ ...i, employee_name: nameOf(i.employee_id), employee_code: codeOf(i.employee_id) }))
    .sort((a, b) => Number(b.net) - Number(a.net)) as ItemRow[];

  const header: RunHeader = {
    id: (run as any).id,
    period_month: (run as any).period_month,
    run_type: (run as any).run_type,
    status: (run as any).status,
    entity_name: ((entity as any)?.name ?? null) as string | null,
    totals: (run as any).totals,
    engine_version: (run as any).engine_version,
    computed_at: (run as any).computed_at,
    approved_at: (run as any).approved_at,
    locked_at: (run as any).locked_at,
    paid_at: (run as any).paid_at,
    published_count: published ?? 0,
  };

  return (
    <CustomerShell current="/payroll">
      <PageHead
        title={`Pay run · ${header.period_month}`}
        sub="Register, statutory deductions and the approval chain"
        action={
          <Link href="/payroll" className="btn">
            All runs
          </Link>
        }
      />
      <RunDetail
        run={header}
        items={rows}
        adjustments={
          ((adj ?? []) as any[]).map((a) => ({ ...a, employee_name: nameOf(a.employee_id) })) as AdjRow[]
        }
        employees={((staff ?? []) as any[]).map((e) => ({
          value: e.id,
          label: `${e.full_name} (${e.employee_code})`,
        }))}
        caps={{ run: v.can('payroll.run'), approve: v.can('payroll.approve'), pay: v.can('payroll.pay') }}
      />
    </CustomerShell>
  );
}
