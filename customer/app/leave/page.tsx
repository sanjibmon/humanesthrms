import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/leave">
      <PageHead
        title="Leave Management"
        sub="Policy, balances and the approval workflow"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Apply Leave
          </button>
        }
      />
      <EmptyState
        icon="calendar"
        title="No leave requests yet"
        body="Balances come from a ledger rather than a running total, so every credit and debit reconciles. Probation, gender rules, document thresholds and overlaps are enforced on apply."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Apply Leave
          </button>
        }
      />
    </CustomerShell>
  );
}
