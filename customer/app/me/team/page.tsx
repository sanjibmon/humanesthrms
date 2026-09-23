import { CustomerShell, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/me/team">
      <PageHead
        title="My Team"
        sub="Visible only if you are a manager"
      />
      <EssBanner />
      <EmptyState
        icon="users"
        title="No team data"
        body="Your reportees appear here once they are assigned to you, along with their leave requests awaiting your approval."
      />
    </CustomerShell>
  );
}
