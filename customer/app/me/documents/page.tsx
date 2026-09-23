import { CustomerShell, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/me/documents">
      <PageHead
        title="My Documents"
        sub="Your documents and payslips"
      />
      <EssBanner />
      <EmptyState
        icon="file"
        title="No documents yet"
        body="Aadhaar, PAN, your offer letter and published payslips appear here once uploaded."
      />
    </CustomerShell>
  );
}
