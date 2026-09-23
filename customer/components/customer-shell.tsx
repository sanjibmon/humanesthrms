import { Shell, type MenuItem } from '@/components/shell';
import { createClient } from '@/lib/supabase/server';

/* The employer sidebar carries every module from the production prompt.
   Payroll is flagged rupee so it renders the Indian Rupee glyph, never a dollar sign. */
export const EMPLOYER_MENU: MenuItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { href: '/inbox', label: 'Inbox & Approvals', icon: 'inbox' },
  { href: '/employees', label: 'Employees', icon: 'users' },
  { href: '/attendance', label: 'Attendance', icon: 'clock' },
  { href: '/leave', label: 'Leave', icon: 'calendar' },
  { href: '/payroll', label: 'Payroll', rupee: true },
  { href: '/expense', label: 'Expense', icon: 'receipt' },
  { href: '/recruitment', label: 'Recruitment', icon: 'briefcase' },
  { href: '/onboarding', label: 'Onboarding', icon: 'userplus' },
  { href: '/performance', label: 'Performance', icon: 'trending' },
  { href: '/assets', label: 'Asset', icon: 'laptop' },
  { href: '/helpdesk', label: 'Helpdesk', icon: 'lifebuoy' },
  { href: '/lms', label: 'LMS', icon: 'book' },
  { href: '/shifts', label: 'Shift & Roster', icon: 'clock' },
  { href: '/reports', label: 'Reports', icon: 'chart' },
  { href: '/documents', label: 'Document', icon: 'file' },
  { href: '/compliance', label: 'Compliance', icon: 'shieldcheck' },
  { href: '/integrations', label: 'Integrations', icon: 'plug' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

/* Employee self-service. Every screen is scoped to the signed-in employee's own records. */
export const EMPLOYEE_MENU: MenuItem[] = [
  { href: '/dashboard', label: 'My Dashboard', icon: 'grid' },
  { href: '/me/profile', label: 'My Profile', icon: 'user' },
  { href: '/me/attendance', label: 'My Attendance', icon: 'clock' },
  { href: '/me/leave', label: 'My Leave', icon: 'calendar' },
  { href: '/me/payroll', label: 'My Payroll', rupee: true },
  { href: '/me/expenses', label: 'My Expenses', icon: 'receipt' },
  { href: '/me/assets', label: 'My Assets', icon: 'laptop' },
  { href: '/me/documents', label: 'My Documents', icon: 'file' },
  { href: '/me/team', label: 'My Team', icon: 'users' },
  { href: '/helpdesk', label: 'Helpdesk', icon: 'lifebuoy' },
  { href: '/lms', label: 'LMS', icon: 'book' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

export type Viewer = {
  userId: string;
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: string | null;
  employeeId: string | null;
  isEmployer: boolean;
};

/** Reads the caller's membership. The company is resolved after login, never chosen on the login page. */
export async function getViewer(): Promise<Viewer> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: member } = await supabase
    .from('org_members')
    .select('org_id, role, employee_id, organizations(name)')
    .eq('user_id', user?.id ?? '')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  const role = (member as any)?.role ?? null;
  return {
    userId: user?.id ?? '',
    email: user?.email ?? '',
    orgId: (member as any)?.org_id ?? null,
    orgName: (member as any)?.organizations?.name ?? null,
    role,
    employeeId: (member as any)?.employee_id ?? null,
    isEmployer: !!role && role !== 'employee',
  };
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  hr_admin: 'HR Admin',
  payroll_admin: 'Payroll Admin',
  finance_approver: 'Finance',
  manager: 'Manager',
  recruiter: 'Recruiter',
  auditor: 'Auditor',
  employee: 'Employee',
};

export async function CustomerShell({
  current,
  children,
}: {
  current: string;
  children: React.ReactNode;
}) {
  const v = await getViewer();
  const employer = v.isEmployer;

  return (
    <Shell
      host="apps.humanest.co.in"
      brandSub={employer ? 'Employer Portal' : 'Self Service'}
      roleLabel={employer ? 'Employer' : 'Employee'}
      userName={v.orgName ?? v.email ?? 'Signed in'}
      userMeta={v.role ? ROLE_LABEL[v.role] ?? v.role : v.email}
      menu={employer ? EMPLOYER_MENU : EMPLOYEE_MENU}
      current={current}
      upsell={
        employer
          ? {
              title: 'Upgrade to Enterprise',
              body: 'All modules, a white-label domain and a dedicated success manager.',
              cta: 'See plans',
            }
          : undefined
      }
    >
      {v.orgId ? null : (
        <div className="mb-5 flex gap-2.5 rounded-xl bg-amber-bg px-3.5 py-3 text-[13px] leading-relaxed text-amber-text">
          <span>
            <b>This account is not a member of any organisation yet.</b> Add a row to{' '}
            <code>org_members</code> linking this user to an organisation and a role. Until then
            every list stays empty, because row level security is doing its job.
          </span>
        </div>
      )}
      {children}
    </Shell>
  );
}

/** The prompt requires this banner wherever an employee sees their own payroll or records. */
export function EssBanner() {
  return (
    <div className="mb-4 flex gap-2.5 rounded-xl bg-brand-soft px-3.5 py-3 text-[13px] leading-relaxed text-brand-dark">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
      <span>
        <b>ESS isolated &mdash; only your data is visible.</b> Other employees&rsquo; records are
        blocked from this portal by row level security, not just hidden from the menu.
      </span>
    </div>
  );
}
