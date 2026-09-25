import Link from 'next/link';
import { BrandLockup } from '@/components/brand';
import { Icon } from '@/components/icon';

/* Landing: choose login type. Minimal by design — the production prompt asks for
   two cards and nothing else, with no sample company or employee data. */

const FEATURES = {
  employer: ['Manage employees', 'Attendance and leave', 'Payroll and compliance'],
  employee: ['My attendance', 'My leave', 'My payslips'],
};

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-canvas p-8">
      <BrandLockup />

      <div className="text-center">
        <h1 className="text-[22px] text-brand-dark">Customer Portal</h1>
        <p className="mt-1 text-sm text-slate-muted">Select login type</p>
      </div>

      <div className="grid w-full max-w-[640px] gap-5 sm:grid-cols-2">
        <Link href="/login?as=employer"
              className="flex flex-col gap-2.5 rounded-2xl border border-slate-line bg-white p-6 shadow-sm transition hover:border-brand hover:shadow-md">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Icon name="building" size={22} />
          </span>
          <h2 className="text-base">Employer Login</h2>
          <p className="text-xs text-slate-muted">For HR, Admin, Managers</p>
          <div className="my-1 flex flex-col gap-1.5">
            {FEATURES.employer.map((f) => (
              <span key={f} className="flex items-center gap-1.5 text-[11px] text-slate-muted">
                <span className="text-leaf-text"><Icon name="check" size={14} /></span>
                {f}
              </span>
            ))}
          </div>
          <span className="btn btn-primary btn-block">Login as Employer</span>
        </Link>

        <Link href="/login?as=employee"
              className="flex flex-col gap-2.5 rounded-2xl border border-slate-line bg-white p-6 shadow-sm transition hover:border-brand hover:shadow-md">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-bg text-amber-text">
            <Icon name="user" size={22} />
          </span>
          <h2 className="text-base">Employee Login</h2>
          <p className="text-xs text-slate-muted">For Employees, Self Service</p>
          <div className="my-1 flex flex-col gap-1.5">
            {FEATURES.employee.map((f) => (
              <span key={f} className="flex items-center gap-1.5 text-[11px] text-slate-muted">
                <span className="text-leaf-text"><Icon name="check" size={14} /></span>
                {f}
              </span>
            ))}
          </div>
          <span className="btn btn-block text-brand-dark">Login as Employee</span>
        </Link>
      </div>

      <p className="text-[11px] text-slate-muted">Powered by HumaNest &bull; Secured with MFA</p>
    </div>
  );
}
