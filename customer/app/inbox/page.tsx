import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/inbox">
      <PageHead
        title="Inbox & Approvals"
        sub="Everything waiting on you, in one queue"
      />
      <EmptyState
        icon="inbox"
        title="Your inbox is clear"
        body="Leave, regularisation, expense and exit requests land here. Each one carries its own approval chain: manager, then HR, then department head for long leave."
      />
    </CustomerShell>
  );
}
