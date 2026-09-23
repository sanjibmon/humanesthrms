import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/assets">
      <PageHead
        title="Asset Management"
        sub="Laptops, ID cards, SIMs and access cards"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Asset
          </button>
        }
      />
      <EmptyState
        icon="laptop"
        title="No assets yet"
        body="Add assets, then allocate them. An asset can only have one open allocation at a time, and an exit is blocked while anything is still out."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Asset
          </button>
        }
      />
    </CustomerShell>
  );
}
