import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/performance">
      <PageHead
        title="Performance — PMS"
        sub="Goals, KRAs, KPIs, OKRs and appraisals"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Goal
          </button>
        }
      />
      <EmptyState
        icon="target"
        title="No goals yet"
        body="Set goals and KRAs so appraisals have something to measure. Manager and peer feedback stays hidden from the employee until it is explicitly released."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Goal
          </button>
        }
      />
    </CustomerShell>
  );
}
