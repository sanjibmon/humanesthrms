import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';
import { Icon } from '@/components/icon';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/lms">
      <PageHead
        title="Learning & Development"
        sub="Courses, assessments and certifications"
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Course
          </button>
        }
      />
      <EmptyState
        icon="book"
        title="No courses yet"
        body="Publish a course and assign it to employees or departments."
        action={
          <button className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add Course
          </button>
        }
      />
    </CustomerShell>
  );
}
