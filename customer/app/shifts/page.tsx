import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/shifts">
      <PageHead
        title="Shift & Roster"
        sub="Rotational shifts, roster and swap requests"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Shift
          </button>
        }
      />
      <EmptyState
        icon="clock"
        title="No shifts configured"
        body="Define shifts with their grace period and half-day threshold, then build the month roster. Attendance status is computed against the employee shift for that date."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Shift
          </button>
        }
      />
    </CustomerShell>
  );
}
