import { CustomerShell } from '@/components/customer-shell';
import { PageHead, EmptyState } from '@/components/shell';


export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <CustomerShell current="/reports">
      <PageHead
        title="Reports & Analytics"
        sub="Headcount, attrition, attendance, payroll and compliance"
      />
      <EmptyState
        icon="chart"
        title="No data to report yet"
        body="Reports run over live records. Add employees and run a payroll cycle and these fill in."
      />
    </CustomerShell>
  );
}
