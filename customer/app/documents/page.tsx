import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/documents">
      <PageHead
        title="Document Management"
        sub="Employee documents, expiry alerts and storage"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Upload Document
          </button>
        }
      />
      <EmptyState
        icon="file"
        title="No documents yet"
        body="Upload Aadhaar, PAN, offer and appointment letters. Documents marked HR-only are invisible to the employee, and the rest are visible to them alone."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Upload Document
          </button>
        }
      />
    </CustomerShell>
  );
}
