import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/compliance">
      <PageHead
        title="Compliance & Audit — India"
        sub="Statutory registers and a tamper-evident audit log"
      />
      <EmptyState
        icon="shieldcheck"
        title="No audit entries yet"
        body="Every change records who changed what, from which address and with which MFA method. Rows are hash-chained, so an edit to history is detectable."
      />
    </CustomerShell>
  );
}
