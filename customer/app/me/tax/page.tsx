import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { fyStartOf, fyLabel } from '@/lib/tax-sections';
import { openDeclaration, compareMyRegimes } from '@/app/actions/tax';
import { TaxConsole, type ItemRow, type DeclRow } from '@/components/ess/tax-console';

export const dynamic = 'force-dynamic';

export default async function MyTaxPage({ searchParams }: { searchParams: { fy?: string } }) {
  const v = await getViewer();
  const supabase = createClient();

  if (!v.employeeId) {
    return (
      <CustomerShell current="/me/tax">
        <PageHead title="My Tax" sub="Declarations, proofs and which regime costs you less" />
        <EmptyState
          icon="receipt"
          title="This sign-in is not linked to an employee record"
          body="A tax declaration belongs to an employee. HR links a login to an employee on that employee's page."
        />
      </CustomerShell>
    );
  }

  const asked = Number(searchParams.fy);
  const fy = Number.isInteger(asked) && asked >= 2020 && asked <= 2100 ? asked : fyStartOf();

  /* Opening the page opens the year. It is idempotent — a second visit returns
     the declaration that already exists rather than tripping the unique key. */
  await openDeclaration(fy);

  const [{ data: decl }, { data: stat }, { data: prior }] = await Promise.all([
    supabase
      .from('tax_declarations')
      .select('id,fy_start,regime,status,submitted_at,verified_at,tax_declaration_items(id,section,description,declared_amount,verified_amount,city,status)')
      .eq('employee_id', v.employeeId)
      .eq('fy_start', fy)
      .maybeSingle(),
    supabase.from('employee_statutory').select('tax_regime').eq('employee_id', v.employeeId).maybeSingle(),
    supabase
      .from('prior_employer_income')
      .select('income,tds')
      .eq('employee_id', v.employeeId)
      .eq('fy_start', fy)
      .maybeSingle(),
  ]);

  if (!decl) {
    return (
      <CustomerShell current="/me/tax">
        <PageHead title="My Tax" sub={`Financial year ${fyLabel(fy)}`} />
        <EssBanner />
        <EmptyState
          icon="receipt"
          title="The declaration could not be opened"
          body="This usually means the payroll module is not enabled for your organisation. Ask your HR team."
        />
      </CustomerShell>
    );
  }

  const comparison = await compareMyRegimes(fy);
  const row = decl as any;

  return (
    <CustomerShell current="/me/tax">
      <PageHead
        title="My Tax"
        sub={`Declarations and proofs for ${fyLabel(fy)} — this is what decides the TDS on your payslip`}
      />
      <EssBanner />
      <TaxConsole
        decl={{
          id: row.id,
          fy_start: row.fy_start,
          regime: row.regime,
          status: row.status,
          submitted_at: row.submitted_at,
          verified_at: row.verified_at,
        } satisfies DeclRow}
        items={((row.tax_declaration_items ?? []) as any[]).sort((a, b) =>
          String(a.section).localeCompare(String(b.section)),
        ) as ItemRow[]}
        comparison={comparison}
        prior={prior ? { income: Number((prior as any).income), tds: Number((prior as any).tds) } : null}
        statutoryRegime={((stat as any)?.tax_regime as string) ?? null}
      />
    </CustomerShell>
  );
}
