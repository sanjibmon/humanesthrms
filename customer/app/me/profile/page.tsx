import { CustomerShell, EssBanner } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/me/profile">
      <PageHead
        title="My Profile"
        sub="Your personal, contact and statutory details"
      />
      <EssBanner />
      <EmptyState
        icon="user"
        title="Profile not set up yet"
        body="Your PAN, Aadhaar and bank account are stored encrypted and shown masked. Revealing one is permitted for you and for payroll staff, and every reveal is written to the audit log."
      />
    </CustomerShell>
  );
}
