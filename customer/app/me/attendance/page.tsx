import { CustomerShell, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/me/attendance">
      <PageHead
        title="My Attendance"
        sub="Only your own punches"
      />
      <EssBanner />
      <EmptyState
        icon="clock"
        title="No attendance logs yet"
        body="Check in from mobile with a selfie. The geofence result is computed on the server from your work location."
      />
    </CustomerShell>
  );
}
