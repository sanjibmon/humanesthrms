import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/recruitment">
      <PageHead
        title="Recruitment — ATS"
        sub="Requisitions, candidates and the hiring pipeline"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Job
          </button>
        }
      />
      <EmptyState
        icon="briefcase"
        title="No jobs yet"
        body="Post an opening to start a pipeline. Candidate records carry a consent timestamp and a retention date, so DPDP erasure is a scheduled job rather than a fire drill."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Job
          </button>
        }
      />
    </CustomerShell>
  );
}
