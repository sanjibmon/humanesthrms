import { CustomerShell, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/me/leave">
      <PageHead
        title="My Leave"
        sub="Balances, requests and their approval status"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Apply Leave
          </button>
        }
      />
      <EssBanner />
      <EmptyState
        icon="calendar"
        title="No leave requests yet"
        body="Apply for leave and follow it through manager and HR approval. Your balance is checked before the request is accepted."
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
