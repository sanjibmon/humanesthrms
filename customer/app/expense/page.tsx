import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/expense">
      <PageHead
        title="Expense Management"
        sub="Claims, receipts and reimbursement through payroll"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Claim
          </button>
        }
      />
      <EmptyState
        icon="receipt"
        title="No claims yet"
        body="Policy limits are enforced in the database: per-claim caps, monthly caps and the receipt threshold. An approved claim becomes a payroll adjustment automatically."
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
