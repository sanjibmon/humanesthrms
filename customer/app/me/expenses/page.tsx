import { CustomerShell, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/me/expenses">
      <PageHead
        title="My Expenses"
        sub="Claims you have submitted"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Claim
          </button>
        }
      />
      <EssBanner />
      <EmptyState
        icon="receipt"
        title="No claims yet"
        body="Submit a travel, food, fuel or medical claim with a receipt. Approved claims are reimbursed through payroll."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Claim
          </button>
        }
      />
    </CustomerShell>
  );
}
