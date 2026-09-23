import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/onboarding">
      <PageHead
        title="Onboarding & Offboarding"
        sub="Joining checklists and exit formalities"
      />
      <EmptyState
        icon="userplus"
        title="Nobody onboarding"
        body="New joiners appear here with checklist progress. On the exit side, clearance tasks are generated automatically and the exit cannot complete until assets are returned."
      />
    </CustomerShell>
  );
}
