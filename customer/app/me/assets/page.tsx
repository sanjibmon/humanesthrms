import { CustomerShell, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/me/assets">
      <PageHead
        title="My Assets"
        sub="Equipment allocated to you"
      />
      <EssBanner />
      <EmptyState
        icon="laptop"
        title="No assets assigned"
        body="Laptops, ID cards and SIMs allocated to you appear here, with the date you acknowledged them."
      />
    </CustomerShell>
  );
}
