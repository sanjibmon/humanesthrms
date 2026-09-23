import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/attendance">
      <PageHead
        title="Attendance"
        sub="Biometric, mobile selfie and geo-fenced punches"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Device
          </button>
        }
      />
      <EmptyState
        icon="clock"
        title="No attendance logs yet"
        body="Punches are append-only and the server computes the geofence result from the employee work location, so a client cannot claim it was inside the radius."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Device
          </button>
        }
      />
    </CustomerShell>
  );
}
