import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/settings">
      <PageHead
        title="Settings"
        sub="Company, roles, policies and billing"
      />
      <EmptyState
        icon="settings"
        title="Nothing configured yet"
        body="Company details, roles and permissions, leave and attendance policies, payroll rules and billing all live here. Policies you set apply across the organisation."
      />
    </CustomerShell>
  );
}
