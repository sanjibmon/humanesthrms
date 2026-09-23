import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/integrations">
      <PageHead
        title="Integrations & API"
        sub="Devices, messaging, banking and your own systems"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Integration
          </button>
        }
      />
      <EmptyState
        icon="plug"
        title="No integrations connected"
        body="Connect eSSL, Matrix or Realtime devices, Slack or Teams, Google Workspace or Microsoft 365, and RazorpayX for salary disbursement."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Integration
          </button>
        }
      />
    </CustomerShell>
  );
}
