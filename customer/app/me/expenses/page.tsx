import { CustomerShell, getViewer, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';
import { ExpenseConsole, type ClaimRow, type ItemRow } from '@/components/ess/expense-console';

export const dynamic = 'force-dynamic';

export default async function MyExpensesPage() {
  const v = await getViewer();
  const supabase = createClient();
  const me = v.employeeId;

  if (!me) {
    return (
      <CustomerShell current="/me/expenses">
        <PageHead title="My Expenses" sub="Claims, receipts and where each one has reached" />
        <EmptyState
          icon="receipt"
          title="This sign-in is not linked to an employee record"
          body="A claim is reimbursed to an employee, and this login administers the organisation instead."
        />
      </CustomerShell>
    );
  }

  const { data: claims } = await supabase
    .from('expense_claims')
    .select('id,claim_no,title,total,status,submitted_at,created_at')
    .eq('employee_id', me)
    .order('created_at', { ascending: false });

  const rows = (claims ?? []) as ClaimRow[];
  const { data: items } = rows.length
    ? await supabase
        .from('expense_items')
        .select('id,claim_id,expense_date,category,merchant,amount,gst_amount,description')
        .in('claim_id', rows.map((c) => c.id))
        .order('expense_date')
    : { data: [] as unknown[] };

  return (
    <CustomerShell current="/me/expenses">
      <PageHead title="My Expenses" sub="Claims, receipts and where each one has reached" />
      <EssBanner />
      <ExpenseConsole claims={rows} items={(items ?? []) as ItemRow[]} canClaim />
      <p className="mt-4 text-xs leading-relaxed text-slate-muted">
        The claim total is maintained by the database from its lines, so it cannot drift from what
        you actually claimed. A submitted claim goes to your reporting manager and then to finance;
        once approved it can be paid through payroll as an adjustment.
      </p>
    </CustomerShell>
  );
}
