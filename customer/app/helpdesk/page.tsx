import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/helpdesk">
      <PageHead
        title="Helpdesk"
        sub="HR, IT and admin tickets with SLA tracking"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Raise Ticket
          </button>
        }
      />
      <EmptyState
        icon="lifebuoy"
        title="No tickets yet"
        body="Employees raise tickets from self service. The SLA due date is set from the category when the ticket is created."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Raise Ticket
          </button>
        }
      />
    </CustomerShell>
  );
}
